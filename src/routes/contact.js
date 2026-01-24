import express from 'express';
import { getSupabaseClient } from '../lib/supabase.js';

const router = express.Router();

// Email addresses
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || 'AgroTalent Hub <notifications@agrotalenthub.com>';

// POST /api/contact - Submit contact form
router.post('/', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { name, email, phone, subject, message } = req.body;
    
    if (!name || !email || !message) {
      return res.status(400).json({
        error: 'Name, email, and message are required'
      });
    }
    
    // Store in database
    const { data: submission, error: dbError } = await supabase
      .from('contact_submissions')
      .insert({
        name,
        email,
        phone: phone || null,
        subject: subject || null,
        message,
        status: 'new'
      })
      .select()
      .single();
    
    if (dbError) {
      console.warn('Contact submissions table not found:', dbError.message);
    }
    
    // Send email via Resend
    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: NOTIFICATION_EMAIL,
            to: 'info@agrotalenthub.com',
            replyTo: email,
            subject: `Contact Form: ${subject || 'General Inquiry'}`,
            html: `
              <h2>New Contact Form Submission</h2>
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Email:</strong> ${email}</p>
              ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ''}
              ${subject ? `<p><strong>Subject:</strong> ${subject}</p>` : ''}
              <p><strong>Message:</strong></p>
              <p>${message.replace(/\n/g, '<br>')}</p>
            `
          })
        });
      } catch (emailError) {
        console.error('Failed to send contact email:', emailError);
      }
    }
    
    return res.json({
      message: 'Thank you for contacting us. We will get back to you soon!'
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Failed to submit contact form'
    });
  }
});

export default router;
