-- AgroTalent Hub Database Schema
-- Run this in your Supabase SQL Editor

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS & AUTHENTICATION
-- ============================================

-- Profiles table (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('farm', 'graduate', 'student', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Farm-specific fields
  farm_name TEXT,
  farm_type TEXT CHECK (farm_type IN ('small', 'medium', 'large', 'agro_processing', 'research')),
  farm_location TEXT, -- Region
  farm_address TEXT,
  
  -- Graduate/Student-specific fields
  institution_name TEXT,
  institution_type TEXT CHECK (institution_type IN ('university', 'training_college')),
  qualification TEXT,
  specialization TEXT, -- crop, livestock, agribusiness, etc.
  graduation_year INTEGER,
  preferred_region TEXT,
  nss_status TEXT CHECK (nss_status IN ('not_applicable', 'pending', 'active', 'completed')),
  
  -- Verification status
  is_verified BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES profiles(id),
  
  -- Document URLs (stored in Supabase Storage)
  certificate_url TEXT,
  transcript_url TEXT,
  cv_url TEXT,
  nss_letter_url TEXT,
  
  CONSTRAINT valid_farm_fields CHECK (
    (role = 'farm' AND farm_name IS NOT NULL) OR
    (role != 'farm')
  ),
  CONSTRAINT valid_graduate_fields CHECK (
    (role IN ('graduate', 'student') AND institution_name IS NOT NULL) OR
    (role NOT IN ('graduate', 'student'))
  )
);

-- ============================================
-- JOBS & RECRUITMENT
-- ============================================

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- Job details
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('farm_hand', 'farm_manager', 'intern', 'nss', 'data_collector')),
  
  -- Requirements
  required_qualification TEXT, -- 'diploma', 'bsc', etc.
  required_institution_type TEXT CHECK (required_institution_type IN ('university', 'training_college', 'any')),
  required_experience_years INTEGER DEFAULT 0,
  required_specialization TEXT, -- crop, livestock, agribusiness, etc.
  
  -- Location & Salary
  location TEXT NOT NULL, -- Region
  address TEXT,
  salary_min DECIMAL(10, 2),
  salary_max DECIMAL(10, 2),
  salary_currency TEXT DEFAULT 'GHS',
  
  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'filled', 'closed')),
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  
  -- Application settings
  max_applications INTEGER,
  application_count INTEGER DEFAULT 0
);

-- ============================================
-- APPLICATIONS
-- ============================================

CREATE TABLE applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  applicant_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- Application details
  cover_letter TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'shortlisted', 'rejected', 'accepted', 'withdrawn')),
  
  -- Matching score (calculated based on location, qualification, etc.)
  match_score INTEGER DEFAULT 0,
  
  -- Admin actions
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(job_id, applicant_id) -- One application per job per applicant
);

-- ============================================
-- MATCHES & PLACEMENTS
-- ============================================

CREATE TABLE placements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  farm_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  graduate_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- Placement details
  start_date DATE,
  end_date DATE, -- For internships/NSS
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'training', 'active', 'completed', 'terminated')),
  
  -- Training
  training_completed BOOLEAN DEFAULT FALSE,
  training_completed_at TIMESTAMPTZ,
  zoom_session_attended BOOLEAN DEFAULT FALSE,
  
  -- Payment
  recruitment_fee_paid BOOLEAN DEFAULT FALSE,
  recruitment_fee_amount DECIMAL(10, 2) DEFAULT 200.00,
  recruitment_fee_paid_at TIMESTAMPTZ,
  payment_reference TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TRAINING SESSIONS
-- ============================================

CREATE TABLE training_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  session_type TEXT NOT NULL CHECK (session_type IN ('orientation', 'pre_employment', 'quarterly', 'custom')),
  
  -- Zoom details
  zoom_link TEXT,
  zoom_meeting_id TEXT,
  zoom_password TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER DEFAULT 60,
  
  -- Attendance
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE training_attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  attended BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ,
  left_at TIMESTAMPTZ,
  attendance_duration_minutes INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(session_id, participant_id)
);

-- ============================================
-- NOTIFICATIONS
-- ============================================

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('job_posted', 'application_received', 'application_status', 'match_found', 'training_scheduled', 'payment_required', 'placement_confirmed')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT, -- URL to relevant page
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- MESSAGES/COMMUNICATION
-- ============================================

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  graduate_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(farm_id, graduate_id, job_id)
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PAYMENTS
-- ============================================

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  placement_id UUID NOT NULL REFERENCES placements(id) ON DELETE CASCADE,
  farm_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  amount DECIMAL(10, 2) NOT NULL DEFAULT 200.00,
  currency TEXT DEFAULT 'GHS',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded')),
  
  -- Payment provider details (Paystack)
  payment_reference TEXT,
  paystack_reference TEXT,
  payment_method TEXT,
  
  -- Timestamps
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES for Performance
-- ============================================

CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_verified ON profiles(is_verified);
CREATE INDEX idx_profiles_location ON profiles(farm_location, preferred_region);

CREATE INDEX idx_jobs_farm ON jobs(farm_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_location ON jobs(location);
CREATE INDEX idx_jobs_type ON jobs(job_type);

CREATE INDEX idx_applications_job ON applications(job_id);
CREATE INDEX idx_applications_applicant ON applications(applicant_id);
CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_applications_match_score ON applications(match_score DESC);

CREATE INDEX idx_placements_farm ON placements(farm_id);
CREATE INDEX idx_placements_graduate ON placements(graduate_id);
CREATE INDEX idx_placements_status ON placements(status);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(read, created_at DESC);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_sender ON messages(sender_id);

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Profiles: Users can insert their own profile, read their own, update their own
CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Jobs: Farms can manage their own jobs, everyone can view active jobs
CREATE POLICY "Anyone can view active jobs" ON jobs
  FOR SELECT USING (status = 'active');

CREATE POLICY "Farms can manage own jobs" ON jobs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'farm'
      AND profiles.id = jobs.farm_id
    )
  );

-- Applications: Applicants can view their own, farms can view for their jobs
CREATE POLICY "Applicants can view own applications" ON applications
  FOR SELECT USING (auth.uid() = applicant_id);

CREATE POLICY "Farms can view applications for their jobs" ON applications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM jobs
      WHERE jobs.id = applications.job_id
      AND jobs.farm_id IN (
        SELECT id FROM profiles WHERE id = auth.uid() AND role = 'farm'
      )
    )
  );

CREATE POLICY "Users can create applications" ON applications
  FOR INSERT WITH CHECK (
    auth.uid() = applicant_id
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('graduate', 'student')
      AND profiles.is_verified = TRUE
    )
  );

-- Notifications: Users can only view their own
CREATE POLICY "Users can view own notifications" ON notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications" ON notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Function to automatically create profile on user signup
-- Note: This creates a minimal profile. The API will update it with full details.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role, full_name)
  VALUES (
    NEW.id, 
    NEW.email, 
    COALESCE(NEW.raw_user_meta_data->>'role', 'graduate'),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NULL)
  )
  ON CONFLICT (id) DO NOTHING; -- Prevent errors if profile already exists
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_applications_updated_at BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate match score
CREATE OR REPLACE FUNCTION calculate_match_score(
  p_job_id UUID,
  p_applicant_id UUID
) RETURNS INTEGER AS $$
DECLARE
  v_score INTEGER := 0;
  v_job_location TEXT;
  v_applicant_region TEXT;
  v_job_type TEXT;
  v_applicant_qualification TEXT;
BEGIN
  -- Get job details
  SELECT location, job_type INTO v_job_location, v_job_type
  FROM jobs WHERE id = p_job_id;
  
  -- Get applicant details
  SELECT preferred_region, qualification INTO v_applicant_region, v_applicant_qualification
  FROM profiles WHERE id = p_applicant_id;
  
  -- Location match: +50 points
  IF v_job_location = v_applicant_region THEN
    v_score := v_score + 50;
  END IF;
  
  -- Qualification match: +30 points
  -- (Add more sophisticated matching logic here)
  
  -- Verified status: +20 points
  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_applicant_id AND is_verified = TRUE) THEN
    v_score := v_score + 20;
  END IF;
  
  RETURN v_score;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-calculate match score on application
CREATE OR REPLACE FUNCTION auto_calculate_match_score()
RETURNS TRIGGER AS $$
BEGIN
  NEW.match_score := calculate_match_score(NEW.job_id, NEW.applicant_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_match_on_application
  BEFORE INSERT OR UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION auto_calculate_match_score();

-- Function to create notification
CREATE OR REPLACE FUNCTION create_notification(
  p_user_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_message TEXT,
  p_link TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_notification_id UUID;
BEGIN
  INSERT INTO notifications (user_id, type, title, message, link)
  VALUES (p_user_id, p_type, p_title, p_message, p_link)
  RETURNING id INTO v_notification_id;
  
  RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to notify farm when application is received
CREATE OR REPLACE FUNCTION notify_farm_on_application()
RETURNS TRIGGER AS $$
DECLARE
  v_farm_id UUID;
  v_job_title TEXT;
BEGIN
  SELECT farm_id, title INTO v_farm_id, v_job_title
  FROM jobs WHERE id = NEW.job_id;
  
  PERFORM create_notification(
    v_farm_id,
    'application_received',
    'New Application Received',
    'You have received a new application for: ' || v_job_title,
    '/dashboard/jobs/' || NEW.job_id || '/applications'
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_application_created
  AFTER INSERT ON applications
  FOR EACH ROW EXECUTE FUNCTION notify_farm_on_application();

-- Trigger to notify applicant when application status changes
CREATE OR REPLACE FUNCTION notify_applicant_on_status_change()
RETURNS TRIGGER AS $$
DECLARE
  v_job_title TEXT;
BEGIN
  IF NEW.status != OLD.status THEN
    SELECT title INTO v_job_title FROM jobs WHERE id = NEW.job_id;
    
    PERFORM create_notification(
      NEW.applicant_id,
      'application_status',
      'Application Status Updated',
      'Your application for ' || v_job_title || ' has been ' || NEW.status,
      '/dashboard/applications/' || NEW.id
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_application_status_change
  AFTER UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION notify_applicant_on_status_change();
