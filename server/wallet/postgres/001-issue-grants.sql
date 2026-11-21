BEGIN;
CREATE SCHEMA IF NOT EXISTS stampies_wallet;
REVOKE ALL ON SCHEMA stampies_wallet FROM PUBLIC;
CREATE TABLE IF NOT EXISTS stampies_wallet.issue_grants (
  digest TEXT PRIMARY KEY CHECK (digest ~ '^[a-f0-9]{64}$'),
  owner TEXT NOT NULL CHECK (owner ~ '^[A-Za-z0-9_-]{22,80}$'),
  serial TEXT NOT NULL CHECK (serial ~ '^[A-Za-z0-9_-]{8,80}$'),
  path TEXT NOT NULL CHECK (path IN ('/wallet/apple', '/wallet/google')),
  expires BIGINT NOT NULL CHECK (expires > 0)
);
CREATE INDEX IF NOT EXISTS issue_grants_expires ON stampies_wallet.issue_grants (expires);
CREATE INDEX IF NOT EXISTS issue_grants_limit ON stampies_wallet.issue_grants (owner, serial, path, expires);
COMMIT;
