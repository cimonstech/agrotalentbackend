/**
 * Automated Matching Service
 *
 * This service automatically matches graduates with jobs based on:
 * - Location (same region = higher score)
 * - Qualification match
 * - Specialization match
 * - Experience level
 * - Verification status
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export function calculateMatchScore(
  job: Record<string, unknown>,
  profile: Record<string, unknown>
): number {
  let score = 0;

  const ADJACENCY: Record<string, string[]> = {
    'Greater Accra': ['Eastern', 'Central', 'Volta'],
    'Ashanti': ['Eastern', 'Western', 'Bono', 'Ahafo', 'Bono East'],
    'Eastern': ['Greater Accra', 'Ashanti', 'Volta', 'Oti'],
    'Western': ['Central', 'Ashanti', 'Western North'],
    'Western North': ['Western', 'Ashanti', 'Ahafo'],
    'Central': ['Greater Accra', 'Western', 'Ashanti'],
    'Volta': ['Greater Accra', 'Eastern', 'Oti'],
    'Oti': ['Volta', 'Eastern', 'Northern'],
    'Northern': ['North East', 'Savannah', 'Bono East'],
    'Upper East': ['North East', 'Upper West'],
    'Upper West': ['Upper East', 'Savannah'],
    'North East': ['Northern', 'Upper East'],
    'Savannah': ['Northern', 'Upper West'],
    'Bono': ['Ashanti', 'Bono East', 'Ahafo'],
    'Bono East': ['Bono', 'Ashanti', 'Northern'],
    'Ahafo': ['Ashanti', 'Bono', 'Western North'],
  };

  const jobLocation = (job.location as string | null | undefined)?.trim() ?? '';
  const profileRegion = (profile.preferred_region as string | null | undefined)?.trim() ?? '';

  if (profileRegion) {
    if (jobLocation.toLowerCase() === profileRegion.toLowerCase()) {
      score += 50;
    } else {
      const adjacent = ADJACENCY[jobLocation] ?? [];
      if (adjacent.some((r) => r.toLowerCase() === profileRegion.toLowerCase())) {
        score += 30;
      } else {
        score += 10;
      }
    }
  }

  const reqQual = (job.required_qualification as string | null | undefined) ?? '';
  const profileQual = (profile.qualification as string | null | undefined) ?? '';
  if (!reqQual) {
    score += 20;
  } else if (reqQual.toLowerCase() === profileQual.toLowerCase()) {
    score += 20;
  }

  const reqExp = (job.required_experience_years as number | null | undefined) ?? 0;
  const profileExp = (profile.years_of_experience as number | null | undefined) ?? 0;
  if (profileExp >= reqExp) {
    score += 15;
  } else if (reqExp - profileExp <= 1) {
    score += 8;
  }

  const reqSpec = (job.required_specialization as string | null | undefined) ?? '';
  const profileSpec = (profile.specialization as string | null | undefined) ?? '';
  if (!reqSpec || reqSpec.toLowerCase() === profileSpec.toLowerCase()) {
    score += 10;
  }

  const reqInst = (job.required_institution_type as string | null | undefined) ?? '';
  const profileInst = (profile.institution_type as string | null | undefined) ?? '';
  if (!reqInst || reqInst === 'any' || reqInst.toLowerCase() === profileInst.toLowerCase()) {
    score += 5;
  }

  return Math.min(100, score);
}

export interface MatchCriteria {
  location?: string;
  qualification?: string;
  specialization?: string;
  experience_years?: number;
  institution_type?: 'university' | 'training_college' | 'any';
}

export interface MatchResult {
  applicant_id: string;
  job_id: string;
  match_score: number;
  reasons: string[];
}

export class MatchingService {
  constructor(private supabase: SupabaseClient) {}

  async calculateMatchScore(
    jobId: string,
    applicantId: string
  ): Promise<number> {
    const { data: job } = await this.supabase
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (!job) return 0;

    const { data: applicant } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', applicantId)
      .single();

    if (!applicant) return 0;

    return calculateMatchScore(
      job as Record<string, unknown>,
      applicant as Record<string, unknown>
    );
  }

  async findMatchesForJob(jobId: string): Promise<MatchResult[]> {
    const { data: job } = await this.supabase
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (!job) return [];

    let query = this.supabase
      .from('profiles')
      .select('*')
      .eq('is_verified', true)
      .in('role', ['graduate', 'student', 'skilled']);

    if (job.location) {
      query = query.eq('preferred_region', job.location);
    }

    if (job.required_institution_type && job.required_institution_type !== 'any') {
      query = query.eq('institution_type', job.required_institution_type);
    }

    if (job.required_specialization) {
      query = query.eq('specialization', job.required_specialization);
    }

    const { data: applicants } = await query;

    if (!applicants) return [];

    const matches: MatchResult[] = [];

    for (const applicant of applicants) {
      const score = await this.calculateMatchScore(jobId, applicant.id);

      if (score > 0) {
        matches.push({
          applicant_id: applicant.id,
          job_id: jobId,
          match_score: score,
          reasons: []
        });
      }
    }

    return matches.sort((a, b) => b.match_score - a.match_score);
  }

  async findJobsForGraduate(applicantId: string): Promise<MatchResult[]> {
    const { data: applicant } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', applicantId)
      .single();

    if (!applicant) return [];

    let query = this.supabase
      .from('jobs')
      .select('*')
      .eq('status', 'active');

    if (applicant.preferred_region) {
      query = query.eq('location', applicant.preferred_region);
    }

    if (applicant.institution_type) {
      query = query.or(`required_institution_type.eq.${applicant.institution_type},required_institution_type.eq.any`);
    }

    if (applicant.specialization) {
      query = query.or(`required_specialization.eq.${applicant.specialization},required_specialization.is.null`);
    }

    const { data: jobs } = await query;

    if (!jobs) return [];

    const matches: MatchResult[] = [];

    for (const job of jobs) {
      const score = await this.calculateMatchScore(job.id, applicantId);

      if (score >= 30) {
        matches.push({
          applicant_id: applicantId,
          job_id: job.id,
          match_score: score,
          reasons: []
        });
      }
    }

    return matches.sort((a, b) => b.match_score - a.match_score);
  }

  async notifyMatchingGraduates(jobId: string): Promise<void> {
    const matches = await this.findMatchesForJob(jobId);

    const { data: job } = await this.supabase
      .from('jobs')
      .select('title, location, job_type')
      .eq('id', jobId)
      .single();

    if (!job) return;

    const topMatches = matches
      .filter(m => m.match_score >= 50)
      .slice(0, 10);

    for (const match of topMatches) {
      await this.supabase
        .from('notifications')
        .insert({
          user_id: match.applicant_id,
          type: 'match_found',
          title: 'New Job Match Found',
          message: `A new ${job.job_type} position in ${job.location} matches your profile: ${job.title}`,
          link: `/jobs/${jobId}`
        });
    }
  }
}
