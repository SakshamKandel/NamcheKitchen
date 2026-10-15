ALTER TABLE namche.reservation_closures
  ADD COLUMN IF NOT EXISTS public_reason text NOT NULL DEFAULT '' CHECK (char_length(public_reason) <= 300);

CREATE TABLE IF NOT EXISTS namche.site_notices (
  id text PRIMARY KEY,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
  type text NOT NULL CHECK (type IN ('announcement','closure','event')),
  starts_on date,
  ends_on date,
  event_date date,
  enabled boolean NOT NULL DEFAULT true,
  created_by text REFERENCES namche.admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on)
);
