-- Least-privilege role for the trusted loyalty API, never for a client.
-- Apply after the identity (PR #5) and loyalty migrations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stampies_loyalty_runtime') THEN
    CREATE ROLE stampies_loyalty_runtime NOLOGIN NOINHERIT;
  END IF;
END $$;
GRANT USAGE ON SCHEMA stampies_identity TO stampies_loyalty_runtime;
GRANT SELECT (id, business_id, status)
  ON stampies_identity.merchants TO stampies_loyalty_runtime;
GRANT USAGE ON SCHEMA stampies_loyalty TO stampies_loyalty_runtime;

GRANT SELECT, INSERT ON stampies_loyalty.locations TO stampies_loyalty_runtime;
GRANT SELECT, INSERT ON stampies_loyalty.programs TO stampies_loyalty_runtime;
GRANT SELECT, INSERT ON stampies_loyalty.enrollment_grants TO stampies_loyalty_runtime;
GRANT DELETE ON stampies_loyalty.enrollment_grants TO stampies_loyalty_runtime;
GRANT SELECT, INSERT ON stampies_loyalty.memberships TO stampies_loyalty_runtime;
GRANT UPDATE (balance, lifetime_stamps, rewards_redeemed, updated_at)
  ON stampies_loyalty.memberships TO stampies_loyalty_runtime;
GRANT SELECT, INSERT ON stampies_loyalty.events TO stampies_loyalty_runtime;

-- No ownership, DDL, generic DELETE or user-wide UPDATE for this role.
-- Configure the NOLOGIN role's restricted service principal separately.
