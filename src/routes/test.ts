import { Router } from 'express'
import { sendApplicationStatusSms } from '../services/sms-service.js'
import { sendApplicationStatusEmail } from '../services/email-service.js'

const router = Router()

router.post('/sms', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' })
  }
  try {
    const { phone, name, jobTitle, status } = req.body as {
      phone: string
      name: string
      jobTitle: string
      status: string
    }
    await sendApplicationStatusSms(phone, name, jobTitle, status)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

router.post('/email', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' })
  }
  try {
    const { email, name, jobTitle, status } = req.body as {
      email: string
      name: string
      jobTitle: string
      status: string
    }
    await sendApplicationStatusEmail(email, name, jobTitle, status)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

export default router
