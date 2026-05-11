-- Job photos uploaded during job posting must not sit in the document verification queue.
-- Historic rows: auto-resolve pending job_image entries (URLs remain valid on jobs.image_url).

UPDATE documents
SET
  status = 'approved',
  reviewed_at = COALESCE(reviewed_at, NOW()),
  rejection_reason = NULL
WHERE document_type = 'job_image'
  AND status = 'pending';
