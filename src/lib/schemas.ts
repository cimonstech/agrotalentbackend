import { z } from 'zod'

const GHANA_REGIONS = [
  'Greater Accra',
  'Ashanti',
  'Western',
  'Eastern',
  'Central',
  'Volta',
  'Northern',
  'Upper East',
  'Upper West',
  'Brong Ahafo',
  'Western North',
  'Ahafo',
  'Bono',
  'Bono East',
  'Oti',
  'Savannah',
  'North East',
] as const

const ghanaRegionEnum = z.enum(GHANA_REGIONS)

export const signUpSchema = z
  .object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    role: z.enum(['farm', 'graduate', 'student', 'skilled'], {
      message: 'Role must be farm, graduate, student, or skilled',
    }),
    full_name: z
      .string()
      .min(2, 'Full name must be at least 2 characters')
      .max(100),
    phone: z.string().optional(),
    farm_name: z.string().max(100).optional(),
    farm_type: z
      .enum(['small', 'medium', 'large', 'agro_processing', 'research'])
      .optional(),
    farm_location: ghanaRegionEnum.optional(),
    institution_name: z.string().max(100).optional(),
    institution_type: z.enum(['university', 'training_college']).optional(),
    qualification: z.string().max(100).optional(),
    specialization: z.string().max(100).optional(),
    graduation_year: z.coerce.number().int().min(1990).max(2030).optional(),
    preferred_region: ghanaRegionEnum.optional(),
    years_of_experience: z.coerce.number().int().min(0).max(50).optional(),
  })
  .catchall(z.unknown())

export const signInSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export const resetPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
})

export const updatePasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export const resetPasswordBodySchema = updatePasswordSchema.extend({
  token: z.string().optional(),
})

const createJobObjectSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(150),
  description: z
    .string()
    .min(50, 'Description must be at least 50 characters')
    .max(5000),
  job_type: z.enum([
    'farm_hand',
    'farm_manager',
    'intern',
    'nss',
    'data_collector',
  ]),
  location: ghanaRegionEnum,
  address: z.string().max(200).optional(),
  salary_min: z.coerce.number().min(0).optional(),
  salary_max: z.coerce.number().min(0).optional(),
  salary_currency: z.string().default('GHS'),
  required_qualification: z.string().max(100).optional(),
  required_institution_type: z
    .enum(['university', 'training_college', 'any'])
    .optional(),
  required_experience_years: z.coerce.number().int().min(0).max(30).optional(),
  required_specialization: z.string().max(100).optional(),
  expires_at: z.string().optional(),
  max_applications: z.coerce.number().int().min(1).optional(),
  farm_id: z.string().uuid().optional(),
})

const jobSalaryRangeRefine = <S extends z.ZodObject<z.ZodRawShape>>(schema: S) =>
  schema.refine(
    (data: { salary_min?: unknown; salary_max?: unknown }) => {
      if (data.salary_min != null && data.salary_max != null) {
        return Number(data.salary_max) >= Number(data.salary_min)
      }
      return true
    },
    { message: 'salary_max must be >= salary_min', path: ['salary_max'] }
  )

export const createJobSchema = jobSalaryRangeRefine(createJobObjectSchema)

export const updateJobSchema = jobSalaryRangeRefine(
  createJobObjectSchema.partial().extend({
    status: z
      .enum(['active', 'closed', 'draft', 'paused', 'filled', 'inactive'])
      .optional(),
  })
)

export const createApplicationSchema = z.object({
  job_id: z.string().uuid('Invalid job ID'),
  cover_letter: z.string().max(2000).nullable().optional(),
})

export const updateApplicationStatusSchema = z.object({
  status: z.enum([
    'pending',
    'reviewing',
    'shortlisted',
    'accepted',
    'rejected',
    'withdrawn',
  ]),
  review_notes: z.string().max(1000).nullable().optional(),
})

export const updateProfileSchema = z.object({
  full_name: z.string().min(2).max(100).optional(),
  phone: z.string().max(20).optional(),
  farm_name: z.string().max(100).optional(),
  farm_type: z
    .enum(['small', 'medium', 'large', 'agro_processing', 'research'])
    .optional(),
  farm_location: ghanaRegionEnum.optional(),
  farm_address: z.string().max(200).optional(),
  institution_name: z.string().max(100).optional(),
  institution_type: z.enum(['university', 'training_college']).optional(),
  qualification: z.string().max(100).optional(),
  specialization: z.string().max(100).optional(),
  graduation_year: z.coerce.number().int().min(1990).max(2030).optional(),
  preferred_region: ghanaRegionEnum.optional(),
  nss_status: z
    .enum(['not_applicable', 'pending', 'active', 'completed'])
    .optional(),
  years_of_experience: z.coerce.number().int().min(0).max(50).optional(),
  experience_description: z.string().max(1000).optional(),
  skills: z.string().max(500).optional(),
  previous_employer: z.string().max(100).optional(),
  reference_name: z.string().max(100).optional(),
  reference_phone: z.string().max(20).optional(),
  reference_relationship: z.string().max(100).optional(),
})

export const createPlacementSchema = z.object({
  application_id: z.string().uuid('Invalid application ID'),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
})

export const updatePlacementSchema = z.object({
  status: z
    .enum(['pending', 'active', 'completed', 'terminated'])
    .optional(),
  training_completed: z.boolean().optional(),
  zoom_session_attended: z.boolean().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  completion_notes: z.string().max(1000).optional(),
})

export const initiatePaymentSchema = z.object({
  placement_id: z.string().uuid('Invalid placement ID'),
})

export const verifyPaymentSchema = z.object({
  reference: z.string().min(1, 'Reference is required'),
})

export const sendMessageSchema = z.object({
  conversation_id: z.string().uuid('Invalid conversation ID'),
  content: z.string().min(1, 'Message cannot be empty').max(2000),
})

export const createConversationSchema = z.object({
  other_user_id: z.string().uuid('Invalid user ID'),
  job_id: z.string().uuid().optional(),
})

export const postMessageBodySchema = z
  .object({
    conversation_id: z.string().uuid().optional(),
    recipient_id: z.string().uuid().optional(),
    job_id: z.string().uuid().optional(),
    content: z.string().min(1, 'Message cannot be empty').max(2000),
  })
  .superRefine((data, ctx) => {
    if (data.conversation_id) return
    if (!data.recipient_id || !data.job_id) {
      ctx.addIssue({
        code: 'custom',
        message:
          'recipient_id and job_id are required when conversation_id is missing',
        path: ['recipient_id'],
      })
    }
  })

export const createTrainingSchema = z.object({
  title: z.string().min(3).max(150),
  description: z.string().max(1000).optional(),
  session_type: z.enum(['orientation', 'pre_employment', 'quarterly', 'custom']),
  zoom_link: z.union([z.string().url(), z.literal('')]).nullish(),
  zoom_meeting_id: z.string().max(50).optional(),
  zoom_password: z.string().max(50).optional(),
  scheduled_at: z.string().min(1, 'Invalid date format'),
  duration_minutes: z.coerce.number().int().min(15).max(480).default(60),
  category: z.string().min(1).max(100),
  region: ghanaRegionEnum,
  trainer_name: z.string().max(100).optional(),
  trainer_type: z.string().max(100).optional(),
  attendance_method: z.enum(['manual', 'zoom']).default('manual'),
})

export const createNoticeSchema = z.object({
  title: z.string().min(3).max(200),
  body_html: z.string().min(1).max(10000),
  audience: z.enum(['all', 'farm', 'graduate', 'student']),
  link: z.union([z.string().url(), z.literal('')]).nullish(),
  attachments: z
    .array(
      z.object({
        url: z.string().url(),
        name: z.string().optional(),
      })
    )
    .optional(),
})

export const contactSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  phone: z.string().max(20).optional(),
  subject: z.string().max(200).optional(),
  message: z
    .string()
    .min(20, 'Message must be at least 20 characters')
    .max(2000),
})

export const verifyUserSchema = z.object({
  verified: z.boolean().optional(),
  notes: z.string().max(500).optional(),
})

export const createUserSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    role: z.enum(['farm', 'graduate', 'student', 'skilled', 'admin']),
    full_name: z.string().min(2).max(100).optional(),
    phone: z.string().max(20).optional(),
    is_verified: z.boolean().optional(),
    farm_name: z.string().max(200).optional(),
    farm_type: z.string().optional(),
    farm_location: z.string().optional(),
    institution_name: z.string().max(200).optional(),
    institution_type: z.string().optional(),
    qualification: z.string().optional(),
    specialization: z.string().optional(),
    preferred_region: z.string().optional(),
  })
  .catchall(z.unknown())

export const updateApplicationStatusAdminSchema = z.object({
  status: z.enum([
    'pending',
    'reviewed',
    'shortlisted',
    'accepted',
    'rejected',
  ]),
  notes: z.string().max(1000).optional(),
})

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  sort_by: z.string().max(50).optional(),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
})

export const jobsListQuerySchema = paginationSchema.partial().extend({
  id: z.string().uuid().optional(),
  location: z.string().max(100).optional(),
  job_type: z.string().max(50).optional(),
  specialization: z.string().max(100).optional(),
  farm_id: z.string().uuid().optional(),
  status: z.string().max(20).optional(),
})
