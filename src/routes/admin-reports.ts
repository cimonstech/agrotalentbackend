import { Router } from 'express';
import { getSupabaseAdminClient } from '../lib/supabase.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { queryParamToString } from '../lib/query.js';
import { errorMessage } from '../lib/errors.js'

const router = Router();

// GET /api/admin/reports - Generate reports
router.get('/reports', authenticate, requireAdmin, async (req, res) => {
  try {
    // Use admin client to bypass RLS
    const supabase = getSupabaseAdminClient();
    const reportType = queryParamToString(req.query.type) || 'overview';
    const startDate = queryParamToString(req.query.start_date);
    const endDate = queryParamToString(req.query.end_date);
    
    const report: Record<string, unknown> = {};
    
    if (reportType === 'overview' || reportType === 'all') {
      // Parallelize all count queries for better performance
      const [
        { count: totalUsers },
        { count: farms },
        { count: graduates },
        { count: students },
        { count: verified },
        { count: activeJobs },
        { count: totalApplications },
        { count: activePlacements },
        { count: completedPlacements }
      ] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'farm'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'graduate'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'student'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('is_verified', true),
        supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('applications').select('*', { count: 'exact', head: true }),
        supabase.from('placements').select('*', { count: 'exact', head: true }).in('status', ['active', 'training']),
        supabase.from('placements').select('*', { count: 'exact', head: true }).eq('status', 'completed')
      ]);
      
      report.overview = {
        total_users: totalUsers || 0,
        farms: farms || 0,
        graduates: graduates || 0,
        students: students || 0,
        verified_users: verified || 0,
        active_jobs: activeJobs || 0,
        total_applications: totalApplications || 0,
        active_placements: activePlacements || 0,
        completed_placements: completedPlacements || 0
      };
    }
    
    if (reportType === 'regional' || reportType === 'all') {
      const { data: regionalData } = await supabase
        .from('placements')
        .select(`
          jobs:job_id (
            location
          )
        `)
        .in('status', ['active', 'completed']);
      
      const regionalStats: Record<string, number> = {};
      regionalData?.forEach((placement: { jobs?: { location?: string } | { location?: string }[] | null }) => {
        const jobsRel = placement.jobs;
        const jobRow = Array.isArray(jobsRel) ? jobsRel[0] : jobsRel;
        const region = jobRow?.location || 'Unknown';
        regionalStats[region] = (regionalStats[region] || 0) + 1;
      });
      
      report.regional = regionalStats;
    }
    
    if (reportType === 'payments' || reportType === 'all') {
      let paymentQuery = supabase
        .from('payments')
        .select('amount, status, created_at');
      
      if (startDate) {
        paymentQuery = paymentQuery.gte('created_at', startDate);
      }
      if (endDate) {
        paymentQuery = paymentQuery.lte('created_at', endDate);
      }
      
      const { data: payments } = await paymentQuery;
      
      const totalRevenue = payments?.reduce((sum: number, p: { status: string; amount: unknown }) => {
        return sum + (p.status === 'completed' ? parseFloat(String(p.amount)) : 0);
      }, 0) || 0;
      
      const pendingPayments = payments?.filter((p: { status: string }) => p.status === 'pending').length || 0;
      const completedPayments = payments?.filter((p: { status: string }) => p.status === 'completed').length || 0;
      
      report.payments = {
        total_revenue: totalRevenue,
        pending_payments: pendingPayments,
        completed_payments: completedPayments,
        total_payments: payments?.length || 0
      };
    }
    
    if (reportType === 'training' || reportType === 'all') {
      const { count: totalSessions } = await supabase
        .from('training_sessions')
        .select('*', { count: 'exact', head: true });
      
      const { count: attendanceRecords } = await supabase
        .from('training_attendance')
        .select('*', { count: 'exact', head: true })
        .eq('attended', true);
      
      report.training = {
        total_sessions: totalSessions || 0,
        total_attendance: attendanceRecords || 0
      };
    }
    
    return res.json({ report });
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

// GET /api/admin/contact - Get contact submissions
router.get('/contact', authenticate, requireAdmin, async (req, res) => {
  try {
    // Use admin client to bypass RLS
    const supabase = getSupabaseAdminClient();
    const statusParam = queryParamToString(req.query.status);
    
    let query = supabase
      .from('contact_submissions')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (statusParam) {
      query = query.eq('status', statusParam);
    }
    
    const { data: submissions, error } = await query;
    
    if (error) {
      if (error.message.includes('does not exist')) {
        return res.json({ submissions: [] });
      }
      throw error;
    }
    
    return res.json({ submissions: submissions || [] });
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

// GET /api/admin/payments - List payments (Admin only)
router.get('/payments', authenticate, requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabaseAdminClient();
    const status = queryParamToString(req.query.status);
    const startDate = queryParamToString(req.query.start_date);
    const endDate = queryParamToString(req.query.end_date);
    const page = parseInt(queryParamToString(req.query.page) || '1', 10);
    const limit = parseInt(queryParamToString(req.query.limit) || '50', 10);
    const offset = (page - 1) * limit;

    let query = supabase
      .from('payments')
      .select(
        `
        *,
        placements:placement_id (
          id,
          status,
          jobs:job_id ( id, title, location ),
          farm:farm_id ( id, farm_name, email )
        )
      `,
        { count: 'exact' }
      )
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate);

    query = query.range(offset, offset + limit - 1);

    const { data: payments, error, count } = await query;
    if (error) throw error;

    return res.json({
      payments: payments || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Admin payments fetch error:', error);
    return res.status(500).json({ error: errorMessage(error) || 'Failed to fetch payments' });
  }
});

export default router;

