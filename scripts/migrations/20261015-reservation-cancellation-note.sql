ALTER TABLE namche.reservations
  ADD COLUMN IF NOT EXISTS cancellation_note text NOT NULL DEFAULT ''
  CHECK (char_length(cancellation_note) <= 1000);
