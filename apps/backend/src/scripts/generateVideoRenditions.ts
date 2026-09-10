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
 * Generates a lower-quality rendition (e.g. 720p, 360p) of every course
 * video's CURRENT videoUrl (the already-optimized, native-resolution
 * version - re-encoding from that instead of the raw original is much
 * faster and the extra generation loss is negligible at these target
 * resolutions/bitrates) and appends it to that video's `videoRenditions`
 * array. Existing renditions and the original/optimized files are never
 * touched - this is purely additive.
 *
 * To add a new quality level later (e.g. "480p"), just add an entry to
 * QUALITY_PRESETS below and run with --quality=480p. No schema change,
 * no migration - each video just gets one more { quality, url } entry.
 *
 * RESUMABLE the same way as compressCourseVideos.ts: a video is only
 * marked done (an entry pushed to videoRenditions) after its upload
 * succeeds, so re-running the same command after any interruption picks
 * up exactly where it left off.
 *
 * Usage:
 *   Test one video, no DB change:
 *     npm run script:generate-video-renditions -- --quality=720p --videoId=<id>
 *
 *   Test one video and update its DB record on success:
 *     npm run script:generate-video-renditions -- --quality=720p --videoId=<id> --apply
 *
 *   Process every course, grouped and logged per course:
 *     npm run script:generate-video-renditions -- --quality=720p --all --apply
 *
 *   Later, add another quality level the same way:
 *     npm run script:generate-video-renditions -- --quality=360p --all --apply
 */

// Bitrates are deliberately low - the whole point of these renditions is
// small file size for unstable connections, not matching a "good quality"
// 720p. They must stay comfortably below the existing optimized videoUrl's
// own bitrate (~1000-1500kbps at 1080p/4K, verified per-video), or a
// "720p" rendition ends up no smaller than the 1080p source - defeating
// the purpose (verified: 1500k produced a LARGER file than a 22.4MB 1080p
// source before this was lowered).
const QUALITY_PRESETS: Record<
  string,
  { maxWidth: number; videoBitrateKbps: number; audioBitrateKbps: number }
> = {
  '720p': { maxWidth: 1280, videoBitrateKbps: 800, audioBitrateKbps: 96 },
  '360p': { maxWidth: 640, videoBitrateKbps: 300, audioBitrateKbps: 64 },
};

const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_ENDPOINT = process.env.R2_ENDPOINT || '';
const R2_BUCKET = process.env.R2_BUCKET || '';
const CDN_BASE_URL = process.env.CDN_BASE_URL || '';
const DATABASE_URL = process.env.DATABASE_URL || '';

const NETWORK_RETRIES = 3;
const NETWORK_RETRY_DELAY_MS = 5_000;

// ---------------------------------------------------------------------------
// Logging: console + a timestamped file per run + latest.log for `tail -f`.
// ---------------------------------------------------------------------------
const LOG_DIR = path.join(process.cwd(), 'logs', 'video-renditions');
fs.mkdirSync(LOG_DIR, { recursive: true });
const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
const runLogPath = path.join(LOG_DIR, `run-${runTimestamp}.log`);
const latestLogPath = path.join(LOG_DIR, 'latest.log');
fs.writeFileSync(latestLogPath, '');

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

function renditionKeyFor(sourceKey: string, quality: string): string {
  const dir = path.posix.dirname(sourceKey);
  const base = path.posix.basename(
    sourceKey,
    path.posix.extname(sourceKey)
  );
  return `${dir}/${base}-${quality}.mp4`;
}

const STREAM_IDLE_TIMEOUT_MS = 60_000;

async function downloadToFile(key: string, destPath: string): Promise<void> {
  await withRetry(async () => {
    const res = await s3Client.send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: key })
    );
    const body = res.Body as import('stream').Readable;
    await new Promise<void>((resolve, reject) => {
      const writeStream = fs.createWriteStream(destPath);
      // The initial GetObjectCommand response is bounded by requestTimeout,
      // but once the body starts streaming, a connection that goes idle
      // (e.g. after a network drop/sleep, on a half-open socket) can hang
      // indefinitely with no error - verified: a real download stalled at
      // 30MB for 5+ hours with no timeout ever firing. This independently
      // watches for data and aborts if none arrives for a while.
      let idleTimer: NodeJS.Timeout;
      const resetIdleTimer = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          body.destroy();
          reject(
            new Error(`Download stalled - no data for ${STREAM_IDLE_TIMEOUT_MS / 1000}s`)
          );
        }, STREAM_IDLE_TIMEOUT_MS);
      };
      resetIdleTimer();
      body.on('data', resetIdleTimer);
      body.pipe(writeStream);
      body.on('error', (err) => {
        clearTimeout(idleTimer);
        reject(err);
      });
      writeStream.on('error', (err) => {
        clearTimeout(idleTimer);
        reject(err);
      });
      writeStream.on('finish', () => {
        clearTimeout(idleTimer);
        resolve();
      });
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

const MIN_VIDEO_BITRATE_KBPS = 150;

async function transcodeRendition(
  inputPath: string,
  outputPath: string,
  videoBitrateKbps: number,
  audioBitrateKbps: number,
  maxWidth: number,
  tmpDir: string
): Promise<void> {
  const passLogPrefix = path.join(tmpDir, 'ffmpeg2pass');
  const nullOutput = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const scaleFilter = `scale='min(${maxWidth},iw)':'-2'`;

  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    inputPath,
    '-vf',
    scaleFilter,
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-b:v',
    `${videoBitrateKbps}k`,
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
    '-vf',
    scaleFilter,
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-b:v',
    `${videoBitrateKbps}k`,
    '-pass',
    '2',
    '-passlogfile',
    passLogPrefix,
    '-c:a',
    'aac',
    '-b:a',
    `${audioBitrateKbps}k`,
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
  quality: string;
  excludeCourses: string[];
  onlyCourse?: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const videoIdArg = args.find((a) => a.startsWith('--videoId='));
  const qualityArg = args.find((a) => a.startsWith('--quality='));
  const excludeArg = args.find((a) => a.startsWith('--excludeCourses='));
  const onlyCourseArg = args.find((a) => a.startsWith('--onlyCourse='));
  return {
    videoId: videoIdArg ? videoIdArg.split('=')[1] : undefined,
    all: args.includes('--all'),
    apply: args.includes('--apply'),
    quality: qualityArg ? qualityArg.split('=')[1] : '',
    excludeCourses: excludeArg
      ? excludeArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean)
      : [],
    onlyCourse: onlyCourseArg ? onlyCourseArg.split('=')[1] : undefined,
  };
}

interface VideoDoc {
  _id: mongoose.Types.ObjectId;
  name: string;
  videoUrl: string;
  videoRenditions?: { quality: string; url: string }[];
}

async function processOne(
  video: VideoDoc,
  quality: string,
  preset: { maxWidth: number; videoBitrateKbps: number; audioBitrateKbps: number },
  apply: boolean
): Promise<{ skipped: boolean }> {
  const alreadyHas = (video.videoRenditions || []).some(
    (r) => r.quality === quality
  );
  if (alreadyHas) {
    log(`  SKIP (already has ${quality}): ${video.name}`);
    return { skipped: true };
  }

  const sourceKey = extractR2Key(video.videoUrl);
  const destKey = renditionKeyFor(sourceKey, quality);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srk-rendition-'));
  const inputExt = path.posix.extname(sourceKey) || '.mp4';
  const inputPath = path.join(tmpDir, `in${inputExt}`);
  const outputPath = path.join(tmpDir, 'out.mp4');

  try {
    log(`  --- ${video.name} (${video._id}) -> ${quality} ---`);
    log(`  Downloading source: ${sourceKey}`);
    await downloadToFile(sourceKey, inputPath);
    const sourceSize = fs.statSync(inputPath).size;
    log(`  Source size: ${(sourceSize / 1024 / 1024).toFixed(1)} MB`);

    // Cap the target well below the source's OWN bitrate - a fixed preset
    // bitrate can exceed what a low-motion/already-optimized source
    // actually uses, producing a "rendition" that's bigger than the
    // source with no quality benefit (verified: happened twice with a
    // flat 800k target before this per-video cap was added).
    const durationSeconds = await getDurationSeconds(inputPath);
    const sourceBitrateKbps = (sourceSize * 8) / durationSeconds / 1000;
    const videoBitrateKbps = Math.max(
      Math.min(preset.videoBitrateKbps, sourceBitrateKbps * 0.6),
      MIN_VIDEO_BITRATE_KBPS
    );
    log(
      `  Source bitrate: ${sourceBitrateKbps.toFixed(0)} kbps -> target: ${videoBitrateKbps.toFixed(
        0
      )} kbps video (preset ceiling ${preset.videoBitrateKbps}k)`
    );

    log(`  Transcoding to ${quality} (two-pass, max width ${preset.maxWidth})...`);
    await transcodeRendition(
      inputPath,
      outputPath,
      videoBitrateKbps,
      preset.audioBitrateKbps,
      preset.maxWidth,
      tmpDir
    );
    const newSize = fs.statSync(outputPath).size;
    log(`  Rendition size: ${(newSize / 1024 / 1024).toFixed(1)} MB`);

    if (newSize >= sourceSize) {
      log(
        `  WARNING: rendition (${(newSize / 1024 / 1024).toFixed(1)} MB) is not smaller than source (${(
          sourceSize /
          1024 /
          1024
        ).toFixed(1)} MB) - uploading anyway, but this defeats the purpose. Investigate.`
      );
    }

    log(`  Uploading: ${destKey}`);
    await uploadFile(destKey, outputPath);
    log(`  Uploaded. Preview URL: ${assetUrl(destKey)}`);

    if (apply) {
      await CourseVideoModel.updateOne(
        { _id: video._id },
        { $push: { videoRenditions: { quality, url: destKey } } }
      );
      log(`  DB updated: videoRenditions += { quality: "${quality}", url: "${destKey}" }`);
    } else {
      log('  DB NOT updated (pass --apply once you have confirmed playback).');
    }

    return { skipped: false };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function processVideoList(
  videos: VideoDoc[],
  quality: string,
  preset: { maxWidth: number; videoBitrateKbps: number; audioBitrateKbps: number },
  apply: boolean
): Promise<{ processed: number; skipped: number; failed: number }> {
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const video of videos) {
    try {
      const result = await processOne(video, quality, preset, apply);
      if (result.skipped) skipped++;
      else processed++;
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

  return { processed, skipped, failed };
}

async function main() {
  const { videoId, all, apply, quality, excludeCourses, onlyCourse } = parseArgs();

  if (!quality) {
    console.error(
      `Pass --quality=<${Object.keys(QUALITY_PRESETS).join('|')}>`
    );
    process.exit(1);
  }
  const preset = QUALITY_PRESETS[quality];
  if (!preset) {
    console.error(
      `Unknown quality "${quality}". Known: ${Object.keys(QUALITY_PRESETS).join(', ')}`
    );
    process.exit(1);
  }
  if (!videoId && !all && !onlyCourse) {
    console.error(
      'Pass --videoId=<id> (test one video), --all (process every video), or --onlyCourse=<id>.'
    );
    process.exit(1);
  }
  if (!DATABASE_URL || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT || !R2_BUCKET) {
    console.error('Missing required environment variables (DATABASE_URL / R2_*).');
    process.exit(1);
  }

  log(`Log file for this run: ${runLogPath}`);
  log(`Quality: ${quality} (maxWidth=${preset.maxWidth}, videoBitrate=${preset.videoBitrateKbps}k, audioBitrate=${preset.audioBitrateKbps}k)`);
  log(`Connecting to database (IS_PROD=${process.env.IS_PROD})...`);
  await mongoose.connect(DATABASE_URL);
  log('Connected.');

  if (videoId) {
    const videos = await CourseVideoModel.find({ _id: videoId }).lean();
    if (videos.length === 0) {
      console.error(`No video found with id ${videoId}`);
      await mongoose.disconnect();
      process.exit(1);
    }
    log(`Processing 1 video. apply=${apply}`);
    const result = await processVideoList(videos, quality, preset, apply);
    log('='.repeat(70));
    log(`Processed: ${result.processed}, Skipped: ${result.skipped}, Failed: ${result.failed}`);
    await mongoose.disconnect();
    process.exit(result.failed > 0 ? 1 : 0);
  }

  const courses = await CourseModel.find({}).lean();
  const coursesToProcess = onlyCourse
    ? courses.filter((c) => c._id.toString() === onlyCourse)
    : courses.filter((c) => !excludeCourses.includes(c._id.toString()));

  if (onlyCourse) {
    log(`Only processing course: ${coursesToProcess[0]?.title || onlyCourse}`);
  }
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

  for (let i = 0; i < coursesToProcess.length; i++) {
    const course = coursesToProcess[i];
    const videos = await CourseVideoModel.find({ courseId: course._id }).lean();
    log('');
    log('#'.repeat(70));
    log(`# COURSE ${i + 1}/${coursesToProcess.length}: ${course.title} (${videos.length} videos)`);
    log('#'.repeat(70));

    const result = await processVideoList(videos, quality, preset, apply);
    grandProcessed += result.processed;
    grandSkipped += result.skipped;
    grandFailed += result.failed;

    log(
      `Course done: ${course.title} -> processed=${result.processed}, skipped=${result.skipped}, failed=${result.failed}`
    );
    log(
      `Running total so far: processed=${grandProcessed}, skipped=${grandSkipped}, failed=${grandFailed}`
    );
  }

  log('');
  log('='.repeat(70));
  log(`ALL DONE. Processed: ${grandProcessed}, Skipped: ${grandSkipped}, Failed: ${grandFailed}`);
  log('='.repeat(70));

  await mongoose.disconnect();
  process.exit(grandFailed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  log(`Script failed: ${(error as Error)?.message || error}`);
  await mongoose.disconnect();
  process.exit(1);
});
