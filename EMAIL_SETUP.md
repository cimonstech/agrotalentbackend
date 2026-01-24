# Email Setup with Resend

## ✅ What's Been Done

1. **Created Email Service** (`backend/src/services/email-service.js`)
   - Responsive HTML email templates
   - Email verification emails
   - Password reset emails
   - Uses Resend API

2. **Updated Auth Routes**
   - Signup now sends verification email via Resend
   - Forgot password uses Resend
   - Verify email resend uses Resend

3. **Email Templates**
   - Responsive design (mobile-friendly)
   - Branded with AgroTalent Hub colors
   - Professional layout
   - Fallback text links

## 📧 Email Templates

### Verification Email
- Subject: "Verify Your Email - AgroTalent Hub"
- Includes verification button
- Fallback link if button doesn't work
- 24-hour expiration notice

### Password Reset Email
- Subject: "Reset Your Password - AgroTalent Hub"
- Includes reset button
- Fallback link
- 1-hour expiration notice

## 🔧 Configuration

Make sure these are set in `backend/.env`:

```env
RESEND_API_KEY=re_E8mxeajE_HvzMLhtM5hbK3ZckXLL5ArpZ
FROM_EMAIL=AgroTalent Hub <notifications@agrotalentshub.com>
NEXT_PUBLIC_SITE_URL=http://localhost:3000  # or your production URL
```

## 🚀 How It Works

1. **Signup Flow:**
   - User signs up → Auth user created
   - Trigger creates basic profile
   - API route updates profile with full details
   - Resend sends verification email with link
   - User clicks link → Email verified

2. **Password Reset Flow:**
   - User requests reset → Admin generates link
   - Resend sends reset email with link
   - User clicks link → Can set new password

3. **Resend Verification:**
   - User requests new verification email
   - Admin generates new link
   - Resend sends email

## 📝 Next Steps

1. **Run RLS Migration:**
   ```sql
   -- Run backend/migrations/005_fix_profile_rls_policies.sql in Supabase
   ```

2. **Test Email Sending:**
   - Sign up a new user
   - Check email inbox
   - Verify the email looks good

3. **Customize Email (Optional):**
   - Edit templates in `backend/src/services/email-service.js`
   - Update colors, branding, content

## 🎨 Email Template Features

- ✅ Fully responsive (mobile-friendly)
- ✅ Professional design
- ✅ Brand colors (#2d5016, #4a7c2a)
- ✅ Clear call-to-action buttons
- ✅ Fallback text links
- ✅ Footer with contact info
- ✅ Works in all email clients

## 🔍 Troubleshooting

### Emails not sending?
- Check `RESEND_API_KEY` is correct
- Verify `FROM_EMAIL` domain is verified in Resend
- Check Resend dashboard for errors

### RLS Policy Error?
- Run migration `005_fix_profile_rls_policies.sql`
- This adds UPDATE policy for profiles

### Email links not working?
- Check `NEXT_PUBLIC_SITE_URL` is correct
- Verify frontend routes handle verification
