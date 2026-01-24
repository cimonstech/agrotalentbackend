# Domain and Documents Fix

## Issues Fixed

### 1. Domain Name Correction
**Problem**: Domain was incorrectly set as `agrotalentshub.com` (with 's') but actual domain is `agrotalenthub.com` (without 's').

**Fixed**:
- Updated `backend/.env`: `FROM_EMAIL=AgroTalent Hub <notifications@agrotalenthub.com>`
- Email service will now use the correct domain

### 2. Multiple Documents Support
**Problem**: Current schema only supports one document per type (one certificate_url, one cv_url, etc.). Graduates and students need multiple certificates, CVs, etc.

**Solution**: Created a new `documents` table that supports multiple documents per user.

**Migration**: `backend/migrations/006_add_documents_table.sql`
- New `documents` table with fields:
  - `id` (UUID)
  - `user_id` (references profiles)
  - `document_type` (certificate, transcript, cv, nss_letter)
  - `file_name`, `file_url`, `file_size`, `mime_type`
  - `uploaded_at`, `created_at`, `updated_at`
- RLS policies for user access
- Indexes for performance

**New API Route**: `backend/src/routes/documents.js`
- `GET /api/documents` - Get all documents for user (with optional `document_type` filter)
- `POST /api/documents` - Upload a new document
- `DELETE /api/documents/:id` - Delete a document

**Note**: The old `certificate_url`, `transcript_url`, `cv_url`, `nss_letter_url` fields in `profiles` table are kept for backward compatibility, but new uploads should use the `documents` table.

### 3. Email Verification Issue
**Problem**: Email verification emails not being sent after signup.

**Fixed**:
- Changed link generation from `type: 'magiclink'` to `type: 'signup'` for proper verification links
- Added better logging to track email sending
- Email will now be sent with proper verification link

### 4. Profile Creation for All Roles
**Status**: Already working correctly
- Profile creation works for `farm`, `graduate`, and `student` roles
- All role-specific fields are properly saved
- Uses admin client to bypass RLS

## Database Structure

### Users Table
**Note**: Supabase uses `auth.users` table (managed by Supabase Auth). We extend this with the `profiles` table.

- `auth.users` - Managed by Supabase (email, password, etc.)
- `profiles` - Our extension table (role, farm_name, institution_name, etc.)
- `documents` - New table for multiple documents per user

## Next Steps

1. **Run Migration**:
   ```sql
   -- Run in Supabase SQL Editor
   -- backend/migrations/006_add_documents_table.sql
   ```

2. **Update Frontend**:
   - Update document upload UI to use `/api/documents` instead of `/api/profile/upload-document`
   - Update document listing to fetch from `/api/documents`
   - Support multiple documents per type

3. **Test Email Sending**:
   - Sign up a new user
   - Check backend console for "Welcome email sent successfully"
   - Check email inbox for verification email

4. **Test Document Upload**:
   - Upload multiple certificates
   - Upload multiple CVs
   - Verify all documents are saved in `documents` table

## API Usage Examples

### Upload Document
```javascript
const formData = new FormData();
formData.append('file', file);
formData.append('document_type', 'certificate');

const response = await fetch('/api/documents', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

### Get All Documents
```javascript
const response = await fetch('/api/documents', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
const { documents } = await response.json();
```

### Get Documents by Type
```javascript
const response = await fetch('/api/documents?document_type=certificate', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

### Delete Document
```javascript
const response = await fetch(`/api/documents/${documentId}`, {
  method: 'DELETE',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```
