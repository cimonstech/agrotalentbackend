-- Backfill notice_id for existing notice notifications where link contains /notices/{uuid}
-- Run after 024_notifications_notice_id.sql

UPDATE notifications n
SET notice_id = sub.id
FROM (
  SELECT id AS notif_id, (regexp_match(link, '/notices/([0-9a-f-]{36})'))[1]::uuid AS id
  FROM notifications
  WHERE type = 'notice'
    AND notice_id IS NULL
    AND link IS NOT NULL
    AND link ~ '/notices/[0-9a-f-]{36}'
) sub
WHERE n.id = sub.notif_id;

-- Backfill notice_id for training_notice (and notice) where we can match by title (e.g. link was /dashboard/training)
UPDATE notifications n
SET notice_id = (
  SELECT no.id FROM notices no
  WHERE no.title = n.title
  ORDER BY no.created_at DESC
  LIMIT 1
)
WHERE n.type IN ('notice', 'training_notice')
  AND n.notice_id IS NULL
  AND EXISTS (SELECT 1 FROM notices no WHERE no.title = n.title);
