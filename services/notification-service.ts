/**
 * Notification Service
 * 
 * Handles sending notifications via:
 * - In-app notifications (database)
 * - Email notifications
 * - SMS notifications (optional)
 */

import { SupabaseClient } from '@supabase/supabase-js'

export type NotificationType = 
  | 'job_posted'
  | 'application_received'
  | 'application_status'
  | 'match_found'
  | 'training_scheduled'
  | 'payment_required'
  | 'placement_confirmed'

export interface NotificationData {
  userId: string
  type: NotificationType
  title: string
  message: string
  link?: string
  sendEmail?: boolean
  sendSMS?: boolean
}

export class NotificationService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Create and send a notification
   */
  async sendNotification(data: NotificationData): Promise<string> {
    // Create in-app notification
    const { data: notification, error } = await this.supabase
      .from('notifications')
      .insert({
        user_id: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        link: data.link || null
      })
      .select()
      .single()

    if (error) throw error

    // Send email if requested
    if (data.sendEmail) {
      await this.sendEmailNotification(data)
    }

    // Send SMS if requested
    if (data.sendSMS) {
      await this.sendSMSNotification(data)
    }

    return notification.id
  }

  /**
   * Send email notification
   */
  private async sendEmailNotification(data: NotificationData): Promise<void> {
    // Get user email
    const { data: profile } = await this.supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', data.userId)
      .single()

    if (!profile?.email) return

    // Send email via Resend
    try {
      const resendApiKey = process.env.RESEND_API_KEY
      if (!resendApiKey) {
        console.warn('RESEND_API_KEY not configured, skipping email')
        return
      }

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://agrotalentshub.com'
      const emailHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: Ubuntu, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #1f7a4d; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #f6f8f7; padding: 30px; border-radius: 0 0 8px 8px; }
              .button { display: inline-block; padding: 12px 24px; background: #1f7a4d; color: white; text-decoration: none; border-radius: 6px; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>AgroTalent Hub</h1>
              </div>
              <div class="content">
                <h2>${data.title}</h2>
                <p>${data.message}</p>
                ${data.link ? `<a href="${siteUrl}${data.link}" class="button">View Details</a>` : ''}
                <p style="margin-top: 30px; font-size: 12px; color: #666;">
                  This is an automated notification from AgroTalent Hub.<br>
                  If you have any questions, please contact us at info@agrotalentshub.com
                </p>
              </div>
            </div>
          </body>
        </html>
      `

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'AgroTalent Hub <notifications@agrotalentshub.com>',
          to: profile.email,
          subject: data.title,
          html: emailHtml
        })
      })
    } catch (error) {
      console.error('Failed to send email:', error)
      // Don't throw - email failure shouldn't break the notification
    }
  }

  /**
   * Send SMS notification
   */
  private async sendSMSNotification(data: NotificationData): Promise<void> {
    // Get user phone
    const { data: profile } = await this.supabase
      .from('profiles')
      .select('phone')
      .eq('id', data.userId)
      .single()

    if (!profile?.phone) return

    // TODO: Integrate with SMS service (Twilio, Termii, etc.)
    console.log(`SMS notification to ${profile.phone}: ${data.message}`)
    
    // Example: Call SMS API
    // await fetch('https://api.termii.com/api/sms/send', {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json'
    //   },
    //   body: JSON.stringify({
    //     to: profile.phone,
    //     from: process.env.SMS_SENDER_ID,
    //     sms: data.message,
    //     type: 'plain',
    //     channel: 'generic',
    //     api_key: process.env.TERMII_API_KEY
    //   })
    // })
  }

  /**
   * Notify farm when application is received
   */
  async notifyFarmOnApplication(jobId: string, applicantId: string): Promise<void> {
    const { data: job } = await this.supabase
      .from('jobs')
      .select('farm_id, title')
      .eq('id', jobId)
      .single()

    if (!job) return

    const { data: applicant } = await this.supabase
      .from('profiles')
      .select('full_name')
      .eq('id', applicantId)
      .single()

    await this.sendNotification({
      userId: job.farm_id,
      type: 'application_received',
      title: 'New Application Received',
      message: `${applicant?.full_name || 'A graduate'} has applied for your job: ${job.title}`,
      link: `/dashboard/jobs/${jobId}/applications`,
      sendEmail: true // Send email to farm
    })
  }

  /**
   * Notify applicant when application status changes
   */
  async notifyApplicantOnStatusChange(
    applicationId: string,
    status: string
  ): Promise<void> {
    const { data: application } = await this.supabase
      .from('applications')
      .select(`
        applicant_id,
        jobs:job_id (
          title
        )
      `)
      .eq('id', applicationId)
      .single()

    if (!application) return

    const statusMessages: Record<string, string> = {
      reviewing: 'Your application is being reviewed',
      shortlisted: 'Congratulations! You have been shortlisted',
      accepted: 'Congratulations! Your application has been accepted',
      rejected: 'Your application was not selected for this position'
    }

    await this.sendNotification({
      userId: application.applicant_id,
      type: 'application_status',
      title: 'Application Status Updated',
      message: `${statusMessages[status] || 'Your application status has changed'} for: ${application.jobs?.title}`,
      link: `/dashboard/applications/${applicationId}`,
      sendEmail: true,
      sendSMS: status === 'accepted' // Send SMS for important updates
    })
  }

  /**
   * Notify matching graduates about new job
   */
  async notifyMatchingGraduates(jobId: string, graduateIds: string[]): Promise<void> {
    const { data: job } = await this.supabase
      .from('jobs')
      .select('title, location, job_type')
      .eq('id', jobId)
      .single()

    if (!job) return

    for (const graduateId of graduateIds) {
      await this.sendNotification({
        userId: graduateId,
        type: 'match_found',
        title: 'New Job Match Found',
        message: `A new ${job.job_type} position in ${job.location} matches your profile: ${job.title}`,
        link: `/jobs/${jobId}`,
        sendEmail: false // Don't spam emails, just in-app notification
      })
    }
  }
}
