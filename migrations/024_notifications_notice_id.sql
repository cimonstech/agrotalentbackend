-- Optional: link notice notifications to the notice for correct "View Details" URL
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS notice_id UUID REFERENCES notices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_notice_id ON notifications(notice_id);

COMMENT ON COLUMN notifications.notice_id IS 'Set for type=notice; used to build /dashboard/{role}/notices/{id} link.';
