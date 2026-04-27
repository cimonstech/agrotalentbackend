-- Job benefits, sourcing fields, and farm preview tokens

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS benefits JSONB;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS contract_type TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS accommodation_provided BOOLEAN DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS commission_included BOOLEAN DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS commission_percentage NUMERIC;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_sourced_job BOOLEAN DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_name TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_contact TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_phone TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_email TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS application_method TEXT DEFAULT 'platform';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS external_apply_url TEXT;

CREATE TABLE IF NOT EXISTS farm_preview_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  source_contact TEXT,
  source_phone TEXT,
  source_name TEXT,
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  registered_farm_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE farm_preview_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "farm_preview_tokens_select" ON farm_preview_tokens;
CREATE POLICY "farm_preview_tokens_select" ON farm_preview_tokens
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "farm_preview_tokens_update" ON farm_preview_tokens;
CREATE POLICY "farm_preview_tokens_update" ON farm_preview_tokens
  FOR UPDATE USING (true);
