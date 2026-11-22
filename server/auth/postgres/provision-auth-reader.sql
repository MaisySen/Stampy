-- Apply as a database owner after 001-merchant-identities.sql.
-- NOLOGIN by default. An operator must configure secure LOGIN credentials
-- through their secret manager before creating a dedicated read-only pool.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stampies_auth_reader') THEN
    CREATE ROLE stampies_auth_reader NOLOGIN NOINHERIT;
  END IF;
END $$;

GRANT USAGE ON SCHEMA stampies_identity TO stampies_auth_reader;
GRANT SELECT (id, business_id, status)
  ON stampies_identity.merchants TO stampies_auth_reader;
GRANT SELECT (merchant_id, issuer, subject, role, status)
  ON stampies_identity.merchant_memberships TO stampies_auth_reader;

-- Intentionally grant no INSERT, UPDATE, DELETE, DDL or Wallet ledger access.
