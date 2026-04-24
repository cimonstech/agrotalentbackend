import { Router, type Request, type Response } from 'express'
import axios from 'axios'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { getSupabaseAdminClient } from '../lib/supabase.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import type { AuthRequest } from '../types/auth.js'
import { validate } from '../lib/validate.js'
import { initiatePaymentSchema, verifyPaymentSchema } from '../lib/schemas.js'
import { sendPaymentConfirmedEmail } from '../services/email-service.js'
import { sendPaymentConfirmedSms } from '../services/sms-service.js'

const router = Router()
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY ?? ''
const PLACEMENT_FEE_PESEWAS = 20000

const supabase = () => getSupabaseAdminClient()

async function triggerPaymentConfirmedEmail(payment: any): Promise<void> {
  if (!payment?.placement_id) return
  const db = supabase()
  const { data: placement } = await db
    .from('placements')
    .select('job_id, farm_id, graduate_id')
    .eq('id', payment.placement_id)
    .maybeSingle()
  if (!placement) return
  const [{ data: job }, { data: farm }, { data: graduate }] = await Promise.all([
    db.from('jobs').select('title').eq('id', placement.job_id).maybeSingle(),
    db.from('profiles').select('email, phone, farm_name, full_name').eq('id', placement.farm_id).maybeSingle(),
    db.from('profiles').select('full_name').eq('id', placement.graduate_id).maybeSingle()
  ])
  if (!farm?.email) return
  void sendPaymentConfirmedEmail(
    farm.email,
    farm.farm_name ?? farm.full_name ?? 'Farm',
    Number(payment.amount ?? 0),
    payment.currency ?? 'GHS',
    job?.title ?? 'Placement',
    graduate?.full_name ?? 'Graduate',
    payment.paystack_reference ?? payment.payment_reference ?? 'N/A'
  ).catch(console.error)
  if (farm?.phone) {
    void sendPaymentConfirmedSms(
      farm.phone,
      farm.farm_name ?? farm.full_name ?? 'Farm',
      Number(payment.amount ?? 0),
      payment.currency ?? 'GHS',
      job?.title ?? 'Placement'
    ).catch(console.error)
  }
}

router.post(
  '/initiate',
  requireAuth,
  requireRole('farm'),
  validate(initiatePaymentSchema),
  async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const placementId = req.body.placement_id as string;

    const { data: placement, error: placementError } = await supabase()
      .from('placements')
      .select('*')
      .eq('id', placementId)
      .single();

    if (placementError || !placement) {
      return res.status(404).json({ error: 'Placement not found' });
    }

    if (placement.farm_id !== authReq.user.id) {
      return res.status(403).json({ error: 'Not your placement' });
    }

    const { data: existingPayment } = await supabase()
      .from('payments')
      .select('id, status')
      .eq('placement_id', placementId)
      .in('status', ['pending', 'paid'])
      .maybeSingle();

    if (existingPayment?.status === 'paid') {
      return res.status(409).json({ success: false, error: 'Placement fee already paid' });
    }
    if (existingPayment?.status === 'pending') {
      return res.status(200).json({
        success: true,
        data: { message: 'Payment already initiated', payment_id: existingPayment.id }
      });
    }

    const reference = 'ATH-' + uuidv4();
    const frontend = String(process.env.FRONTEND_URL ?? '').replace(/\/+$/, '');
    const callbackUrl = `${frontend}/dashboard/farm/placements`;

    let paystackData: {
      data?: { authorization_url?: string; reference?: string };
      message?: string;
    };

    try {
      const paystackRes = await axios.post(
        'https://api.paystack.co/transaction/initialize',
        {
          email: authReq.user.email ?? '',
          amount: PLACEMENT_FEE_PESEWAS,
          reference,
          currency: 'GHS',
          callback_url: callbackUrl,
        },
        {
          headers: {
            Authorization: 'Bearer ' + PAYSTACK_SECRET,
            'Content-Type': 'application/json',
          },
        }
      );
      paystackData = paystackRes.data;
    } catch (e) {
      console.error('Paystack initialize error:', e);
      return res.status(502).json({ error: 'Payment provider error' });
    }

    const authUrl = paystackData?.data?.authorization_url;
    if (!authUrl) {
      return res.status(502).json({ error: 'Payment provider error' });
    }

    const { error: insertError } = await supabase().from('payments').insert({
      placement_id: placementId,
      farm_id: authReq.user.id,
      amount: 200,
      currency: 'GHS',
      status: 'pending',
      paystack_reference: reference,
    });

    if (insertError) {
      console.error('Payment insert error:', insertError);
      return res.status(500).json({ error: insertError.message || 'Failed to record payment' });
    }

    return res.json({
      success: true,
      data: { authorization_url: authUrl, reference },
    });
  } catch (error) {
    console.error('[POST /payments/initiate]', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/verify', requireAuth, validate(verifyPaymentSchema), async (req, res) => {
  try {
    const reference = req.body.reference as string

    let paystackData: { data?: { status?: string; channel?: string | null } };
    try {
      const paystackRes = await axios.get(
        'https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference),
        {
          headers: {
            Authorization: 'Bearer ' + PAYSTACK_SECRET,
          },
        }
      );
      paystackData = paystackRes.data;
    } catch (e) {
      console.error('Paystack verify error:', e);
      return res.status(502).json({ error: 'Payment provider error' });
    }

    if (paystackData?.data?.status !== 'success') {
      return res.status(400).json({ error: 'Payment not successful' });
    }

    const paidAt = new Date().toISOString();
    const channel = paystackData.data?.channel ?? null;

    const { data: payment, error: payError } = await supabase()
      .from('payments')
      .update({
        status: 'paid',
        paid_at: paidAt,
        payment_method: channel,
      })
      .eq('paystack_reference', reference)
      .select()
      .single();

    if (payError || !payment) {
      console.error('Payment update error:', payError);
      return res.status(400).json({ error: 'Payment record not found' });
    }

    await supabase()
      .from('placements')
      .update({
        recruitment_fee_paid: true,
        recruitment_fee_paid_at: paidAt,
      })
      .eq('id', payment.placement_id);

    await triggerPaymentConfirmedEmail(payment)

    return res.json({ success: true, data: payment });
  } catch (error) {
    console.error('[POST /payments/verify]', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export async function paymentsWebhookHandler(req: Request, res: Response): Promise<void> {
  try {
    const rawBody = req.body as Buffer;
    if (!Buffer.isBuffer(rawBody)) {
      res.status(400).json({ error: 'Invalid body' });
      return;
    }

    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET)
      .update(rawBody)
      .digest('hex');

    const sigHeader = req.headers['x-paystack-signature'];
    const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;

    if (!sig || hash !== sig) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const payload = JSON.parse(rawBody.toString()) as {
      event?: string;
      data?: { reference?: string; status?: string; channel?: string | null };
    };

    if (payload.event === 'charge.success' && payload.data?.reference) {
      const reference = payload.data.reference;
      const paidAt = new Date().toISOString();
      const channel = payload.data.channel ?? null;

      const { data: payment } = await supabase()
        .from('payments')
        .update({
          status: 'paid',
          paid_at: paidAt,
          payment_method: channel,
        })
        .eq('paystack_reference', reference)
        .select()
        .single();

      if (payment?.placement_id) {
        await supabase()
          .from('placements')
          .update({
            recruitment_fee_paid: true,
            recruitment_fee_paid_at: paidAt,
          })
          .eq('id', payment.placement_id);
        await triggerPaymentConfirmedEmail(payment)
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('paymentsWebhookHandler error:', error);
    res.status(500).json({ error: 'Webhook error' });
  }
}

export default router;
