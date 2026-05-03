-- Farm preview conversion tracking (token claimed at registration)

ALTER TABLE farm_preview_tokens
  ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS farm_preview_tokens_token_idx
  ON farm_preview_tokens (token)
  WHERE converted_at IS NULL;
