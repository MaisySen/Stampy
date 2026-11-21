BEGIN;
CREATE SCHEMA IF NOT EXISTS stampies_wallet;
REVOKE ALL ON SCHEMA stampies_wallet FROM PUBLIC;
CREATE TABLE IF NOT EXISTS stampies_wallet.apple_clock (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  revision BIGINT NOT NULL CHECK (revision BETWEEN 0 AND 999999999999999)
);
INSERT INTO stampies_wallet.apple_clock(singleton,revision) VALUES (true,0)
  ON CONFLICT (singleton) DO NOTHING;
CREATE TABLE IF NOT EXISTS stampies_wallet.apple_pass (
  serial TEXT PRIMARY KEY CHECK (serial ~ '^[A-Za-z0-9_-]{8,80}$'),
  payload TEXT NOT NULL CHECK (octet_length(payload) BETWEEN 2 AND 16384),
  source_version BIGINT NOT NULL CHECK (source_version BETWEEN 1 AND 9007199254740991),
  revision BIGINT NOT NULL CHECK (revision BETWEEN 1 AND 999999999999999)
);
CREATE TABLE IF NOT EXISTS stampies_wallet.apple_registration (
  device TEXT NOT NULL CHECK (device ~ '^[a-f0-9]{64}$'),
  serial TEXT NOT NULL REFERENCES stampies_wallet.apple_pass(serial),
  encrypted_push BYTEA NOT NULL CHECK (octet_length(encrypted_push) BETWEEN 60 AND 284),
  PRIMARY KEY(device,serial)
);
CREATE INDEX IF NOT EXISTS apple_registration_serial ON stampies_wallet.apple_registration(serial);
CREATE TABLE IF NOT EXISTS stampies_wallet.apple_wake (
  device TEXT NOT NULL,
  serial TEXT NOT NULL,
  revision BIGINT NOT NULL CHECK (revision BETWEEN 1 AND 999999999999999),
  ready_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  lease_id UUID,
  lease_until TIMESTAMPTZ,
  PRIMARY KEY(device,serial),
  FOREIGN KEY(device,serial) REFERENCES stampies_wallet.apple_registration(device,serial) ON DELETE CASCADE,
  CHECK ((lease_id IS NULL) = (lease_until IS NULL))
);
CREATE INDEX IF NOT EXISTS apple_wake_ready ON stampies_wallet.apple_wake(ready_at,revision);
COMMIT;
