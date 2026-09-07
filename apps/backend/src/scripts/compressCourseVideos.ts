import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { CourseVideoModel } from '../model/courseVideo';
import { CourseModel } from '../model/courseModel';

const execFileAsync = promisify(execFile);

/**
 * Compresses existing course videos (raw uploads, some as large as 1.4GB /
 * QuickTime .mov) down to roughly half their original file size, and
 * uploads the result to R2 under a NEW key. The original object is never
 * touched or deleted (kept in `originalVideoUrl`), so this is safe to
 * re-run and easy to walk back.
 *
 * Resolution is left untouched (no downscaling) - some course videos have
 * small on-screen content (tiny UI text, code) that becomes unreadable once
 * downscaled to 1080p, so the size reduction comes entirely from bitrate,
 * targeted at ~50% of the original file's average bitrate (two-pass, since
 * single-pass badly undershoots on static/slide-heavy content).
 *
 * RESUMABLE: a video is only ever marked done in the DB (videoUrl swapped
 * to the optimized key) after its upload succeeds. If this script is
 * killed (network drop, machine sleep/shutdown, session restart), just
 * re-run the exact same command - already-applied videos are skipped
 * (their videoUrl already ends in "-optimized") and everything else picks
 * up where it left off. No manual bookkeeping needed.
 *
 * Progress is logged to logs/course-video-compression/ (both a
 * timestamped file per run and latest.log, which always has the current
 * run's tail) so progress can be watched with:
 *   tail -f logs/course-video-compression/latest.log
 *
 * Usage:
 *   Test one video, no DB change:
 *     npm run script:compress-course-videos -- --videoId=<id>
 *
 *   Test one video and update its DB record on success:
 *     npm run script:compress-course-videos -- --videoId=<id> --apply
 *
 *   Process every course, grouped and logged per course, updating DB
 *   records as it goes:
 *     npm run script:compress-course-videos -- --all --apply
 *
 *   Same, but skip specific courses (comma-separated course _ids):
 *     npm run script:compress-course-videos -- --all --apply --excludeCourses=<id1>,<id2>
 *
 *   Process every video WITHOUT touching the DB (just generates the
 *   optimized files in R2 for review first):
 *     npm run script:compress-course-videos -- --all
 */

const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_ENDPOINT = process.env.R2_ENDPOINT || '';
const R2_BUCKET = process.env.R2_BUCKET || '';
const CDN_BASE_URL = process.env.CDN_BASE_URL || '';
const DATABASE_URL = process.env.DATABASE_URL || '';

const OPTIMIZED_SUFFIX = '-optimized';
const AUDIO_BITRATE_BPS = 128_000;
const MIN_VIDEO_BITRATE_BPS = 400_000;
const NETWORK_RETRIES = 3;
const NETWORK_RETRY_DELAY_MS = 5_000;

// ---------------------------------------------------------------------------
// Logging: every line goes to the console, a timestamped file for this run,
// and latest.log (always the current/most recent run) for easy `tail -f`.
// ---------------------------------------------------------------------------
const LOG_DIR = path.join(process.cwd(), 'logs', 'course-video-compression');
fs.mkdirSync(LOG_DIR, { recursive: true });
const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
const runLogPath = path.join(LOG_DIR, `run-${runTimestamp}.log`);
const latestLogPath = path.join(LOG_DIR, 'latest.log');
fs.writeFileSync(latestLogPath, '');

// Synchronous writes on purpose: an async WriteStream can still have
// buffered data in flight when process.exit() fires, silently dropping the
// last few lines right at completion/crash - exactly when they matter most.
function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(runLogPath, line + '\n');
  fs.appendFileSync(latestLogPath, line + '\n');
}

const s3Client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
  // Without this, a connection broken by machine sleep/network drop just
  // hangs forever instead of erroring - which silently stalls the whole
  // batch (a real ~2 hour hang was observed after the laptop was closed
  // mid-upload). These bound the worst case so withRetry can actually run.
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 15_000,
    requestTimeout: 15 * 60_000,
  }),
});

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  retries = NETWORK_RETRIES,
  delayMs = NETWORK_RETRY_DELAY_MS
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      log(
        `  ${label} failed (attempt ${attempt}/${retries}): ${
          (error as Error)?.message || error
        }`
      );
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  throw lastError;
}

function extractR2Key(videoUrl: string): string {
  if (/^https?:\/\//i.test(videoUrl)) {
    const url = new URL(videoUrl);
    let p = url.pathname.replace(/^\/+/, '');
    if (p.startsWith(`${R2_BUCKET}/`)) p = p.slice(R2_BUCKET.length + 1);
    return p;
  }
  return videoUrl.replace(/^\/+/, '');
}

function optimizedKeyFor(originalKey: string): string {
  const dir = path.posix.dirname(originalKey);
  const base = path.posix.basename(
    originalKey,
    path.posix.extname(originalKey)
  );
  return `${dir}/${base}${OPTIMIZED_SUFFIX}.mp4`;
}

async function downloadToFile(key: string, destPath: string): Promise<void> {
  await withRetry(async () => {
    const res = await s3Client.send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: key })
    );
    const body = res.Body as NodeJS.ReadableStream;
    await new Promise<void>((resolve, reject) => {
      const writeStream = fs.createWriteStream(destPath);
      body.pipe(writeStream);
      body.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);
    });
  }, 'Download');
}

async function getDurationSeconds(inputPath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    inputPath,
  ]);
  const duration = parseFloat(stdout.trim());
  if (!duration || Number.isNaN(duration)) {
    throw new Error('Could not determine video duration');
  }
  return duration;
}

// Single-pass -b:v badly undershoots the target on simple/static
// screen-recording content (verified: landed at ~35% of the requested
// bitrate on a real test file). Two-pass reliably hits the target size.
async function compressVideo(
  inputPath: string,
  outputPath: string,
  videoBitrateBps: number,
  tmpDir: string
): Promise<void> {
  const videoBitrateK = Math.round(videoBitrateBps / 1000);
  const passLogPrefix = path.join(tmpDir, 'ffmpeg2pass');
  const nullOutput = process.platform === 'win32' ? 'NUL' : '/dev/null';

  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    inputPath,
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-b:v',
    `${videoBitrateK}k`,
    '-pass',
    '1',
    '-passlogfile',
    passLogPrefix,
    '-an',
    '-f',
    'mp4',
    nullOutput,
  ]);

  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    inputPath,
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-b:v',
    `${videoBitrateK}k`,
    '-pass',
    '2',
    '-passlogfile',
    passLogPrefix,
    '-c:a',
    'aac',
    '-b:a',
    `${AUDIO_BITRATE_BPS / 1000}k`,
    '-movflags',
    '+faststart',
    outputPath,
  ]);
}

async function uploadFile(destKey: string, filePath: string): Promise<void> {
  const buffer = fs.readFileSync(filePath);
  await withRetry(
    () =>
      s3Client.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: destKey,
          Body: buffer,
          ContentType: 'video/mp4',
          CacheControl: 'public, max-age=31536000, immutable',
        })
      ),
    'Upload'
  );
}

function assetUrl(key: string): string {
  return `${CDN_BASE_URL}/${key.replace(/^\/+/, '')}`;
}

interface Args {
  videoId?: string;
  all: boolean;
  apply: boolean;
  excludeCourses: string[];
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const videoIdArg = args.find((a) => a.startsWith('--videoId='));
  const excludeArg = args.find((a) => a.startsWith('--excludeCourses='));
  return {
    videoId: videoIdArg ? videoIdArg.split('=')[1] : undefined,
    all: args.includes('--all'),
    apply: args.includes('--apply'),
    excludeCourses: excludeArg
      ? excludeArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean)
      : [],
  };
}

interface VideoDoc {
  _id: mongoose.Types.ObjectId;
  name: string;
  videoUrl: string;
}

async function processOne(
  video: VideoDoc,
  apply: boolean
): Promise<{ skipped: boolean; originalSize?: number; newSize?: number }> {
  const originalKey = extractR2Key(video.videoUrl);

  if (originalKey.includes(OPTIMIZED_SUFFIX)) {
    log(`  SKIP (already optimized): ${video.name}`);
    return { skipped: true };
  }

  const destKey = optimizedKeyFor(originalKey);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srk-video-'));
  const inputExt = path.posix.extname(originalKey) || '.mp4';
  const inputPath = path.join(tmpDir, `in${inputExt}`);
  const outputPath = path.join(tmpDir, 'out.mp4');

  try {
    log(`  --- ${video.name} (${video._id}) ---`);
    log(`  Downloading: ${originalKey}`);
    await downloadToFile(originalKey, inputPath);
    const originalSize = fs.statSync(inputPath).size;
    log(`  Original size: ${(originalSize / 1024 / 1024).toFixed(1)} MB`);

    const durationSeconds = await getDurationSeconds(inputPath);
    const targetTotalBitrateBps = (originalSize * 8) / durationSeconds / 2;
    const videoBitrateBps = Math.max(
      targetTotalBitrateBps - AUDIO_BITRATE_BPS,
      MIN_VIDEO_BITRATE_BPS
    );
    log(
      `  Duration: ${durationSeconds.toFixed(0)}s, target video bitrate: ${(
        videoBitrateBps / 1000
      ).toFixed(0)} kbps (native resolution kept)`
    );

    log('  Compressing with ffmpeg (two-pass)...');
    await compressVideo(inputPath, outputPath, videoBitrateBps, tmpDir);
    const newSize = fs.statSync(outputPath).size;
    const reduction = (100 * (1 - newSize / originalSize)).toFixed(0);
    log(
      `  Compressed size: ${(newSize / 1024 / 1024).toFixed(1)} MB (-${reduction}%)`
    );

    log(`  Uploading: ${destKey}`);
    await uploadFile(destKey, outputPath);
    log(`  Uploaded. Preview URL: ${assetUrl(destKey)}`);

    if (apply) {
      await CourseVideoModel.updateOne(
        { _id: video._id },
        { $set: { videoUrl: destKey, originalVideoUrl: originalKey } }
      );
      log(
        `  DB updated: videoUrl -> optimized, originalVideoUrl -> ${originalKey}`
      );
    } else {
      log('  DB NOT updated (pass --apply once you have confirmed playback).');
    }

    return { skipped: false, originalSize, newSize };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function processVideoList(
  videos: VideoDoc[],
  apply: boolean
): Promise<{
  processed: number;
  skipped: number;
  failed: number;
  totalOriginal: number;
  totalNew: number;
}> {
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let totalOriginal = 0;
  let totalNew = 0;

  for (const video of videos) {
    try {
      const result = await processOne(video, apply);
      if (result.skipped) {
        skipped++;
      } else {
        processed++;
        totalOriginal += result.originalSize || 0;
        totalNew += result.newSize || 0;
      }
    } catch (error) {
      failed++;
      const stderr = (error as { stderr?: string })?.stderr;
      log(
        `  FAILED: ${video.name} (${video._id}): ${
          (error as Error)?.message || error
        }${stderr ? `\n  stderr: ${stderr}` : ''}`
      );
    }
  }

  return { processed, skipped, failed, totalOriginal, totalNew };
}

async function main() {
  const { videoId, all, apply, excludeCourses } = parseArgs();

  if (!videoId && !all) {
    console.error(
      'Pass either --videoId=<id> (test one video) or --all (process every video).'
    );
    process.exit(1);
  }
  if (!DATABASE_URL || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT || !R2_BUCKET) {
    console.error('Missing required environment variables (DATABASE_URL / R2_*).');
    process.exit(1);
  }

  log(`Log file for this run: ${runLogPath}`);
  log(`Connecting to database (IS_PROD=${process.env.IS_PROD})...`);
  await mongoose.connect(DATABASE_URL);
  log('Connected.');

  // Single-video mode (testing) - unchanged, no course grouping needed.
  if (videoId) {
    const videos = await CourseVideoModel.find({ _id: videoId }).lean();
    if (videos.length === 0) {
      console.error(`No video found with id ${videoId}`);
      await mongoose.disconnect();
      process.exit(1);
    }
    log(`Processing 1 video. apply=${apply}`);
    const result = await processVideoList(videos, apply);
    log('='.repeat(70));
    log(
      `Processed: ${result.processed}, Skipped: ${result.skipped}, Failed: ${result.failed}`
    );
    await mongoose.disconnect();
    process.exit(result.failed > 0 ? 1 : 0);
  }

  // --all mode: grouped per course, logged per course, resumable.
  const courses = await CourseModel.find({}).lean();
  const coursesToProcess = courses.filter(
    (c) => !excludeCourses.includes(c._id.toString())
  );

  if (excludeCourses.length > 0) {
    const excludedNames = courses
      .filter((c) => excludeCourses.includes(c._id.toString()))
      .map((c) => c.title);
    log(`Excluding courses: ${excludedNames.join(', ') || excludeCourses.join(', ')}`);
  }

  log(`Found ${coursesToProcess.length} course(s) to process. apply=${apply}`);

  let grandProcessed = 0;
  let grandSkipped = 0;
  let grandFailed = 0;
  let grandOriginal = 0;
  let grandNew = 0;

  for (let i = 0; i < coursesToProcess.length; i++) {
    const course = coursesToProcess[i];
    const videos = await CourseVideoModel.find({ courseId: course._id }).lean();
    log('');
    log('#'.repeat(70));
    log(
      `# COURSE ${i + 1}/${coursesToProcess.length}: ${course.title} (${videos.length} videos)`
    );
    log('#'.repeat(70));

    const result = await processVideoList(videos, apply);
    grandProcessed += result.processed;
    grandSkipped += result.skipped;
    grandFailed += result.failed;
    grandOriginal += result.totalOriginal;
    grandNew += result.totalNew;

    log(
      `Course done: ${course.title} -> processed=${result.processed}, skipped=${result.skipped}, failed=${result.failed}`
    );
    log(
      `Running total so far: processed=${grandProcessed}, skipped=${grandSkipped}, failed=${grandFailed}, ${(
        grandOriginal /
        1024 /
        1024 /
        1024
      ).toFixed(2)} GB -> ${(grandNew / 1024 / 1024 / 1024).toFixed(2)} GB`
    );
  }

  log('');
  log('='.repeat(70));
  log(
    `ALL DONE. Processed: ${grandProcessed}, Skipped: ${grandSkipped}, Failed: ${grandFailed}`
  );
  if (grandProcessed > 0) {
    log(
      `Total: ${(grandOriginal / 1024 / 1024 / 1024).toFixed(2)} GB -> ${(
        grandNew /
        1024 /
        1024 /
        1024
      ).toFixed(2)} GB`
    );
  }
  log('='.repeat(70));

  await mongoose.disconnect();
  process.exit(grandFailed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  log(`Script failed: ${(error as Error)?.message || error}`);
  await mongoose.disconnect();
  process.exit(1);
});
