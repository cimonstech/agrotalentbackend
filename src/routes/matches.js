import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { MatchingService } from '../../services/matching-service.js';

const router = express.Router();

// GET /api/matches - Get job matches
router.get('/', authenticate, async (req, res) => {
  try {
    const supabase = req.supabase;
    const matching = new MatchingService(supabase);

    const jobId = req.query.job_id;
    const applicantId = req.query.applicant_id;
    const allRegions = req.query.all_regions === 'true';

    // 1) Farm/admin view: applicants for a job (uses stored match_score on applications)
    if (jobId && typeof jobId === 'string') {
      const { data: applications, error } = await supabase
        .from('applications')
        .select(`
          applicant_id,
          match_score,
          applicant:applicant_id (
            id,
            full_name,
            qualification,
            preferred_region,
            is_verified,
            role
          )
        `)
        .eq('job_id', jobId)
        .order('match_score', { ascending: false });

      if (error) throw error;

      const matches = (applications || []).map(app => ({
        applicant_id: app.applicant_id,
        job_id: jobId,
        match_score: app.match_score || 0,
        applicant: app.applicant
      }));

      return res.json({ matches });
    }

    // 2) Applicant view: score a specific job for current user
    if (jobId && typeof jobId === 'string' && !applicantId) {
      const score = await matching.calculateMatchScore(jobId, req.user.id);
      return res.json({
        matches: [
          {
            applicant_id: req.user.id,
            job_id: jobId,
            match_score: score
          }
        ]
      });
    }

    // 3) Applicant view: jobs for current user (enforces regional placement by default)
    if (applicantId && typeof applicantId === 'string') {
      // Admin could pass applicant_id; for now only allow current user
      if (applicantId !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    if (allRegions) {
      // Temporarily bypass the location filter by computing matches against all active jobs.
      // We do this by reading jobs directly and scoring; keep minimum threshold at 30.
      const { data: jobs, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('status', 'active');
      if (error) throw error;

      const scored = [];
      for (const job of jobs || []) {
        const score = await matching.calculateMatchScore(job.id, req.user.id);
        if (score >= 30) {
          scored.push({
            applicant_id: req.user.id,
            job_id: job.id,
            match_score: score,
            job
          });
        }
      }
      scored.sort((a, b) => b.match_score - a.match_score);
      return res.json({ matches: scored });
    }

    const matches = await matching.findJobsForGraduate(req.user.id);

    // Enrich with job details (the service returns ids + score)
    // Limit to top 20 matches for performance
    const topMatches = matches.slice(0, 20);
    const jobIds = topMatches.map(m => m.job_id);
    if (jobIds.length === 0) return res.json({ matches: [] });

    const { data: jobs, error: jobsError } = await supabase
      .from('jobs')
      .select(`
        *,
        profiles:farm_id (
          id,
          farm_name,
          farm_type,
          farm_location
        )
      `)
      .in('id', jobIds)
      .limit(20);

    if (jobsError) throw jobsError;

    const jobMap = new Map((jobs || []).map(j => [j.id, j]));
    const enriched = matches
      .map(m => ({
        ...m,
        job: jobMap.get(m.job_id) || null
      }))
      .filter(m => m.job);

    return res.json({ matches: enriched });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
