import express from 'express'
import { authenticate } from '../middleware/auth.js'
import type { AuthRequest } from '../types/auth.js'
import { recordFarmConversion } from '../services/farmConversion.js'

const router = express.Router()

router.post('/convert-preview', authenticate, async (req, res) => {
  try {
    const authReq = req as AuthRequest
    const farmId = authReq.user?.id
    const { token } = req.body as { token?: string }

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Token is required' })
    }

    if (!farmId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const result = await recordFarmConversion(token, farmId)

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    return res.json({ success: true, jobId: result.jobId })
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }
})

export default router
