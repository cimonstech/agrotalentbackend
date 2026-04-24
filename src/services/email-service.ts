// Email service using Resend for sending emails
//
// IMPORTANT (ESM + dotenv):
// Do NOT snapshot process.env at module load time. In ESM, imports are evaluated
// before server.js runs dotenv.config(), so top-level env reads can be undefined.

import { Resend } from 'resend';
import { errorMessage } from '../lib/errors.js';

const EMAIL_FROM_NOREPLY = 'AgroTalent Hub <noreply@agrotalenthub.com>';

function escapeEmailHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getFrontendBaseUrl(): string {
  return String(process.env.FRONTEND_URL || '').replace(/\/+$/, '');
}

export interface NotificationEmailOptions {
  ctaText?: string;
  ctaUrl?: string;
  role?: string;
}

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

function getDashboardPathForRole(role: string): string {
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

function toAbsoluteUrl(siteUrl: string, urlOrPath: string | undefined): string {
  if (!urlOrPath) return siteUrl;
  if (typeof urlOrPath !== 'string') return siteUrl;
  if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) return urlOrPath;
  const path = urlOrPath.startsWith('/') ? urlOrPath : `/${urlOrPath}`;
  return `${siteUrl}${path}`;
}

async function logEmailSend(params: {
  recipient_email: string
  recipient_name?: string
  subject: string
  type: string
  status: 'sent' | 'failed'
  error_message?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    const { getSupabaseAdminClient } = await import('../lib/supabase.js')
    const supabase = getSupabaseAdminClient()
    await supabase.from('email_logs').insert({
      recipient_email: params.recipient_email,
      recipient_name: params.recipient_name ?? null,
      subject: params.subject,
      type: params.type,
      status: params.status,
      error_message: params.error_message ?? null,
      metadata: params.metadata ?? {},
      sent_at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Failed to log email:', err)
  }
}

/**
 * Send email verification email
 */
export async function sendVerificationEmail(
  email: string,
  token: string,
  fullName = ''
): Promise<{ success: boolean; error?: string; messageId?: string }> {
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
    return { success: false, error: errorMessage(error) || 'Failed to send email' };
  }
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  email: string,
  resetLink: string,
  fullName = ''
): Promise<{ success: boolean; error?: string; messageId?: string }> {
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
    return { success: false, error: errorMessage(error) || 'Failed to send email' };
  }
}

/**
 * Send general notification email (for profile verification, etc.)
 */
export async function sendNotificationEmail(
  email: string,
  subject: string,
  message: string,
  fullName = '',
  options: NotificationEmailOptions = {}
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  const RESEND_API_KEY = getResendApiKey();
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not configured. Notification email not sent.');
    return { success: false, error: 'Email service not configured' };
  }

  const SITE_URL = getSiteUrl();
  const ctaText = options.ctaText || 'Open Dashboard';
  const ctaUrl = toAbsoluteUrl(
    SITE_URL,
    options.ctaUrl || getDashboardPathForRole(options.role ?? '')
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
    return { success: false, error: errorMessage(error) || 'Failed to send email' };
  }
}

export async function sendWelcomeEmail(
  userEmail: string,
  userName: string,
  role: string
): Promise<void> {
  const subject = 'Welcome to AgroTalent Hub'
  try {
    const key = getResendApiKey();
    if (!key) {
      console.error('RESEND_API_KEY not configured');
      return;
    }
    const resend = new Resend(key);
    const safeName = escapeEmailHtml(userName);
    const base = getFrontendBaseUrl();
    const dashboardUrl = `${base}/dashboard`;
    let bodyText =
      'Welcome to AgroTalent Hub.';
    if (role === 'farm') {
      bodyText =
        'Your farm account is now active. Post your first job and start finding verified agricultural talent across Ghana.';
    } else if (role === 'graduate' || role === 'student' || role === 'skilled') {
      bodyText =
        'Your profile is now active. Browse available jobs and apply to roles matched to your region and qualifications.';
    }
    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Welcome</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="100%" style="max-width:560px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background:#1A6B3C;padding:20px 24px;">
              <p style="margin:0;font-size:18px;font-weight:bold;color:#ffffff;">AgroTalent Hub</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px;">
              <h1 style="margin:0 0 16px;font-size:20px;color:#0D3320;">Hi ${safeName},</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">${escapeEmailHtml(bodyText)}</p>
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td style="border-radius:8px;background:#1A6B3C;">
                  <a href="${escapeEmailHtml(dashboardUrl)}" style="display:inline-block;padding:14px 24px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">Open dashboard</a>
                </td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px 24px;">
              <p style="margin:0;font-size:12px;color:#6b7280;">AgroTalent Hub | Accra, Ghana</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
    await resend.emails.send({
      from: EMAIL_FROM_NOREPLY,
      to: userEmail,
      subject,
      html,
    });
    await logEmailSend({
      recipient_email: userEmail,
      recipient_name: userName,
      subject,
      type: 'welcome',
      status: 'sent',
    })
  } catch (error) {
    await logEmailSend({
      recipient_email: userEmail,
      recipient_name: userName,
      subject,
      type: 'welcome',
      status: 'failed',
      error_message: errorMessage(error) || 'Unknown error',
    })
    console.error('sendWelcomeEmail error:', error);
  }
}

export async function sendApplicationReceivedEmail(
  farmEmail: string,
  farmName: string,
  applicantName: string,
  jobTitle: string
): Promise<void> {
  const subject = 'New Application Received - ' + jobTitle
  try {
    const key = getResendApiKey();
    if (!key) {
      console.error('RESEND_API_KEY not configured');
      return;
    }
    const resend = new Resend(key);
    const base = getFrontendBaseUrl();
    const appsUrl = `${base}/dashboard/farm/applications`;
    const safeFarm = escapeEmailHtml(farmName);
    const safeApplicant = escapeEmailHtml(applicantName);
    const safeJob = escapeEmailHtml(jobTitle);
    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>New application</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="100%" style="max-width:560px;border:1px solid #e5e7eb;border-radius:8px;">
          <tr>
            <td style="background:#1A6B3C;padding:20px 24px;">
              <p style="margin:0;font-size:18px;font-weight:bold;color:#ffffff;">AgroTalent Hub</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px;">
              <h1 style="margin:0 0 12px;font-size:18px;color:#0D3320;">New application received</h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">
                ${safeApplicant} has applied for <strong>${safeJob}</strong> (${safeFarm}).
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td style="border-radius:8px;background:#1A6B3C;">
                  <a href="${escapeEmailHtml(appsUrl)}" style="display:inline-block;padding:14px 24px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">View applications</a>
                </td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;">
              <p style="margin:0;font-size:12px;color:#6b7280;">AgroTalent Hub | Accra, Ghana</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
    await resend.emails.send({
      from: EMAIL_FROM_NOREPLY,
      to: farmEmail,
      subject,
      html,
    });
    await logEmailSend({
      recipient_email: farmEmail,
      recipient_name: farmName,
      subject,
      type: 'application_received',
      status: 'sent',
    })
  } catch (error) {
    await logEmailSend({
      recipient_email: farmEmail,
      recipient_name: farmName,
      subject,
      type: 'application_received',
      status: 'failed',
      error_message: errorMessage(error) || 'Unknown error',
      metadata: { applicant_name: applicantName, job_title: jobTitle },
    })
    console.error('sendApplicationReceivedEmail error:', error);
  }
}

export async function sendApplicationStatusEmail(
  applicantEmail: string,
  applicantName: string,
  jobTitle: string,
  status: string,
  reviewNotes?: string
): Promise<void> {
  const subject = 'Application Update - ' + jobTitle
  try {
    const key = getResendApiKey();
    if (!key) {
      console.error('RESEND_API_KEY not configured');
      return;
    }
    const resend = new Resend(key);
    const base = getFrontendBaseUrl();
    const appsUrl = `${base}/dashboard/graduate/applications`;
    const safeName = escapeEmailHtml(applicantName);
    const safeJob = escapeEmailHtml(jobTitle);
    const s = String(status).toLowerCase();
    let statusMessage = 'Your application status has been updated to: ' + status;
    if (s === 'reviewed') {
      statusMessage = 'Your application has been reviewed by the farm.';
    } else if (s === 'shortlisted') {
      statusMessage = 'Congratulations! You have been shortlisted for this role.';
    } else if (s === 'accepted') {
      statusMessage = 'Great news! Your application has been accepted.';
    } else if (s === 'rejected') {
      statusMessage =
        'Thank you for applying. Unfortunately your application was not successful this time.';
    }
    const notesBlock =
      reviewNotes != null && String(reviewNotes).trim() !== ''
        ? `<div style="margin:20px 0;padding:16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
             <p style="margin:0 0 8px;font-size:12px;font-weight:bold;color:#374151;">Feedback from farm:</p>
             <p style="margin:0;font-size:14px;color:#4b5563;white-space:pre-wrap;">${escapeEmailHtml(reviewNotes)}</p>
           </div>`
        : '';
    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Application update</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="100%" style="max-width:560px;border:1px solid #e5e7eb;border-radius:8px;">
          <tr>
            <td style="background:#1A6B3C;padding:20px 24px;">
              <p style="margin:0;font-size:18px;font-weight:bold;color:#ffffff;">AgroTalent Hub</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px;">
              <h1 style="margin:0 0 12px;font-size:18px;color:#0D3320;">Hi ${safeName},</h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">${escapeEmailHtml(statusMessage)}</p>
              ${notesBlock}
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td style="border-radius:8px;background:#1A6B3C;">
                  <a href="${escapeEmailHtml(appsUrl)}" style="display:inline-block;padding:14px 24px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">View applications</a>
                </td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;">
              <p style="margin:0;font-size:12px;color:#6b7280;">AgroTalent Hub | Accra, Ghana</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
    await resend.emails.send({
      from: EMAIL_FROM_NOREPLY,
      to: applicantEmail,
      subject,
      html,
    });
    await logEmailSend({
      recipient_email: applicantEmail,
      recipient_name: applicantName,
      subject,
      type: 'application_status',
      status: 'sent',
      metadata: { status },
    })
  } catch (error) {
    await logEmailSend({
      recipient_email: applicantEmail,
      recipient_name: applicantName,
      subject,
      type: 'application_status',
      status: 'failed',
      error_message: errorMessage(error) || 'Unknown error',
      metadata: { status },
    })
    console.error('sendApplicationStatusEmail error:', error);
  }
}

export async function sendPlacementConfirmedEmail(
  graduateEmail: string,
  graduateName: string,
  jobTitle: string,
  farmName: string,
  startDate?: string
): Promise<void> {
  const subject = 'Placement Confirmed - ' + jobTitle
  try {
    const key = getResendApiKey();
    if (!key) {
      console.error('RESEND_API_KEY not configured');
      return;
    }
    const resend = new Resend(key);
    const base = getFrontendBaseUrl();
    const placementsUrl = `${base}/dashboard/graduate/placements`;
    const safeGrad = escapeEmailHtml(graduateName);
    const safeJob = escapeEmailHtml(jobTitle);
    const safeFarm = escapeEmailHtml(farmName);
    const startLine =
      startDate != null && String(startDate).trim() !== ''
        ? `<p style="margin:0 0 16px;font-size:15px;color:#374151;"><strong>Start date:</strong> ${escapeEmailHtml(startDate)}</p>`
        : '';
    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Placement confirmed</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="100%" style="max-width:560px;border:1px solid #e5e7eb;border-radius:8px;">
          <tr>
            <td style="background:#1A6B3C;padding:20px 24px;">
              <p style="margin:0;font-size:18px;font-weight:bold;color:#ffffff;">AgroTalent Hub</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px;">
              <h1 style="margin:0 0 12px;font-size:18px;color:#0D3320;">Congratulations, ${safeGrad}!</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#374151;">
                Your placement for <strong>${safeJob}</strong> with <strong>${safeFarm}</strong> is confirmed.
              </p>
              ${startLine}
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td style="border-radius:8px;background:#1A6B3C;">
                  <a href="${escapeEmailHtml(placementsUrl)}" style="display:inline-block;padding:14px 24px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">View placements</a>
                </td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;">
              <p style="margin:0;font-size:12px;color:#6b7280;">AgroTalent Hub | Accra, Ghana</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
    await resend.emails.send({
      from: EMAIL_FROM_NOREPLY,
      to: graduateEmail,
      subject,
      html,
    });
    await logEmailSend({
      recipient_email: graduateEmail,
      recipient_name: graduateName,
      subject,
      type: 'placement_confirmed',
      status: 'sent',
      metadata: { farm_name: farmName, start_date: startDate ?? null },
    })
  } catch (error) {
    await logEmailSend({
      recipient_email: graduateEmail,
      recipient_name: graduateName,
      subject,
      type: 'placement_confirmed',
      status: 'failed',
      error_message: errorMessage(error) || 'Unknown error',
      metadata: { farm_name: farmName, start_date: startDate ?? null },
    })
    console.error('sendPlacementConfirmedEmail error:', error);
  }
}

function formatScheduledAt(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function truncatePreview(value: string, max = 150): string {
  if (value.length <= max) return value
  return value.slice(0, max).trim() + '...'
}

export async function sendTrainingScheduledEmail(
  participantEmail: string,
  participantName: string,
  sessionTitle: string,
  scheduledAt: string,
  zoomLink?: string | null,
  trainerName?: string | null
): Promise<void> {
  const subject = 'Training Session Scheduled: ' + sessionTitle
  const trainingUrl = `${getFrontendBaseUrl()}/dashboard/graduate/training`
  const safeName = escapeEmailHtml(participantName)
  const safeTitle = escapeEmailHtml(sessionTitle)
  const safeTime = escapeEmailHtml(formatScheduledAt(scheduledAt))
  const safeTrainer = trainerName ? escapeEmailHtml(trainerName) : ''
  try {
    const key = getResendApiKey()
    if (!key) {
      console.error('RESEND_API_KEY not configured')
      return
    }
    const resend = new Resend(key)
    const html = `
<!DOCTYPE html>
<html lang='en'>
<body style='margin:0;padding:0;background:#fff;font-family:Arial,sans-serif;'>
  <table role='presentation' width='100%' cellpadding='0' cellspacing='0'>
    <tr><td align='center' style='padding:24px 16px;'>
      <table role='presentation' width='100%' style='max-width:560px;border:1px solid #e5e7eb;border-radius:8px;'>
        <tr><td style='background:#0D3320;padding:20px 24px;'><p style='margin:0;font-size:18px;font-weight:bold;color:#fff;'>AgroTalent Hub</p></td></tr>
        <tr><td style='padding:28px 24px;'>
          <h1 style='margin:0 0 12px;font-size:18px;color:#0D3320;'>Hi ${safeName},</h1>
          <p style='margin:0 0 12px;font-size:15px;color:#374151;'>A training session has been scheduled for you.</p>
          <p style='margin:0 0 8px;font-size:14px;color:#374151;'><strong>Session:</strong> ${safeTitle}</p>
          <p style='margin:0 0 8px;font-size:14px;color:#374151;'><strong>Date and Time:</strong> ${safeTime}</p>
          ${safeTrainer ? `<p style='margin:0 0 16px;font-size:14px;color:#374151;'><strong>Trainer:</strong> ${safeTrainer}</p>` : ''}
          ${
            zoomLink
              ? `<table role='presentation' cellpadding='0' cellspacing='0' style='margin-bottom:12px;'><tr><td style='border-radius:8px;background:#1A6B3C;'><a href='${escapeEmailHtml(zoomLink)}' style='display:inline-block;padding:12px 20px;font-size:14px;font-weight:bold;color:#fff;text-decoration:none;'>Join Zoom Session</a></td></tr></table>`
              : `<p style='margin:0 0 12px;font-size:14px;color:#6b7280;'>Location details will be shared closer to the date.</p>`
          }
          <table role='presentation' cellpadding='0' cellspacing='0'><tr><td style='border-radius:8px;background:#1A6B3C;'><a href='${escapeEmailHtml(trainingUrl)}' style='display:inline-block;padding:12px 20px;font-size:14px;font-weight:bold;color:#fff;text-decoration:none;'>View Training</a></td></tr></table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
    await resend.emails.send({
      from: EMAIL_FROM_NOREPLY,
      to: participantEmail,
      subject,
      html
    })
    await logEmailSend({
      recipient_email: participantEmail,
      recipient_name: participantName,
      subject,
      type: 'training_scheduled',
      status: 'sent'
    })
  } catch (error) {
    await logEmailSend({
      recipient_email: participantEmail,
      recipient_name: participantName,
      subject,
      type: 'training_scheduled',
      status: 'failed',
      error_message: errorMessage(error) || 'Unknown error'
    })
    console.error('sendTrainingScheduledEmail error:', error)
  }
}

export async function sendNoticePostedEmail(
  recipientEmail: string,
  recipientName: string,
  noticeTitle: string,
  noticeAudience: string,
  noticeLink: string
): Promise<void> {
  const subject = 'New Notice: ' + noticeTitle
  const safeName = escapeEmailHtml(recipientName)
  const safeTitle = escapeEmailHtml(noticeTitle)
  const safeAudience = escapeEmailHtml(noticeAudience)
  try {
    const key = getResendApiKey()
    if (!key) {
      console.error('RESEND_API_KEY not configured')
      return
    }
    const resend = new Resend(key)
    const html = `
<!DOCTYPE html>
<html lang='en'>
<body style='margin:0;padding:0;background:#fff;font-family:Arial,sans-serif;'>
  <table role='presentation' width='100%' cellpadding='0' cellspacing='0'>
    <tr><td align='center' style='padding:24px 16px;'>
      <table role='presentation' width='100%' style='max-width:560px;border:1px solid #e5e7eb;border-radius:8px;'>
        <tr><td style='background:#0D3320;padding:20px 24px;'><p style='margin:0;font-size:18px;font-weight:bold;color:#fff;'>AgroTalent Hub</p></td></tr>
        <tr><td style='padding:28px 24px;'>
          <h1 style='margin:0 0 12px;font-size:18px;color:#0D3320;'>Hi ${safeName},</h1>
          <p style='margin:0 0 12px;font-size:15px;color:#374151;'>A new notice has been posted for ${safeAudience} users.</p>
          <p style='margin:0 0 18px;font-size:15px;color:#111827;'><strong>${safeTitle}</strong></p>
          <table role='presentation' cellpadding='0' cellspacing='0'><tr><td style='border-radius:8px;background:#1A6B3C;'><a href='${escapeEmailHtml(noticeLink)}' style='display:inline-block;padding:12px 20px;font-size:14px;font-weight:bold;color:#fff;text-decoration:none;'>Read Notice</a></td></tr></table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
    await resend.emails.send({
      from: EMAIL_FROM_NOREPLY,
      to: recipientEmail,
      subject,
      html
    })
    await logEmailSend({
      recipient_email: recipientEmail,
      recipient_name: recipientName,
      subject,
      type: 'notice_posted',
      status: 'sent'
    })
  } catch (error) {
    await logEmailSend({
      recipient_email: recipientEmail,
      recipient_name: recipientName,
      subject,
      type: 'notice_posted',
      status: 'failed',
      error_message: errorMessage(error) || 'Unknown error'
    })
    console.error('sendNoticePostedEmail error:', error)
  }
}

export async function sendNewMessageEmail(
  recipientEmail: string,
  recipientName: string,
  senderName: string,
  messagePreview: string,
  conversationLink: string
): Promise<void> {
  const subject = 'New message from ' + senderName
  const safeName = escapeEmailHtml(recipientName)
  const safeSender = escapeEmailHtml(senderName)
  const safePreview = escapeEmailHtml(truncatePreview(messagePreview, 150))
  try {
    const key = getResendApiKey()
    if (!key) {
      console.error('RESEND_API_KEY not configured')
      return
    }
    const resend = new Resend(key)
    const html = `
<!DOCTYPE html>
<html lang='en'>
<body style='margin:0;padding:0;background:#fff;font-family:Arial,sans-serif;'>
  <table role='presentation' width='100%' cellpadding='0' cellspacing='0'>
    <tr><td align='center' style='padding:24px 16px;'>
      <table role='presentation' width='100%' style='max-width:560px;border:1px solid #e5e7eb;border-radius:8px;'>
        <tr><td style='background:#0D3320;padding:20px 24px;'><p style='margin:0;font-size:18px;font-weight:bold;color:#fff;'>AgroTalent Hub</p></td></tr>
        <tr><td style='padding:28px 24px;'>
          <h1 style='margin:0 0 12px;font-size:18px;color:#0D3320;'>Hi ${safeName},</h1>
          <p style='margin:0 0 12px;font-size:15px;color:#374151;'>You have a new message from ${safeSender}.</p>
          <div style='margin:0 0 18px;padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;font-size:14px;color:#374151;'>${safePreview}</div>
          <table role='presentation' cellpadding='0' cellspacing='0'><tr><td style='border-radius:8px;background:#1A6B3C;'><a href='${escapeEmailHtml(conversationLink)}' style='display:inline-block;padding:12px 20px;font-size:14px;font-weight:bold;color:#fff;text-decoration:none;'>Reply Now</a></td></tr></table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
    await resend.emails.send({
      from: EMAIL_FROM_NOREPLY,
      to: recipientEmail,
      subject,
      html
    })
    await logEmailSend({
      recipient_email: recipientEmail,
      recipient_name: recipientName,
      subject,
      type: 'new_message',
      status: 'sent'
    })
  } catch (error) {
    await logEmailSend({
      recipient_email: recipientEmail,
      recipient_name: recipientName,
      subject,
      type: 'new_message',
      status: 'failed',
      error_message: errorMessage(error) || 'Unknown error'
    })
    console.error('sendNewMessageEmail error:', error)
  }
}

export async function sendPaymentConfirmedEmail(
  farmEmail: string,
  farmName: string,
  amount: number,
  currency: string,
  jobTitle: string,
  graduateName: string,
  paymentReference: string
): Promise<void> {
  const subject = 'Payment Confirmed - ' + jobTitle
  const placementsUrl = `${getFrontendBaseUrl()}/dashboard/farm/placements`
  try {
    const key = getResendApiKey()
    if (!key) {
      console.error('RESEND_API_KEY not configured')
      return
    }
    const resend = new Resend(key)
    const html = `
<!DOCTYPE html>
<html lang='en'>
<body style='margin:0;padding:0;background:#fff;font-family:Arial,sans-serif;'>
  <table role='presentation' width='100%' cellpadding='0' cellspacing='0'>
    <tr><td align='center' style='padding:24px 16px;'>
      <table role='presentation' width='100%' style='max-width:560px;border:1px solid #e5e7eb;border-radius:8px;'>
        <tr><td style='background:#0D3320;padding:20px 24px;'><p style='margin:0;font-size:18px;font-weight:bold;color:#fff;'>AgroTalent Hub</p></td></tr>
        <tr><td style='padding:28px 24px;'>
          <h1 style='margin:0 0 12px;font-size:18px;color:#0D3320;'>Hi ${escapeEmailHtml(farmName)},</h1>
          <p style='margin:0 0 12px;font-size:15px;color:#374151;'>Your recruitment fee payment has been confirmed.</p>
          <p style='margin:0 0 8px;font-size:14px;color:#374151;'><strong>Amount:</strong> ${escapeEmailHtml(currency)} ${escapeEmailHtml(amount)}</p>
          <p style='margin:0 0 8px;font-size:14px;color:#374151;'><strong>Position:</strong> ${escapeEmailHtml(jobTitle)}</p>
          <p style='margin:0 0 8px;font-size:14px;color:#374151;'><strong>Candidate:</strong> ${escapeEmailHtml(graduateName)}</p>
          <p style='margin:0 0 18px;font-size:14px;color:#374151;'><strong>Reference:</strong> ${escapeEmailHtml(paymentReference)}</p>
          <table role='presentation' cellpadding='0' cellspacing='0'><tr><td style='border-radius:8px;background:#1A6B3C;'><a href='${escapeEmailHtml(placementsUrl)}' style='display:inline-block;padding:12px 20px;font-size:14px;font-weight:bold;color:#fff;text-decoration:none;'>View Placement</a></td></tr></table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
    await resend.emails.send({
      from: EMAIL_FROM_NOREPLY,
      to: farmEmail,
      subject,
      html
    })
    await logEmailSend({
      recipient_email: farmEmail,
      recipient_name: farmName,
      subject,
      type: 'payment_confirmed',
      status: 'sent'
    })
  } catch (error) {
    await logEmailSend({
      recipient_email: farmEmail,
      recipient_name: farmName,
      subject,
      type: 'payment_confirmed',
      status: 'failed',
      error_message: errorMessage(error) || 'Unknown error'
    })
    console.error('sendPaymentConfirmedEmail error:', error)
  }
}

export async function sendDocumentReviewedEmail(
  userEmail: string,
  userName: string,
  documentType: string,
  fileName: string,
  status: 'approved' | 'rejected',
  rejectionReason?: string | null
): Promise<void> {
  const subject = status === 'approved'
    ? 'Document Approved: ' + fileName
    : 'Document Update: ' + fileName
  const profileUrl = `${getFrontendBaseUrl()}/dashboard/graduate/profile`
  const uploadUrl = `${getFrontendBaseUrl()}/dashboard/graduate/documents`
  try {
    const key = getResendApiKey()
    if (!key) {
      console.error('RESEND_API_KEY not configured')
      return
    }
    const resend = new Resend(key)
    const approved = status === 'approved'
    const html = `
<!DOCTYPE html>
<html lang='en'>
<body style='margin:0;padding:0;background:#fff;font-family:Arial,sans-serif;'>
  <table role='presentation' width='100%' cellpadding='0' cellspacing='0'>
    <tr><td align='center' style='padding:24px 16px;'>
      <table role='presentation' width='100%' style='max-width:560px;border:1px solid #e5e7eb;border-radius:8px;'>
        <tr><td style='background:#0D3320;padding:20px 24px;'><p style='margin:0;font-size:18px;font-weight:bold;color:#fff;'>AgroTalent Hub</p></td></tr>
        <tr><td style='padding:28px 24px;'>
          <h1 style='margin:0 0 12px;font-size:18px;color:#0D3320;'>Hi ${escapeEmailHtml(userName)},</h1>
          ${
            approved
              ? `<p style='margin:0 0 12px;font-size:15px;color:#374151;'>Your ${escapeEmailHtml(documentType)} document has been approved. Your profile verification is progressing.</p>
                 <p style='margin:0 0 16px;font-size:22px;color:#16a34a;'>✓</p>`
              : `<p style='margin:0 0 12px;font-size:15px;color:#374151;'>Your ${escapeEmailHtml(documentType)} document could not be approved.</p>
                 ${
                   rejectionReason
                     ? `<div style='margin:0 0 12px;padding:12px;border:1px solid #fecaca;border-radius:8px;background:#fef2f2;font-size:14px;color:#b91c1c;'><strong>Reason:</strong> ${escapeEmailHtml(rejectionReason)}</div>`
                     : ''
                 }
                 <p style='margin:0 0 16px;font-size:14px;color:#374151;'>Please upload a new document that meets the requirements.</p>`
          }
          <table role='presentation' cellpadding='0' cellspacing='0'><tr><td style='border-radius:8px;background:#1A6B3C;'><a href='${escapeEmailHtml(approved ? profileUrl : uploadUrl)}' style='display:inline-block;padding:12px 20px;font-size:14px;font-weight:bold;color:#fff;text-decoration:none;'>${approved ? 'View Profile' : 'Upload New Document'}</a></td></tr></table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
    await resend.emails.send({
      from: EMAIL_FROM_NOREPLY,
      to: userEmail,
      subject,
      html
    })
    await logEmailSend({
      recipient_email: userEmail,
      recipient_name: userName,
      subject,
      type: 'document_reviewed',
      status: 'sent',
      metadata: { document_type: documentType, status }
    })
  } catch (error) {
    await logEmailSend({
      recipient_email: userEmail,
      recipient_name: userName,
      subject,
      type: 'document_reviewed',
      status: 'failed',
      error_message: errorMessage(error) || 'Unknown error',
      metadata: { document_type: documentType, status }
    })
    console.error('sendDocumentReviewedEmail error:', error)
  }
}
