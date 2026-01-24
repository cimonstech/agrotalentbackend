# Signup Fixes - RLS and Resend Issues

## Issues Fixed

### 1. RLS Policy Error (42501)
**Problem**: Profile creation was failing because Row Level Security (RLS) policies were blocking the insert, even though we were using the admin client to create the user.

**Solution**: Changed profile upsert to use `supabaseAdmin` (admin client) instead of `supabase` (regular client). The admin client bypasses RLS policies.

**File**: `backend/src/routes/auth.js`
```javascript
// Before (line 115):
const { error: profileError } = await supabase
  .from('profiles')
  .upsert(profileData, ...)

// After:
const { error: profileError } = await supabaseAdmin
  .from('profiles')
  .upsert(profileData, ...)
```

### 2. Resend Domain Not Verified (403)
**Problem**: Resend API was rejecting emails because `agrotalentshub.com` domain is not verified in Resend.

**Solution**: 
1. Changed default `FROM_EMAIL` to use Resend's test domain `onboarding@resend.dev` (works immediately)
2. Updated all email functions to return `{ success: boolean, error?: string }` instead of throwing
3. Updated all email call sites to handle failures gracefully (log warning, don't fail signup)

**Files**:
- `backend/src/services/email-service.js` - Changed default FROM_EMAIL and return values
- `backend/src/routes/auth.js` - Updated to handle email failures gracefully

## Configuration

### Option 1: Use Resend Test Domain (Current - Works Immediately)
```env
FROM_EMAIL=onboarding@resend.dev
```
✅ Works immediately, no setup required
⚠️ Emails come from `onboarding@resend.dev` (not your domain)

### Option 2: Verify Your Domain (Recommended for Production)
1. Go to https://resend.com/domains
2. Add `agrotalentshub.com`
3. Add the DNS records Resend provides
4. Wait for verification
5. Update `.env`:
```env
FROM_EMAIL=AgroTalent Hub <notifications@agrotalentshub.com>
```

## Current Behavior

1. **Signup Flow**:
   - User created with email auto-confirmed ✅
   - Profile created using admin client (bypasses RLS) ✅
   - Welcome email sent via Resend (if fails, logs warning but doesn't block signup) ✅
   - User can sign in immediately ✅

2. **Email Failures**:
   - All email failures are logged as warnings
   - Signup/authentication continues even if email fails
   - User can still use Supabase's default email verification if Resend fails

## Testing

1. **Test Signup**:
   ```bash
   # Sign up a new user
   # Should create user + profile successfully
   # Should log email warning if domain not verified (but signup succeeds)
   ```

2. **Verify Profile Creation**:
   ```sql
   -- Check Supabase dashboard
   SELECT * FROM profiles WHERE email = 'test@example.com';
   -- Should show full profile data
   ```

3. **Check Email Logs**:
   ```bash
   # Check backend console
   # Should see either:
   # - "Verification email sent to ..." (success)
   # - "Welcome email failed to send: ..." (warning, but signup succeeded)
   ```

## Next Steps

1. **For Development**: Current setup works with `onboarding@resend.dev`
2. **For Production**: Verify `agrotalentshub.com` domain in Resend and update `FROM_EMAIL` in `.env`
