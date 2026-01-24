# Authentication System Guide

## Overview

Complete authentication system with signup, sign in, password reset, and email verification.

## API Endpoints

### 1. Sign Up
- **Endpoint**: `POST /api/auth/signup`
- **Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "password123",
    "full_name": "John Doe",
    "phone": "+233 XX XXX XXXX",
    "role": "farm" | "graduate" | "student",
    // Farm-specific
    "farm_name": "Green Valley Farms",
    "farm_type": "small" | "medium" | "large" | "agro_processing" | "research",
    "farm_location": "Ashanti",
    "farm_address": "...",
    // Graduate/Student-specific
    "institution_name": "University of Ghana",
    "institution_type": "university" | "training_college",
    "qualification": "BSc Agriculture",
    "specialization": "crop" | "livestock" | "agribusiness" | "other",
    "graduation_year": 2023,
    "preferred_region": "Ashanti",
    "nss_status": "not_applicable" | "pending" | "active" | "completed" // Students only
  }
  ```
- **Response**: Creates user and profile, sends verification email

### 2. Sign In
- **Endpoint**: `POST /api/auth/signin`
- **Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "password123"
  }
  ```
- **Response**: Returns user, session, and profile

### 3. Sign Out
- **Endpoint**: `POST /api/auth/signout`
- **Response**: Signs out user

### 4. Forgot Password
- **Endpoint**: `POST /api/auth/forgot-password`
- **Body**:
  ```json
  {
    "email": "user@example.com"
  }
  ```
- **Response**: Sends password reset email

### 5. Reset Password
- **Endpoint**: `POST /api/auth/reset-password`
- **Body**:
  ```json
  {
    "password": "newpassword123"
  }
  ```
- **Note**: User must be authenticated via reset token from email

### 6. Verify Email / Resend Verification
- **Endpoint**: `POST /api/auth/verify-email`
- **Body**:
  ```json
  {
    "email": "user@example.com"
  }
  ```
- **Response**: Resends verification email

## UI Pages

### 1. Sign Up Flow
1. `/signup` - Role selection (Farm, Graduate, Student)
2. `/signup/[role]` - Two-step form:
   - Step 1: Account info (email, password, name, phone)
   - Step 2: Role-specific info
3. `/verify-email?email=...` - Email verification page

### 2. Sign In
- `/signin` - Email and password form
- Redirects to `/dashboard/[role]` on success

### 3. Password Reset Flow
1. `/forgot-password` - Enter email
2. User clicks link in email → `/reset-password?access_token=...`
3. User enters new password
4. Redirects to `/signin`

### 4. Email Verification
- `/verify-email?email=...` - Shows verification status
- User clicks link in email → Auto-verifies and redirects to sign in

## Authentication Flow

### Sign Up Flow
```
User → /signup → Select Role → /signup/[role] → Fill Form → 
API Call → Email Sent → /verify-email → Click Link → Verified → /signin
```

### Sign In Flow
```
User → /signin → Enter Credentials → API Call → 
Check Email Verified → Redirect to /dashboard/[role]
```

### Password Reset Flow
```
User → /forgot-password → Enter Email → API Call → 
Email Sent → Click Link → /reset-password → Enter New Password → 
API Call → Redirect to /signin
```

## Security Features

1. **Email Verification**: Required before sign in
2. **Password Requirements**: Minimum 6 characters
3. **Secure Tokens**: Supabase handles token generation and validation
4. **Role-Based Access**: Profile created with correct role
5. **Session Management**: Handled by Supabase Auth

## Database Integration

- **Auth User**: Created in `auth.users` (Supabase)
- **Profile**: Created in `profiles` table with role-specific fields
- **Verification Status**: Tracked in `profiles.is_verified` (admin verification)

## Environment Variables Required

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
NEXT_PUBLIC_SITE_URL=http://localhost:3000  # For email redirects
```

## Supabase Email Templates

Configure in Supabase Dashboard → Authentication → Email Templates:

1. **Confirm signup** - Email verification
2. **Reset password** - Password reset link
3. **Magic link** - (Optional) Passwordless login

## Testing

### Test Sign Up
```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "role": "graduate",
    "institution_name": "Test University",
    "preferred_region": "Ashanti"
  }'
```

### Test Sign In
```bash
curl -X POST http://localhost:3000/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

## Next Steps

After authentication, users are redirected to:
- Farms → `/dashboard/farm`
- Graduates → `/dashboard/graduate`
- Students → `/dashboard/student`

These dashboard pages need to be created next!
