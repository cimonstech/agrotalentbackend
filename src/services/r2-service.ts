import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { errorMessage } from '../lib/errors.js';
import { createReadStream, unlinkSync } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'agrotalent-documents';

let r2Client: S3Client | null = null;

function getR2Client(): S3Client {
  if (!r2Client) {
    const endpoint = process.env.R2_ENDPOINT;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error('R2 is not configured. Please set R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY');
    }
    r2Client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }
  return r2Client;
}

export async function uploadToR2(
  key: string,
  source: Buffer | string,
  contentType: string
): Promise<string> {
  try {
    const client = getR2Client();
    const body = typeof source === 'string' ? createReadStream(source) : source;
    if (typeof source === 'string') {
      await stat(source);
    }
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    });

    await client.send(command);
    if (typeof source === 'string') {
      try {
        unlinkSync(source);
      } catch (cleanupErr) {
        console.warn('Failed to cleanup temp upload file:', cleanupErr);
      }
    }

    if (process.env.R2_PUBLIC_URL) {
      const publicUrl = process.env.R2_PUBLIC_URL.startsWith('http')
        ? process.env.R2_PUBLIC_URL
        : `https://${process.env.R2_PUBLIC_URL}`;
      return `${publicUrl}/${key}`;
    }

    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    return await getSignedUrl(client, getCommand, { expiresIn: 31536000 });
  } catch (error) {
    if (typeof source === 'string') {
      try {
        unlinkSync(source);
      } catch {
        // ignore cleanup errors
      }
    }
    console.error('R2 upload error:', error);
    throw new Error(`Failed to upload to R2: ${errorMessage(error)}`);
  }
}

export function generateR2Key(folder: string, originalFilename: string): string {
  const ext = path.extname(originalFilename).toLowerCase();
  const safeExt = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx'].includes(ext) ? ext : '.bin';
  return folder + '/' + crypto.randomUUID() + safeExt;
}

export async function deleteFromR2(fileName: string): Promise<void> {
  try {
    const client = getR2Client();
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileName,
    });

    await client.send(command);
  } catch (error) {
    console.error('R2 delete error:', error);
    throw new Error(`Failed to delete from R2: ${errorMessage(error)}`);
  }
}

export async function getPresignedUrl(fileName: string, expiresIn = 3600): Promise<string> {
  try {
    const client = getR2Client();
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileName,
    });

    return await getSignedUrl(client, command, { expiresIn });
  } catch (error) {
    console.error('R2 presigned URL error:', error);
    throw new Error(`Failed to generate presigned URL: ${errorMessage(error)}`);
  }
}
