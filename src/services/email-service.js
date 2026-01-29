// Email service using Resend for sending emails
//
// IMPORTANT (ESM + dotenv):
// Do NOT snapshot process.env at module load time. In ESM, imports are evaluated
// before server.js runs dotenv.config(), so top-level env reads can be undefined.

function getResendApiKey() {
  return process.env.RESEND_API_KEY;
}

function getVerificationFromEmail() {
  return process.env.VERIFICATION_EMAIL || 'AgroTalent Hub <noreply@agrotalenthub.com>';
}

function getNotificationFromEmail() {
  return process.env.NOTIFICATION_EMAIL || 'AgroTalent Hub <notifications@agrotalenthub.com>';
}

function getSiteUrl() {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.FRONTEND_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
    'http://localhost:3000';

  // Normalize: strip trailing slashes
  return String(raw).replace(/\/+$/, '');
}

function getLogoUrl() {
  // Logo should be hosted on R2/CDN for email templates
  // Update this to your R2/CDN URL when logo is uploaded
  return process.env.LOGO_URL || 
         process.env.NEXT_PUBLIC_LOGO_URL || 
         `${getSiteUrl()}/agrotalent-logo.webp`;
}

function getDashboardPathForRole(role) {
  // Note: we do NOT have /dashboard (it 404s). Dashboards are role-specific.
  switch (role) {
    case 'admin':
      return '/dashboard/admin';
    case 'farm':
      return '/dashboard/farm';
    case 'student':
      return '/dashboard/student';
    case 'graduate':
      return '/dashboard/graduate';
    case 'worker':
      // Worker dashboard not implemented yet; use applicant dashboard for now.
      return '/dashboard/graduate';
    default:
      // Safe default: send them to sign in.
      return '/signin';
  }
}

function toAbsoluteUrl(siteUrl, urlOrPath) {
  if (!urlOrPath) return siteUrl;
  if (typeof urlOrPath !== 'string') return siteUrl;
  if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) return urlOrPath;
  const path = urlOrPath.startsWith('/') ? urlOrPath : `/${urlOrPath}`;
  return `${siteUrl}${path}`;
}

/**
 * Send email verification email
 */
export async function sendVerificationEmail(email, token, fullName = '') {
  const RESEND_API_KEY = getResendApiKey();
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not configured. Email verification email not sent.');
    return { success: false, error: 'Email service not configured' };
  }

  // Use the full Supabase verification link if provided (includes access_token in hash)
  // Otherwise construct a link with the token
  const SITE_URL = getSiteUrl();
  const verificationLink = token.startsWith('http')
    ? token 
    : `${SITE_URL}/verify-email?token=${token}&type=signup&email=${encodeURIComponent(email)}`;
  
  const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email - AgroTalent Hub</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f4f4f4;
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
    }
    .email-header {
      background: linear-gradient(135deg, #2d5016 0%, #4a7c2a 100%);
      padding: 40px 20px;
      text-align: center;
    }
    .email-header h1 {
      color: #ffffff;
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 10px;
    }
    .email-header p {
      color: #e8f5e9;
      font-size: 16px;
    }
    .email-body {
      padding: 40px 30px;
    }
    .greeting {
      font-size: 18px;
      color: #2d5016;
      margin-bottom: 20px;
      font-weight: 600;
    }
    .content {
      font-size: 16px;
      color: #555;
      margin-bottom: 30px;
      line-height: 1.8;
    }
    .button-container {
      text-align: center;
      margin: 40px 0;
    }
    .verify-button {
      display: inline-block;
      padding: 16px 40px;
      background: linear-gradient(135deg, #2d5016 0%, #4a7c2a 100%);
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      box-shadow: 0 4px 6px rgba(45, 80, 22, 0.2);
      transition: transform 0.2s;
    }
    .verify-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 12px rgba(45, 80, 22, 0.3);
    }
    .link-fallback {
      margin-top: 20px;
      padding: 20px;
      background-color: #f9f9f9;
      border-radius: 8px;
      border-left: 4px solid #4a7c2a;
    }
    .link-fallback p {
      font-size: 14px;
      color: #666;
      margin-bottom: 10px;
    }
    .link-fallback a {
      color: #2d5016;
      word-break: break-all;
      font-size: 13px;
    }
    .email-footer {
      background-color: #f9f9f9;
      padding: 30px;
      text-align: center;
      border-top: 1px solid #e0e0e0;
    }
    .email-footer p {
      font-size: 14px;
      color: #666;
      margin-bottom: 10px;
    }
    .email-footer a {
      color: #2d5016;
      text-decoration: none;
    }
    .social-links {
      margin-top: 20px;
    }
    .social-links a {
      display: inline-block;
      margin: 0 10px;
      color: #4a7c2a;
      text-decoration: none;
    }
    @media only screen and (max-width: 600px) {
      .email-body {
        padding: 30px 20px;
      }
      .email-header {
        padding: 30px 20px;
      }
      .email-header h1 {
        font-size: 24px;
      }
      .verify-button {
        padding: 14px 30px;
        font-size: 15px;
      }
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <img src="${getLogoUrl()}" alt="AgroTalent Hub" style="max-width: 120px; height: auto; margin-bottom: 15px;" />
      <h1 style="color: #ffffff; font-size: 28px; font-weight: 700; margin-bottom: 10px;">AgroTalent Hub</h1>
      <p>Verify Your Email Address</p>
    </div>
    
    <div class="email-body">
      <div class="greeting">
        ${fullName ? `Hello ${fullName},` : 'Hello,'}
      </div>
      
      <div class="content">
        <p>Thank you for signing up for AgroTalent Hub! We're excited to have you join our community of agricultural professionals.</p>
        
        <p>To complete your registration and start exploring job opportunities, please verify your email address by clicking the button below:</p>
      </div>
      
      <div class="button-container">
        <a href="${verificationLink}" class="verify-button">Verify Email Address</a>
      </div>
      
      <div class="link-fallback">
        <p><strong>Button not working?</strong> Copy and paste this link into your browser:</p>
        <a href="${verificationLink}">${verificationLink}</a>
      </div>
      
      <div class="content">
        <p><strong>This link will expire in 24 hours.</strong></p>
        <p>If you didn't create an account with AgroTalent Hub, please ignore this email.</p>
      </div>
    </div>
    
    <div class="email-footer">
      <p><strong>AgroTalent Hub</strong></p>
      <p>Connecting Agricultural Professionals with Opportunities</p>
      <p>
        <a href="${SITE_URL}">Visit our website</a> | 
        <a href="${SITE_URL}/contact">Contact Support</a>
      </p>
      <div class="social-links">
        <p style="font-size: 12px; color: #999; margin-top: 20px;">
          © ${new Date().getFullYear()} AgroTalent Hub. All rights reserved.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
  `;

  const emailText = `
Hello${fullName ? ` ${fullName}` : ''},

Thank you for signing up for AgroTalent Hub! We're excited to have you join our community of agricultural professionals.

To complete your registration and start exploring job opportunities, please verify your email address by visiting this link:

${verificationLink}

This link will expire in 24 hours.

If you didn't create an account with AgroTalent Hub, please ignore this email.

Best regards,
AgroTalent Hub Team
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: getVerificationFromEmail(),
        to: email,
        subject: 'Verify Your Email - AgroTalent Hub',
        html: emailHtml,
        text: emailText,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to send email' }));
      console.error('Resend API error:', error);
      return { success: false, error: error.message || 'Failed to send email' };
    }

    const data = await response.json();
    return { success: true, messageId: data.id };
  } catch (error) {
    console.error('Error sending verification email:', error);
    return { success: false, error: error.message || 'Failed to send email' };
  }
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(email, resetLink, fullName = '') {
  const RESEND_API_KEY = getResendApiKey();
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not configured. Password reset email not sent.');
    return { success: false, error: 'Email service not configured' };
  }

  const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password - AgroTalent Hub</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f4f4f4;
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
    }
    .email-header {
      background: linear-gradient(135deg, #2d5016 0%, #4a7c2a 100%);
      padding: 40px 20px;
      text-align: center;
    }
    .email-header h1 {
      color: #ffffff;
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 10px;
    }
    .email-body {
      padding: 40px 30px;
    }
    .greeting {
      font-size: 18px;
      color: #2d5016;
      margin-bottom: 20px;
      font-weight: 600;
    }
    .content {
      font-size: 16px;
      color: #555;
      margin-bottom: 30px;
      line-height: 1.8;
    }
    .button-container {
      text-align: center;
      margin: 40px 0;
    }
    .reset-button {
      display: inline-block;
      padding: 16px 40px;
      background: linear-gradient(135deg, #2d5016 0%, #4a7c2a 100%);
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      box-shadow: 0 4px 6px rgba(45, 80, 22, 0.2);
    }
    .link-fallback {
      margin-top: 20px;
      padding: 20px;
      background-color: #f9f9f9;
      border-radius: 8px;
      border-left: 4px solid #4a7c2a;
    }
    .link-fallback p {
      font-size: 14px;
      color: #666;
      margin-bottom: 10px;
    }
    .link-fallback a {
      color: #2d5016;
      word-break: break-all;
      font-size: 13px;
    }
    .email-footer {
      background-color: #f9f9f9;
      padding: 30px;
      text-align: center;
      border-top: 1px solid #e0e0e0;
    }
    .email-footer p {
      font-size: 14px;
      color: #666;
    }
    @media only screen and (max-width: 600px) {
      .email-body {
        padding: 30px 20px;
      }
      .email-header {
        padding: 30px 20px;
      }
      .email-header h1 {
        font-size: 24px;
      }
      .reset-button {
        padding: 14px 30px;
        font-size: 15px;
      }
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <img src="${getLogoUrl()}" alt="AgroTalent Hub" style="max-width: 120px; height: auto; margin-bottom: 15px;" />
      <h1 style="color: #ffffff; font-size: 28px; font-weight: 700; margin-bottom: 10px;">AgroTalent Hub</h1>
      <p>Reset Your Password</p>
    </div>
    
    <div class="email-body">
      <div class="greeting">
        ${fullName ? `Hello ${fullName},` : 'Hello,'}
      </div>
      
      <div class="content">
        <p>We received a request to reset your password for your AgroTalent Hub account.</p>
        
        <p>Click the button below to reset your password:</p>
      </div>
      
      <div class="button-container">
        <a href="${resetLink}" class="reset-button">Reset Password</a>
      </div>
      
      <div class="link-fallback">
        <p><strong>Button not working?</strong> Copy and paste this link into your browser:</p>
        <a href="${resetLink}">${resetLink}</a>
      </div>
      
      <div class="content">
        <p><strong>This link will expire in 1 hour.</strong></p>
        <p>If you didn't request a password reset, please ignore this email. Your password will remain unchanged.</p>
      </div>
    </div>
    
    <div class="email-footer">
      <p><strong>AgroTalent Hub</strong></p>
      <p>© ${new Date().getFullYear()} AgroTalent Hub. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: getVerificationFromEmail(),
        to: email,
        subject: 'Reset Your Password - AgroTalent Hub',
        html: emailHtml,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to send email' }));
      return { success: false, error: error.message || 'Failed to send email' };
    }

    const data = await response.json();
    return { success: true, messageId: data.id };
  } catch (error) {
    console.error('Error sending password reset email:', error);
    return { success: false, error: error.message || 'Failed to send email' };
  }
}

/**
 * Send general notification email (for profile verification, etc.)
 */
export async function sendNotificationEmail(
  email,
  subject,
  message,
  fullName = '',
  options = {}
) {
  const RESEND_API_KEY = getResendApiKey();
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not configured. Notification email not sent.');
    return { success: false, error: 'Email service not configured' };
  }

  const SITE_URL = getSiteUrl();
  const ctaText = options?.ctaText || 'Open Dashboard';
  const ctaUrl = toAbsoluteUrl(
    SITE_URL,
    options?.ctaUrl || getDashboardPathForRole(options?.role)
  );
  const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f4f4f4;
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
    }
    .email-header {
      background: linear-gradient(135deg, #2d5016 0%, #4a7c2a 100%);
      padding: 40px 20px;
      text-align: center;
    }
    .email-header h1 {
      color: #ffffff;
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 10px;
    }
    .email-body {
      padding: 40px 30px;
    }
    .greeting {
      font-size: 18px;
      color: #2d5016;
      margin-bottom: 20px;
      font-weight: 600;
    }
    .content {
      font-size: 16px;
      color: #555;
      margin-bottom: 30px;
      line-height: 1.8;
      white-space: pre-line;
    }
    .button-container {
      text-align: center;
      margin: 40px 0;
    }
    .action-button {
      display: inline-block;
      padding: 16px 40px;
      background: linear-gradient(135deg, #2d5016 0%, #4a7c2a 100%);
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      box-shadow: 0 4px 6px rgba(45, 80, 22, 0.2);
    }
    .email-footer {
      background-color: #f9f9f9;
      padding: 30px;
      text-align: center;
      border-top: 1px solid #e0e0e0;
    }
    .email-footer p {
      font-size: 14px;
      color: #666;
      margin-bottom: 10px;
    }
    @media only screen and (max-width: 600px) {
      .email-body {
        padding: 30px 20px;
      }
      .email-header {
        padding: 30px 20px;
      }
      .email-header h1 {
        font-size: 24px;
      }
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <img src="${getLogoUrl()}" alt="AgroTalent Hub" style="max-width: 120px; height: auto; margin-bottom: 15px;" />
      <h1 style="color: #ffffff; font-size: 28px; font-weight: 700; margin-bottom: 10px;">AgroTalent Hub</h1>
      <p style="color: #e8f5e9; font-size: 16px;">${subject}</p>
    </div>
    
    <div class="email-body">
      <div class="greeting">
        ${fullName ? `Hello ${fullName},` : 'Hello,'}
      </div>
      
      <div class="content">
${message}
      </div>
      
      <div class="button-container">
        <a href="${ctaUrl}" class="action-button">${ctaText}</a>
      </div>
    </div>
    
    <div class="email-footer">
      <p><strong>AgroTalent Hub</strong></p>
      <p>Connecting Agricultural Professionals with Opportunities</p>
      <p>
        <a href="${SITE_URL}" style="color: #2d5016; text-decoration: none;">Visit our website</a> | 
        <a href="${SITE_URL}/contact" style="color: #2d5016; text-decoration: none;">Contact Support</a>
      </p>
      <p style="font-size: 12px; color: #999; margin-top: 20px;">
        © ${new Date().getFullYear()} AgroTalent Hub. All rights reserved.
      </p>
    </div>
  </div>
</body>
</html>
  `;

  const emailText = `
Hello${fullName ? ` ${fullName}` : ''},

${message}

Best regards,
AgroTalent Hub Team
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: getNotificationFromEmail(),
        to: email,
        subject: subject,
        html: emailHtml,
        text: emailText,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to send email' }));
      console.error('Resend API error:', error);
      return { success: false, error: error.message || 'Failed to send email' };
    }

    const data = await response.json();
    return { success: true, messageId: data.id };
  } catch (error) {
    console.error('Error sending notification email:', error);
    return { success: false, error: error.message || 'Failed to send email' };
  }
}
