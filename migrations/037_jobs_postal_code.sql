-- Optional postal / digital address for job listings (structured data, maps)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS postal_code TEXT;
