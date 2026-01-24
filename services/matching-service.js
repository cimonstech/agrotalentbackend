/**
 * Automated Matching Service
 *
 * This service automatically matches applicants with jobs based on:
 * - Location (same region = higher score)
 * - Qualification match
 * - Specialization match
 * - Experience level
 * - Verification status
 *
 * NOTE: This is a runtime JS version of the service (so `node --watch` can run
 * without a TS loader on Windows). Keep the interface stable for callers.
 */
export class MatchingService {
  constructor(supabase) {
    this.supabase = supabase;
  }

  /**
   * Calculate match score between a job and an applicant
   */
  async calculateMatchScore(jobId, applicantId) {
    let score = 0;
    const reasons = [];

    // Get job details
    const { data: job } = await this.supabase
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (!job) return 0;

    // Get applicant profile
    const { data: applicant } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', applicantId)
      .single();

    if (!applicant) return 0;

    // Location match: +50 points (CRITICAL - regional placement policy)
    if (job.location === applicant.preferred_region) {
      score += 50;
      reasons.push('Location match (same region)');
    } else {
      reasons.push('Location mismatch - different region');
    }

    // Verified status: +20 points
    if (applicant.is_verified) {
      score += 20;
      reasons.push('Verified applicant');
    }

    // Qualification match: +15 points
    if (job.required_qualification) {
      const applicantQual = applicant.qualification?.toLowerCase?.() || '';
      const requiredQual = String(job.required_qualification).toLowerCase();
      if (applicantQual.includes(requiredQual)) {
        score += 15;
        reasons.push('Qualification match');
      }
    }

    // Institution type match: +10 points
    if (job.required_institution_type && job.required_institution_type !== 'any') {
      if (applicant.institution_type === job.required_institution_type) {
        score += 10;
        reasons.push('Institution type match');
      }
    }

    // Specialization match: +15 points
    if (job.required_specialization && applicant.specialization) {
      if (
        String(applicant.specialization).toLowerCase() ===
        String(job.required_specialization).toLowerCase()
      ) {
        score += 15;
        reasons.push('Specialization match');
      }
    }

    // Job type compatibility
    if (job.job_type === 'farm_hand' && applicant.qualification) {
      // Farm hands can come from training colleges
      if (applicant.institution_type === 'training_college') {
        score += 10;
        reasons.push('Suitable for farm hand position');
      }
    }

    if (job.job_type === 'farm_manager' && applicant.qualification) {
      // Farm managers typically need university degree
      if (applicant.institution_type === 'university') {
        score += 10;
        reasons.push('Suitable for management position');
      }
    }

    // NSS/Internship matching
    if (job.job_type === 'intern' || job.job_type === 'nss') {
      if (applicant.role === 'student' && applicant.nss_status !== 'not_applicable') {
        score += 20;
        reasons.push('NSS/Internship eligible');
      }
    }

    // Currently, `reasons` is not returned by the API, but we keep it for future use.
    return Math.min(score, 100); // Cap at 100
  }

  /**
   * Find matching applicants for a job
   */
  async findMatchesForJob(jobId) {
    const { data: job } = await this.supabase
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (!job) return [];

    // Get all verified graduates/students/workers matching basic criteria
    let query = this.supabase
      .from('profiles')
      .select('*')
      .eq('is_verified', true)
      .in('role', ['graduate', 'student', 'worker']);

    // Filter by location (regional placement)
    if (job.location) {
      query = query.eq('preferred_region', job.location);
    }

    // Filter by institution type if specified
    if (job.required_institution_type && job.required_institution_type !== 'any') {
      query = query.eq('institution_type', job.required_institution_type);
    }

    // Filter by specialization if specified
    if (job.required_specialization) {
      query = query.eq('specialization', job.required_specialization);
    }

    const { data: applicants } = await query;
    if (!applicants) return [];

    const matches = [];

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

  /**
   * Find matching jobs for an applicant
   */
  async findJobsForGraduate(applicantId) {
    const { data: applicant } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', applicantId)
      .single();

    if (!applicant) return [];

    let query = this.supabase.from('jobs').select('*').eq('status', 'active');

    // Filter by location (regional placement)
    if (applicant.preferred_region) {
      query = query.eq('location', applicant.preferred_region);
    }

    // Filter by institution type if specified
    if (applicant.institution_type) {
      query = query.or(
        `required_institution_type.eq.${applicant.institution_type},required_institution_type.eq.any`
      );
    }

    // Filter by specialization if specified (soft filter: only when job requires one)
    if (applicant.specialization) {
      query = query.or(
        `required_specialization.eq.${applicant.specialization},required_specialization.is.null`
      );
    }

    const { data: jobs } = await query;
    if (!jobs) return [];

    const matches = [];
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

  /**
   * Auto-notify matching applicants when a new job is posted
   */
  async notifyMatchingGraduates(jobId) {
    const matches = await this.findMatchesForJob(jobId);

    const { data: job } = await this.supabase
      .from('jobs')
      .select('title, location, job_type')
      .eq('id', jobId)
      .single();

    if (!job) return;

    const topMatches = matches.filter((m) => m.match_score >= 50).slice(0, 10);

    for (const match of topMatches) {
      await this.supabase.from('notifications').insert({
        user_id: match.applicant_id,
        type: 'match_found',
        title: 'New Job Match Found',
        message: `A new ${job.job_type} position in ${job.location} matches your profile: ${job.title}`,
        link: `/jobs/${jobId}`
      });
    }
  }
}

