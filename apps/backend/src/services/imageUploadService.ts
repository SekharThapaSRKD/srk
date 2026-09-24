import { randomUUID } from 'crypto';
import convert from 'heic-convert';
import sharp from 'sharp';
import { deleteFileFromR2, uploadFileToR2 } from './r2Service';
import { env } from '../config/env';

export const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// iPhones (and some Android phones in high-efficiency mode) save photos as
// HEIC/HEIF by default. Neither browsers nor our installed sharp build can
// decode it, so convert it to JPEG before it hits the normal image pipeline.
const HEIC_MIME_TYPES = new Set(['image/heic', 'image/heif']);

/**
 * Parses a data URL string and extracts the image buffer, content type, and extension.
 * Transparently converts HEIC/HEIF (iPhone default photo format) to JPEG.
 * @param dataUrl - Base64 data URL in format: data:image/jpeg;base64,...
 * @returns Object with buffer, contentType, and extension
 * @throws Error if data URL is invalid or unsupported format
 */
export const parseImageDataUrl = async (dataUrl: string) => {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (!match) {
    throw new Error('Invalid image data URL');
  }

  const contentType = match[1].toLowerCase();
  const rawBuffer = Buffer.from(match[2], 'base64');
  if (!rawBuffer.length) {
    throw new Error('Image payload is empty');
  }

  if (HEIC_MIME_TYPES.has(contentType)) {
    let jpegBuffer: Buffer;
    try {
      jpegBuffer = Buffer.from(
        await convert({ buffer: rawBuffer, format: 'JPEG', quality: 0.9 })
      );
    } catch (error) {
      console.error('HEIC conversion failed:', error);
      throw new Error('Unsupported image type: ' + contentType);
    }
    return {
      buffer: jpegBuffer,
      contentType: 'image/jpeg',
      extension: 'jpg',
    };
  }

  if (!MIME_EXTENSION_MAP[contentType]) {
    throw new Error(`Unsupported image type: ${contentType}`);
  }

  return {
    buffer: rawBuffer,
    contentType,
    extension: MIME_EXTENSION_MAP[contentType],
  };
};

/**
 * Uploads a base64-encoded image data URL to Cloudflare R2
 * @param dataUrl - Base64 data URL
 * @param folder - R2 folder path (e.g., 'grow/kyc', 'task/documents')
 * @param filePrefix - Prefix for generated filename (e.g., 'grow-kyc', 'task-doc')
 * @returns The R2 asset path key
 */
export const uploadImageDataUrlToR2 = async (
  dataUrl: string,
  folder: string,
  filePrefix: string,
  options: { compress?: boolean } = {}
) => {
  const rootFolder = env.R2_PREFIX_FOLDER;
  let { buffer, contentType, extension } = await parseImageDataUrl(dataUrl);

  if (options.compress) {
    buffer = await sharp(buffer)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    contentType = 'image/jpeg';
    extension = 'jpg';
  }

  const fileName = `${filePrefix}-${Date.now()}-${randomUUID()}.${extension}`;
  // Log the effective target (prefix + folder) so runtime shows srk/dev clearly
  console.log(`[R2] Upload target: ${rootFolder}/${folder}/${fileName}`);
  return uploadFileToR2(buffer, fileName, folder, contentType);
};

/**
 * Cleans up uploaded R2 files on error or rollback
 * Uses Promise.allSettled to ensure all deletions are attempted even if some fail
 * @param keys - Array of R2 asset path keys to delete
 */
export const cleanupR2Uploads = async (keys: string[]) => {
  if (!keys.length) return;

  await Promise.allSettled(keys.map((key) => deleteFileFromR2(key)));
};
