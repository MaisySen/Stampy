BEGIN;
CREATE TABLE IF NOT EXISTS stampies_wallet.stamp_ledger (
  stamp_id TEXT PRIMARY KEY CHECK (stamp_id ~ '^[A-Za-z0-9_-]{8,80}$'),
  pass_id TEXT NOT NULL CHECK (pass_id ~ '^[A-Za-z0-9_-]{8,80}$'),
  business_id TEXT NOT NULL CHECK (business_id ~ '^[A-Za-z0-9_-]{1,60}$'),
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms > 0),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS stamp_ledger_pass ON stampies_wallet.stamp_ledger (pass_id, created_at_ms);
COMMIT;
