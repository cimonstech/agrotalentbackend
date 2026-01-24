# Cloudflare R2 Setup Guide

## Step 1: Create R2 Bucket

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **R2** → **Create bucket**
3. Name your bucket: `agrotalent-documents`
4. Choose a location (closest to your users)
5. Create the bucket

## Step 2: Create API Token

1. In Cloudflare Dashboard → **R2** → **Manage R2 API Tokens**
2. Click **Create API Token**
3. Set permissions:
   - **Object Read & Write**
   - **Bucket**: Select your bucket (`agrotalent-documents`)
4. Copy the **Access Key ID** and **Secret Access Key**
5. Save these securely (you won't see the secret again!)

## Step 3: Get R2 Endpoint

Your R2 endpoint will be:
```
https://<account-id>.r2.cloudflarestorage.com
```

To find your account ID:
1. Go to Cloudflare Dashboard → **R2**
2. Look at the URL or check your account settings
3. The account ID is in the format: `abc123def456...`

## Step 4: Configure Environment Variables

Add to `backend/.env`:

```env
# Cloudflare R2 Configuration
R2_ENDPOINT=https://<your-account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your_access_key_id_here
R2_SECRET_ACCESS_KEY=your_secret_access_key_here
R2_BUCKET_NAME=agrotalent-documents
R2_PUBLIC_URL=https://your-custom-domain.com  # Optional
```

## Step 5: (Optional) Set Up Custom Domain

For public file access, you can set up a custom domain:

1. In R2 bucket settings → **Public Access**
2. Add a custom domain (e.g., `files.agrotalentshub.com`)
3. Update DNS records as instructed
4. Use this domain in `R2_PUBLIC_URL`

**Note:** Without a custom domain, files will use presigned URLs (valid for 1 year).

## Step 6: Install Dependencies

```bash
cd backend
npm install
```

The required packages are already in `package.json`:
- `@aws-sdk/client-s3` - R2 is S3-compatible
- `@aws-sdk/s3-request-presigner` - For presigned URLs
- `multer` - For handling file uploads

## Step 7: Test Upload

Start your backend server:
```bash
npm run dev
```

Test the upload endpoint:
```bash
curl -X POST http://localhost:3001/api/profile/upload-document \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@/path/to/test.pdf" \
  -F "type=certificate"
```

## File Structure in R2

Files are stored as:
```
{user_id}/{document_type}_{timestamp}.{ext}
```

Example:
```
abc123-user-id/certificate_1706123456789.pdf
abc123-user-id/transcript_1706123456790.pdf
abc123-user-id/cv_1706123456791.pdf
abc123-user-id/nss_letter_1706123456792.pdf
```

## Security Notes

1. **Access Control**: R2 buckets are private by default
2. **Presigned URLs**: Files use presigned URLs (expire after 1 year)
3. **Custom Domain**: If using custom domain, ensure proper CORS settings
4. **File Validation**: Server validates file type and size (5MB max)

## Troubleshooting

### Error: "Access Denied"
- Check your R2 API token permissions
- Verify bucket name matches `R2_BUCKET_NAME`
- Ensure Access Key ID and Secret are correct

### Error: "Invalid endpoint"
- Verify `R2_ENDPOINT` format: `https://<account-id>.r2.cloudflarestorage.com`
- Check your Cloudflare account ID

### Files not accessible
- If using custom domain, check DNS settings
- Presigned URLs are valid for 1 year
- Check CORS settings if accessing from browser

## Cost

Cloudflare R2 pricing:
- **Storage**: $0.015 per GB/month
- **Class A Operations** (writes): $4.50 per million
- **Class B Operations** (reads): $0.36 per million
- **Egress**: Free (no egress fees!)

Much cheaper than AWS S3 for high egress!
