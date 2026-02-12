-- Notices: picture attachments (images stored in R2; URLs in notices.attachments)

ALTER TABLE notices
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]';

COMMENT ON COLUMN notices.attachments IS 'Array of { url, file_name } for uploaded images';
