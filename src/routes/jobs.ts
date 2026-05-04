import express from 'express'
import { getSupabaseClient, getSupabaseAdminClient } from '../lib/supabase.js'
import { authenticate } from '../middleware/auth.js'
import type { AuthRequest } from '../types/auth.js'
import { errorMessage } from '../lib/errors.js'
import { validate, validateQuery } from '../lib/validate.js'
import {
  createJobSchema,
  updateJobSchema,
  jobsListQuerySchema,
} from '../lib/schemas.js'
const router = express.Router();

// --- simple in-memory cache for job list queries ---
type CacheEntry = { data: unknown; expiresAt: number }
const listCache = new Map<string, CacheEntry>()
const JOB_LIST_CACHE_TTL_MS = 60_000 // 60 seconds

function cacheGet(key: string): unknown | null {
  const entry = listCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { listCache.delete(key); return null }
  return entry.data
}

function cacheSet(key: string, data: unknown): void {
  listCache.set(key, { data, expiresAt: Date.now() + JOB_LIST_CACHE_TTL_MS })
}

function cacheInvalidate(): void { listCache.clear() }
// ---------------------------------------------------

const jobListSelect = `
        *,
        profiles:farm_id (
          id,
          farm_name,
          farm_location,
          farm_type
        )
      `;

// Simple in-memory cache for the unfiltered public jobs list (keyed by page:limit)
const publicJobsCache = new Map<string, { data: unknown; cachedAt: number }>()
const CACHE_TTL_MS = 60 * 1000 // 60 seconds

router.get('/public', async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient()

    const search = (req.query.search as string | undefined)?.trim() ?? ''
    const type = (req.query.type as string | undefined)?.trim() ?? ''
    const page = parseInt((req.query.page as string | undefined) ?? '1', 10)
    const limit = parseInt((req.query.limit as string | undefined) ?? '12', 10)
    const offset = (page - 1) * limit

    const isFiltered = search.length > 0 || type.length > 0

    const cacheKey = `${page}:${limit}`
    const cached = publicJobsCache.get(cacheKey)
    if (!isFiltered && cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return res.json(cached.data)
    }

    let query = supabaseAdmin
      .from('jobs')
      .select(
        `
        id,
        title,
        job_type,
        location,
        city,
        salary_min,
        salary_max,
        salary_currency,
        is_sourced_job,
        is_platform_job,
        created_at,
        image_url,
        required_specialization,
        profiles:farm_id (
          farm_name,
          full_name,
          role,
          farm_logo_url
        )
      `,
        { count: 'exact' }
      )
      .eq('status', 'active')
      .is('deleted_at', null)
      .is('hidden_at', null)

    // Full-text search using the GIN index
    if (search.length > 0) {
      query = query.textSearch('search_vector', search, {
        type: 'websearch',
        config: 'english',
      })
    }

    // Job type filter
    if (type.length > 0) {
      query = query.eq('job_type', type)
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error

    const payload = {
      jobs: data ?? [],
      total: count ?? 0,
      page,
      limit,
    }

    // Cache only unfiltered results
    if (!isFiltered) {
      publicJobsCache.set(cacheKey, { data: payload, cachedAt: Date.now() })
    }

    return res.json(payload)
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) })
  }
})

// GET /api/jobs - List jobs with filters
router.get('/', validateQuery(jobsListQuerySchema), async (req, res) => {
  try {
    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const id = searchParams.get('id');
    const location = searchParams.get('location');
    const jobType = searchParams.get('job_type');
    const specialization = searchParams.get('specialization');
    const farmId = searchParams.get('farm_id');
    const status = searchParams.get('status') || 'all';

    // Single-job lookups are not cached (they're already fast and rarely repeated)
    const supabase = status === 'all'
      ? getSupabaseAdminClient()
      : getSupabaseClient();

    if (id) {
      const singleResult = await supabase
        .from('jobs')
        .select(jobListSelect)
        .eq('id', id)
        .single();
      if (singleResult.error) throw singleResult.error;
      return res.json({ job: singleResult.data });
    }

    const cacheKey = JSON.stringify({ status, location, jobType, specialization, farmId });
    const cached = cacheGet(cacheKey);
    if (cached) return res.json({ jobs: cached });

    let query = supabase.from('jobs').select(jobListSelect);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    } else {
      // Filter inactive jobs older than 24 hours at the DB level instead of in JS
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      query = query.or(`status.neq.inactive,and(status.eq.inactive,status_changed_at.gte.${cutoff})`)
    }

    if (location) query = query.eq('location', location);
    if (jobType) query = query.eq('job_type', jobType);
    if (specialization) query = query.eq('required_specialization', specialization);
    if (farmId) query = query.eq('farm_id', farmId);

    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;

    const jobs = data || [];
    cacheSet(cacheKey, jobs);
    return res.json({ jobs });
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

// POST /api/jobs - Create job (Farm or Admin)
router.post('/', authenticate, validate(createJobSchema), async (req, res) => {
  try {
    // Use authed client so RLS can see auth.uid()
    const supabase = (req as AuthRequest).supabase ?? getSupabaseClient();
    const supabaseAdmin = getSupabaseAdminClient();

    // Check if user is an employer/farm or admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', (req as AuthRequest).user.id)
      .single();
    
    if (!profile || (profile.role !== 'farm' && profile.role !== 'admin')) {
      return res.status(403).json({ error: 'Only employers/farms and admins can create jobs' });
    }
    
    const {
      title,
      description,
      job_type,
      location,
      address,
      salary_min,
      salary_max,
      required_qualification,
      required_institution_type,
      required_experience_years,
      required_specialization,
      expires_at,
      farm_id  // For admin to assign job to a specific farm
    } = req.body;
    
    if (!title || !description || !job_type || !location) {
      return res.status(400).json({
        error: 'Title, description, job_type, and location are required'
      });
    }
    
    // Determine farm_id
    let targetFarmId = (req as AuthRequest).user.id;
    if (profile.role === 'admin') {
      // Admin must specify a farm_id when posting
      if (!farm_id) {
        return res.status(400).json({
          error: 'farm_id is required when admin posts a job. Please select an employer/farm.'
        });
      }
      // Verify the farm exists
      const { data: farmProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, role')
        .eq('id', farm_id)
        .eq('role', 'farm')
        .single();
      
      if (!farmProfile) {
        return res.status(400).json({
          error: 'Invalid farm_id. The specified farm does not exist.'
        });
      }
      targetFarmId = farm_id;
    }
    
    // For admin-posted jobs, we insert via service role to bypass RLS (jobs policy is farm-only).
    const insertClient = profile.role === 'admin' ? supabaseAdmin : supabase;

    const { data: job, error } = await insertClient
      .from('jobs')
      .insert({
        farm_id: targetFarmId,
        title,
        description,
        job_type,
        location,
        address: address || null,
        salary_min: salary_min ? parseFloat(salary_min) : null,
        salary_max: salary_max ? parseFloat(salary_max) : null,
        required_qualification: required_qualification || null,
        required_institution_type: required_institution_type || 'any',
        required_experience_years: required_experience_years || 0,
        required_specialization: required_specialization || null,
        status: 'active',
        expires_at: expires_at || null
      })
      .select()
      .single();
    
    if (error) throw error;
    cacheInvalidate();
    return res.status(201).json({ job });
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

// PATCH /api/jobs/:id - Update job (Farm or Admin)
router.patch('/:id', authenticate, validate(updateJobSchema), async (req, res) => {
  try {
    const supabase = (req as AuthRequest).supabase ?? getSupabaseClient();
    const supabaseAdmin = getSupabaseAdminClient();

    // Check if user is an employer/farm or admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', (req as AuthRequest).user.id)
      .single();
    
    if (!profile || (profile.role !== 'farm' && profile.role !== 'admin')) {
      return res.status(403).json({ error: 'Only employers/farms and admins can update jobs' });
    }
    
    // Get existing job to verify ownership
    const { data: existingJob } = await supabaseAdmin
      .from('jobs')
      .select('farm_id')
      .eq('id', req.params.id)
      .single();
    
    if (!existingJob) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Verify farm owns this job (unless admin)
    if (profile.role === 'farm' && existingJob.farm_id !== (req as AuthRequest).user.id) {
      return res.status(403).json({
        error: 'You can only update jobs you posted'
      });
    }
    
    const {
      title,
      description,
      job_type,
      location,
      address,
      salary_min,
      salary_max,
      required_qualification,
      required_institution_type,
      required_experience_years,
      required_specialization,
      expires_at,
      status,
      farm_id  // For admin to reassign job to different farm
    } = req.body;
    
    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (job_type !== undefined) updateData.job_type = job_type;
    if (location !== undefined) updateData.location = location;
    if (address !== undefined) updateData.address = address || null;
    if (salary_min !== undefined) updateData.salary_min = salary_min ? parseFloat(salary_min) : null;
    if (salary_max !== undefined) updateData.salary_max = salary_max ? parseFloat(salary_max) : null;
    if (required_qualification !== undefined) updateData.required_qualification = required_qualification || null;
    if (required_institution_type !== undefined) updateData.required_institution_type = required_institution_type;
    if (required_experience_years !== undefined) updateData.required_experience_years = required_experience_years || 0;
    if (required_specialization !== undefined) updateData.required_specialization = required_specialization || null;
    if (expires_at !== undefined) updateData.expires_at = expires_at || null;
    if (status !== undefined) updateData.status = status;
    
    // Admin can reassign job to different farm
    if (profile.role === 'admin' && farm_id !== undefined) {
      // Verify the farm exists
      const { data: farmProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, role')
        .eq('id', farm_id)
        .eq('role', 'farm')
        .single();
      
      if (!farmProfile) {
        return res.status(400).json({
          error: 'Invalid farm_id. The specified farm does not exist.'
        });
      }
      updateData.farm_id = farm_id;
    }
    
    // Use admin client to avoid RLS blocking farm updates
    const updateClient = supabaseAdmin;
    
    const { data: updated, error } = await updateClient
      .from('jobs')
      .update(updateData)
      .eq('id', req.params.id)
      .select()
      .single();
    
    if (error) throw error;
    cacheInvalidate();
    return res.json({ job: updated });
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

// DELETE /api/jobs/:id - Delete job (Farm own jobs or Admin any job)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const supabase = req.supabase || getSupabaseClient();
    const supabaseAdmin = getSupabaseAdminClient();

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', (req as AuthRequest).user.id)
      .single();

    if (!profile || (profile.role !== 'farm' && profile.role !== 'admin')) {
      return res.status(403).json({ error: 'Only employers/farms and admins can delete jobs' });
    }

    const { data: existingJob } = await supabaseAdmin
      .from('jobs')
      .select('farm_id')
      .eq('id', req.params.id)
      .single();

    if (!existingJob) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (profile.role === 'farm' && existingJob.farm_id !== (req as AuthRequest).user.id) {
      return res.status(403).json({ error: 'You can only delete jobs you posted' });
    }

    const { error } = await supabaseAdmin
      .from('jobs')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    cacheInvalidate();
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

export default router;
