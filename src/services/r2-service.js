import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Cloudflare R2 is S3-compatible
const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT, // e.g., https://<account-id>.r2.cloudflarestorage.com
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'agrotalent-documents';

/**
 * Upload file to R2
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} fileName - File name/path
 * @param {string} contentType - MIME type
 * @returns {Promise<string>} Public URL
 */
export async function uploadToR2(fileBuffer, fileName, contentType) {
  if (!r2Client) {
    throw new Error('R2 is not configured. Please set R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY');
  }

  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileName,
      Body: fileBuffer,
      ContentType: contentType,
    });

    await r2Client.send(command);

    // Return public URL (if you have a custom domain) or use presigned URL
    if (process.env.R2_PUBLIC_URL) {
      return `${process.env.R2_PUBLIC_URL}/${fileName}`;
    }

    // Generate presigned URL (valid for 1 year)
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileName,
    });

    const url = await getSignedUrl(r2Client, getCommand, { expiresIn: 31536000 }); // 1 year
    return url;
  } catch (error) {
    console.error('R2 upload error:', error);
    throw new Error(`Failed to upload to R2: ${error.message}`);
  }
}

/**
 * Delete file from R2
 * @param {string} fileName - File name/path
 */
export async function deleteFromR2(fileName) {
  if (!r2Client) {
    throw new Error('R2 is not configured');
  }

  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileName,
    });

    await r2Client.send(command);
  } catch (error) {
    console.error('R2 delete error:', error);
    throw new Error(`Failed to delete from R2: ${error.message}`);
  }
}

/**
 * Generate presigned URL for file access
 * @param {string} fileName - File name/path
 * @param {number} expiresIn - Expiration in seconds (default: 1 hour)
 * @returns {Promise<string>} Presigned URL
 */
export async function getPresignedUrl(fileName, expiresIn = 3600) {
  if (!r2Client) {
    throw new Error('R2 is not configured');
  }

  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileName,
    });

    return await getSignedUrl(r2Client, command, { expiresIn });
  } catch (error) {
    console.error('R2 presigned URL error:', error);
    throw new Error(`Failed to generate presigned URL: ${error.message}`);
  }
}
