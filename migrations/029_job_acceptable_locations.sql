ALTER TABLE jobs ADD COLUMN IF NOT EXISTS acceptable_regions TEXT[];
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS acceptable_cities TEXT[];
