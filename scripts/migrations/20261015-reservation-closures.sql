CREATE TABLE IF NOT EXISTS namche.reservation_closures (
  date date PRIMARY KEY,
  reason text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 300),
  created_by text REFERENCES namche.admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
