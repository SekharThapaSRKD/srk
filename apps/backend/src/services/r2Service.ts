import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../config/env';

// Cloudflare R2 configuration
const R2_ACCESS_KEY_ID = env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = env.R2_SECRET_ACCESS_KEY;
const R2_ENDPOINT = env.R2_ENDPOINT;
const R2_BUCKET = env.R2_BUCKET;
const CDN_BASE_URL = env.CDN_BASE_URL;

// Initialize S3 client for Cloudflare R2
const s3Client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

/**
 * Upload a file to Cloudflare R2
 * @param fileBuffer - The file buffer to upload
 * @param fileName - The name of the file in storage
 * @param folder - The folder path in storage (e.g., 'pdf/certificates', 'pdf/agreements')
 * @returns The R2 object key (path) only, NOT the full URL
 */
export async function uploadFileToR2(
  fileBuffer: Buffer,
  fileName: string,
  folder = 'pdf',
  contentType = 'application/pdf'
): Promise<string> {
  try {
    const key = `${env.R2_PREFIX_FOLDER}/${folder}/${fileName}`;
    
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    });

    await s3Client.send(command);
    
    console.log(`File uploaded to R2: ${key}`);
    return key; // Return only the key, NOT the URL
  } catch (error) {
    console.error('Error uploading file to R2:', error);
    throw error;
  }
}

/**
 * Delete a file from Cloudflare R2
 * @param key - The R2 object key (path) to delete
 */
export async function deleteFileFromR2(key: string): Promise<void> {
  try {
    const command = new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    });

    await s3Client.send(command);
    console.log(`File deleted from R2: ${key}`);
  } catch (error) {
    console.error('Error deleting file from R2:', error);
    throw error;
  }
}

/**
 * Extract the R2 object key from either a bare key or a full R2/CDN URL,
 * so callers can pass whatever is stored in the DB (legacy rows sometimes
 * hold a full URL, newer ones a bare key) straight to deleteFileFromR2.
 * @param value - A bare R2 key or a full URL pointing at an R2 object
 * @returns The bare R2 object key
 */
export function extractR2Key(value: string): string {
  if (!value) return '';

  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    let path = url.pathname.replace(/^\/+/, '');
    if (path.startsWith(`${R2_BUCKET}/`)) {
      path = path.slice(R2_BUCKET.length + 1);
    }
    return path;
  }

  return value.replace(/^\/+/, '');
}

/**
 * Get the full CDN URL for an R2 object
 * @param key - The R2 object key (path)
 * @returns The full CDN URL
 */
export function getR2AssetUrl(key: string): string {
  if (!key) return '';
  
  if (/^https?:\/\//i.test(key)) {
    // If it's already a URL, return as-is
    return key;
  }
  
  // Remove leading slashes and prepend CDN base URL
  return `${CDN_BASE_URL}/${key.replace(/^\/+/, '')}`;
}

/**
 * Download a file from Cloudflare R2 as a buffer
 * @param key - The R2 object key (path) to download
 * @returns The file buffer
 */
export async function downloadFileFromR2(key: string): Promise<Buffer> {
  try {
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    });

    const response = await s3Client.send(command);
    
    if (!response.Body) {
      throw new Error('No file body received from R2');
    }

    // Convert the response body to a buffer
    const chunks = [];
    for await (const chunk of response.Body as any) {
      chunks.push(chunk);
    }
    
    const buffer = Buffer.concat(chunks);
    console.log(`File downloaded from R2: ${key} (${buffer.length} bytes)`);
    return buffer;
  } catch (error) {
    console.error('Error downloading file from R2:', error);
    throw error;
  }
}
