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

import { SupabaseClient } from '@supabase/supabase-js'

export interface MatchCriteria {
  location?: string
  qualification?: string
  specialization?: string
  experience_years?: number
  institution_type?: 'university' | 'training_college' | 'any'
}

export interface MatchResult {
  applicant_id: string
  job_id: string
  match_score: number
  reasons: string[]
}

export class MatchingService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Calculate match score between a job and an applicant
   */
  async calculateMatchScore(
    jobId: string,
    applicantId: string
  ): Promise<number> {
    let score = 0
    const reasons: string[] = []

    // Get job details
    const { data: job } = await this.supabase
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (!job) return 0

    // Get applicant profile
    const { data: applicant } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', applicantId)
      .single()

    if (!applicant) return 0

    // Location match: +50 points (CRITICAL - regional placement policy)
    if (job.location === applicant.preferred_region) {
      score += 50
      reasons.push('Location match (same region)')
    } else {
      reasons.push('Location mismatch - different region')
    }

    // Verified status: +20 points
    if (applicant.is_verified) {
      score += 20
      reasons.push('Verified graduate')
    }

    // Qualification match: +15 points
    if (job.required_qualification) {
      if (applicant.qualification?.toLowerCase().includes(job.required_qualification.toLowerCase())) {
        score += 15
        reasons.push('Qualification match')
      }
    }

    // Institution type match: +10 points
    if (job.required_institution_type && job.required_institution_type !== 'any') {
      if (applicant.institution_type === job.required_institution_type) {
        score += 10
        reasons.push('Institution type match')
      }
    }

    // Specialization match: +15 points
    if (job.required_specialization && applicant.specialization) {
      if (applicant.specialization.toLowerCase() === job.required_specialization.toLowerCase()) {
        score += 15
        reasons.push('Specialization match')
      }
    }

    // Job type compatibility
    if (job.job_type === 'farm_hand' && applicant.qualification) {
      // Farm hands can come from training colleges
      if (applicant.institution_type === 'training_college') {
        score += 10
        reasons.push('Suitable for farm hand position')
      }
    }

    if (job.job_type === 'farm_manager' && applicant.qualification) {
      // Farm managers typically need university degree
      if (applicant.institution_type === 'university') {
        score += 10
        reasons.push('Suitable for management position')
      }
    }

    // NSS/Internship matching
    if (job.job_type === 'intern' || job.job_type === 'nss') {
      if (applicant.role === 'student' && applicant.nss_status !== 'not_applicable') {
        score += 20
        reasons.push('NSS/Internship eligible')
      }
    }

    return Math.min(score, 100) // Cap at 100
  }

  /**
   * Find matching graduates for a job
   */
  async findMatchesForJob(jobId: string): Promise<MatchResult[]> {
    const { data: job } = await this.supabase
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (!job) return []

    // Get all verified graduates/students matching basic criteria
    let query = this.supabase
      .from('profiles')
      .select('*')
      .eq('is_verified', true)
      .in('role', ['graduate', 'student', 'worker'])

    // Filter by location (regional placement)
    if (job.location) {
      query = query.eq('preferred_region', job.location)
    }

    // Filter by institution type if specified
    if (job.required_institution_type && job.required_institution_type !== 'any') {
      query = query.eq('institution_type', job.required_institution_type)
    }

    // Filter by specialization if specified
    if (job.required_specialization) {
      query = query.eq('specialization', job.required_specialization)
    }

    const { data: applicants } = await query

    if (!applicants) return []

    // Calculate match scores for each applicant
    const matches: MatchResult[] = []
    
    for (const applicant of applicants) {
      const score = await this.calculateMatchScore(jobId, applicant.id)
      
      if (score > 0) {
        matches.push({
          applicant_id: applicant.id,
          job_id: jobId,
          match_score: score,
          reasons: [] // Would be populated in calculateMatchScore
        })
      }
    }

    // Sort by match score (highest first)
    return matches.sort((a, b) => b.match_score - a.match_score)
  }

  /**
   * Find matching jobs for a graduate
   */
  async findJobsForGraduate(applicantId: string): Promise<MatchResult[]> {
    const { data: applicant } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', applicantId)
      .single()

    if (!applicant) return []

    // Get active jobs matching basic criteria
    let query = this.supabase
      .from('jobs')
      .select('*')
      .eq('status', 'active')

    // Filter by location (regional placement)
    if (applicant.preferred_region) {
      query = query.eq('location', applicant.preferred_region)
    }

    // Filter by institution type if specified
    if (applicant.institution_type) {
      query = query.or(`required_institution_type.eq.${applicant.institution_type},required_institution_type.eq.any`)
    }

    // Filter by specialization if specified (soft filter: only when job requires one)
    if (applicant.specialization) {
      query = query.or(`required_specialization.eq.${applicant.specialization},required_specialization.is.null`)
    }

    const { data: jobs } = await query

    if (!jobs) return []

    // Calculate match scores for each job
    const matches: MatchResult[] = []
    
    for (const job of jobs) {
      const score = await this.calculateMatchScore(job.id, applicantId)
      
      if (score >= 30) { // Only show jobs with minimum 30% match
        matches.push({
          applicant_id: applicantId,
          job_id: job.id,
          match_score: score,
          reasons: []
        })
      }
    }

    // Sort by match score (highest first)
    return matches.sort((a, b) => b.match_score - a.match_score)
  }

  /**
   * Auto-notify matching graduates when a new job is posted
   */
  async notifyMatchingGraduates(jobId: string): Promise<void> {
    const matches = await this.findMatchesForJob(jobId)
    
    // Get job details for notification
    const { data: job } = await this.supabase
      .from('jobs')
      .select('title, location, job_type')
      .eq('id', jobId)
      .single()

    if (!job) return

    // Notify top matches (top 10 or matches with score > 50)
    const topMatches = matches
      .filter(m => m.match_score >= 50)
      .slice(0, 10)

    for (const match of topMatches) {
      await this.supabase
        .from('notifications')
        .insert({
          user_id: match.applicant_id,
          type: 'match_found',
          title: 'New Job Match Found',
          message: `A new ${job.job_type} position in ${job.location} matches your profile: ${job.title}`,
          link: `/jobs/${jobId}`
        })
    }
  }
}
