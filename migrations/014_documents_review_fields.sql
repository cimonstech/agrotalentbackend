-- Add review fields and status to documents, and expand document_type options

-- Add review/status columns if missing
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Expand document_type check constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_name = 'documents'
      AND constraint_name = 'documents_document_type_check'
  ) THEN
    ALTER TABLE documents DROP CONSTRAINT documents_document_type_check;
  END IF;
END$$;

ALTER TABLE documents
  ADD CONSTRAINT documents_document_type_check
  CHECK (
    document_type IN (
      'certificate',
      'transcript',
      'cv',
      'nss_letter',
      'student_id',
      'nss_document',
      'farm_registration'
    )
  );

CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
