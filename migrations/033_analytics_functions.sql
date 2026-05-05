-- Job view tracking and analytics

CREATE TABLE IF NOT EXISTS job_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  viewer_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  viewer_role TEXT DEFAULT 'anonymous',
  viewer_region TEXT,
  viewed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_views_job_id_viewed_at_idx
  ON job_views (job_id, viewed_at DESC);

CREATE INDEX IF NOT EXISTS job_views_viewer_job_viewed_at_idx
  ON job_views (viewer_id, job_id, viewed_at DESC)
  WHERE viewer_id IS NOT NULL;

DROP MATERIALIZED VIEW IF EXISTS job_view_counts;
CREATE MATERIALIZED VIEW job_view_counts AS
SELECT
  job_id,
  COUNT(*)::BIGINT AS total_views,
  COUNT(DISTINCT viewer_id)::BIGINT AS unique_views,
  COUNT(*) FILTER (WHERE viewed_at >= NOW() - INTERVAL '30 days')::BIGINT AS views_30d,
  COUNT(*) FILTER (WHERE viewed_at >= NOW() - INTERVAL '7 days')::BIGINT AS views_7d
FROM job_views
GROUP BY job_id;

CREATE UNIQUE INDEX IF NOT EXISTS job_view_counts_job_id_idx
  ON job_view_counts (job_id);

-- Daily views for a single job (used for charts)
CREATE OR REPLACE FUNCTION get_daily_job_views(
  p_job_id UUID,
  p_since TIMESTAMPTZ
)
RETURNS TABLE (day DATE, view_count BIGINT) AS $$
  SELECT
    viewed_at::date AS day,
    COUNT(*)::BIGINT AS view_count
  FROM job_views
  WHERE job_id = p_job_id
    AND viewed_at >= p_since
  GROUP BY viewed_at::date
  ORDER BY day ASC;
$$ LANGUAGE sql STABLE;

-- Batch application counts by job IDs
CREATE OR REPLACE FUNCTION get_application_counts_by_jobs(
  p_job_ids UUID[]
)
RETURNS TABLE (job_id UUID, count BIGINT) AS $$
  SELECT
    job_id,
    COUNT(*)::BIGINT AS count
  FROM applications
  WHERE job_id = ANY(p_job_ids)
  GROUP BY job_id;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION refresh_job_view_counts()
RETURNS void AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY job_view_counts;
$$ LANGUAGE sql;

GRANT SELECT ON job_view_counts TO authenticated;
GRANT SELECT ON job_view_counts TO anon;

