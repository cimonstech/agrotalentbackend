-- Allow job_image uploads for social sharing photos

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
      'farm_registration',
      'job_image'
    )
  );
