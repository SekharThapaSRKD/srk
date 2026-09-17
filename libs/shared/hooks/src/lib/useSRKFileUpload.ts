// import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
// import { storage } from '@srk/shared/firebase';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { v4 as uuidv4 } from 'uuid';
import { useState, useRef, useCallback } from 'react';
import { env as sharedEnv } from '@srk/shared/firebase';

// Cloudflare R2 S3 config
const R2_ACCESS_KEY_ID = 'daf464fc116a11847575b6fbfbac26a0';
const R2_SECRET_ACCESS_KEY = '6414fef2c8ca3715856b08ab2302d1d92e80b7cec32971acc0d85cef559fd4e4';
const R2_ENDPOINT = 'https://5f09c9e5753d5a473d39fed1135fef46.r2.cloudflarestorage.com';
const R2_BUCKET = 'srk'; // Change to your bucket name if different

const s3Client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  delayMs = 800
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

export interface UploadProgress {
  [uploadId: string]: {
    progress: number;
    fileName: string;
    status: 'pending' | 'uploading' | 'completed' | 'failed' | 'cancelled';
    error?: string;
    lastProgressTime?: number;
  };
}

const compressImage = async (file: File): Promise<File> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Resize if larger than 1920x1080
        const maxWidth = 1920;
        const maxHeight = 1080;
        if (width > maxHeight || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width *= ratio;
          height *= ratio;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            const compressedFile = new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            resolve(compressedFile);
          },
          'image/jpeg',
          0.85 // 85% quality
        );
      };
    };
  });
};

export const useSRKFileUpload = (appName: string) => {
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({});
  const [isUploading, setIsUploading] = useState(false);
  // const uploadTasksRef = useRef<Map<string, ReturnType<typeof uploadBytesResumable>>>(new Map());
  const progressTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const uploadFile = async (
    file: File,
    fileType: 'video' | 'image',
    onProgress?: (progress: number, url?: string) => void,
    onError?: (error: string) => void,
    options?: {
      keyPrefix?: string;
    }
  ): Promise<{ url: string; key: string }> => {
    const uploadId = uuidv4();
    setIsUploading(true);

    try {
      // Compress images before upload to reduce Cloudflare load
      let fileToUpload = file;
      if (fileType === 'image' && file.size > 1024 * 1024) {
        console.log(`📦 Compressing image: ${file.name}`);
        fileToUpload = await compressImage(file);
        console.log(`✅ Compressed from ${file.size} to ${fileToUpload.size} bytes`);
      }

      // Prepare S3 upload
      const uniqueSuffix = `${Date.now()}-${uuidv4()}`;
      const extension = file.name.split('.').pop();
      const keyPrefix = options?.keyPrefix ?? fileType;
      const uniqueFileName = `${keyPrefix}-${uniqueSuffix}.${extension}`;
      // Must match the backend's R2_PREFIX_FOLDER convention (env.ts), or the
      // CDN (which only serves the "srk" namespace in prod) 404s on these uploads.
      const envPrefix = sharedEnv.isProdFlag ? 'srk' : 'dev';
      const key = `${envPrefix}/${appName}/${keyPrefix}/${uniqueFileName}`;

      const params = {
        Bucket: R2_BUCKET,
        Key: key,
        Body: fileToUpload,
        ContentType: fileToUpload.type,
      };

      setUploadProgress((prev) => ({
        ...prev,
        [uploadId]: {
          progress: 0,
          fileName: file.name,
          status: 'uploading',
          lastProgressTime: Date.now(),
        },
      }));
      if (onProgress) onProgress(0);

      // Multipart upload via @aws-sdk/lib-storage emits real httpUploadProgress
      // events as each part completes, unlike a plain PutObjectCommand which
      // only resolves once the entire body has been sent (no progress in between).
      // Retries a couple times on transient failures (e.g. mobile network drops)
      // before giving up, since a single blip used to kill the whole flow.
      await withRetry(async () => {
        const upload = new Upload({
          client: s3Client,
          params,
          queueSize: 4,
          partSize: 5 * 1024 * 1024,
        });

        upload.on('httpUploadProgress', (event) => {
          const loaded = event.loaded ?? 0;
          const total = event.total ?? fileToUpload.size;
          // Cap at 99 so the 100% state below only appears once the upload
          // has actually been confirmed complete by upload.done().
          const percent =
            total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0;
          setUploadProgress((prev) => ({
            ...prev,
            [uploadId]: {
              progress: percent,
              fileName: file.name,
              status: 'uploading',
              lastProgressTime: Date.now(),
            },
          }));
          if (onProgress) onProgress(percent);
        });

        await upload.done();
      });
      const url = `${R2_ENDPOINT}/${R2_BUCKET}/${key}`;

      setUploadProgress((prev) => ({
        ...prev,
        [uploadId]: {
          progress: 100,
          fileName: file.name,
          status: 'completed',
          lastProgressTime: Date.now(),
        },
      }));
      setIsUploading(false);
      if (onProgress) onProgress(100, url);
      return { url, key };
    } catch (error) {
      const errorMsg = (error as Error)?.message || 'Upload failed';
      console.error(`❌ Upload error for ${uploadId}:`, errorMsg);
      setUploadProgress((prev) => {
        const updated = { ...prev };
        delete updated[uploadId];
        if (Object.keys(updated).length === 0) {
          setIsUploading(false);
        }
        return updated;
      });
      if (onError) onError(errorMsg);
      throw error;
    }
  };

  // REMOVED: uploadFileToFirebaseWithRetry (replaced by direct S3 upload above)



  // Calculate overall progress across all active uploads
  const getOverallProgress = (): number => {
    const uploads = Object.values(uploadProgress);
    if (uploads.length === 0) return 0;
    const totalProgress = uploads.reduce(
      (sum, upload) => sum + upload.progress,
      0
    );
    return Math.round(totalProgress / uploads.length);
  };

  const getActiveUploads = () => {
    return Object.entries(uploadProgress).map(([id, data]) => ({
      id,
      fileName: data.fileName,
      progress: data.progress,
      status: data.status,
      error: data.error,
    }));
  };

  const resetProgress = useCallback(() => {
    setUploadProgress({});
    setIsUploading(false);
    progressTimeoutRef.current.forEach((timeout) => clearTimeout(timeout));
    progressTimeoutRef.current.clear();
  }, []);

  const deleteFile = async (fileUrl: string): Promise<void> => {
    // fileUrl is the full URL, extract the key after the bucket
    try {
      const url = new URL(fileUrl);
      // /bucket/key -> key
      const key = url.pathname.split('/').slice(2).join('/');
      await s3Client.send(new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      }));
    } catch (error) {
      console.error('Error deleting file from Cloudflare R2:', error);
      throw error;
    }
  };

  const deleteMultipleFiles = async (fileUrls: string[]): Promise<void> => {
    const deletePromises = fileUrls.map(url => deleteFile(url));
    await Promise.all(deletePromises);
  };

  return {
    uploadFile,
    uploadProgress,
    isUploading,
    overallProgress: getOverallProgress(),
    activeUploads: getActiveUploads(),
    activeUploadCount: Object.keys(uploadProgress).length,
    resetProgress,
    deleteFile,
    deleteMultipleFiles,
  };
};

export default useSRKFileUpload;
