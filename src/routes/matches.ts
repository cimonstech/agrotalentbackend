import express, { type Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import type { AuthRequest } from '../types/auth.js';
import { MatchingService } from '../services/matching-service.js';
import { errorMessage } from '../lib/errors.js';

const router = express.Router();

router.get('/', authenticate, async (req, res: Response) => {
  try {
    const { user, supabase } = req as AuthRequest;
    const matching = new MatchingService(supabase);

    const jobId = req.query.job_id;
    const applicantId = req.query.applicant_id;
    const allRegions = req.query.all_regions === 'true';

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

      const matches = (applications || []).map((app: {
        applicant_id: string;
        match_score: number | null;
        applicant: unknown;
      }) => ({
        applicant_id: app.applicant_id,
        job_id: jobId,
        match_score: app.match_score || 0,
        applicant: app.applicant
      }));

      return res.json({ matches });
    }

    if (jobId && typeof jobId === 'string' && !applicantId) {
      const score = await matching.calculateMatchScore(jobId, user.id);
      return res.json({
        matches: [
          {
            applicant_id: user.id,
            job_id: jobId,
            match_score: score
          }
        ]
      });
    }

    if (applicantId && typeof applicantId === 'string') {
      if (applicantId !== user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    if (allRegions) {
      const { data: jobs, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('status', 'active');
      if (error) throw error;

      const scored: Array<{
        applicant_id: string;
        job_id: string;
        match_score: number;
        job: NonNullable<typeof jobs>[number];
      }> = [];
      for (const job of jobs || []) {
        const score = await matching.calculateMatchScore(job.id, user.id);
        if (score >= 30) {
          scored.push({
            applicant_id: user.id,
            job_id: job.id,
            match_score: score,
            job
          });
        }
      }
      scored.sort((a, b) => b.match_score - a.match_score);
      return res.json({ matches: scored });
    }

    const matches = await matching.findJobsForGraduate(user.id);

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
    return res.status(500).json({ error: errorMessage(error) });
  }
});

export default router;
