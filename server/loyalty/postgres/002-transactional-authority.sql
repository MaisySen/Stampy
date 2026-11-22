-- Apply after the exact identity and loyalty 001 migrations and runtime grants.
-- One transaction prevents a window of PUBLIC execution on new functions.
BEGIN;
DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='stampies_permission_locker') THEN
    CREATE ROLE stampies_permission_locker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='stampies_permission_locker'
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members am JOIN pg_catalog.pg_roles r ON r.oid=am.roleid
      WHERE r.rolname='stampies_permission_locker') THEN
    RAISE EXCEPTION 'Unsafe permission-locker role configuration';
  END IF;
END $body$;
GRANT USAGE ON SCHEMA stampies_identity TO stampies_permission_locker;
GRANT SELECT (id,business_id,status) ON stampies_identity.merchants TO stampies_permission_locker;
GRANT SELECT (merchant_id,issuer,subject,role,status) ON stampies_identity.merchant_memberships TO stampies_permission_locker;
-- PostgreSQL row locking requires UPDATE privilege on at least one column.
-- Only the nonlogin function owner gets it, never the loyalty runtime.
GRANT UPDATE (updated_at) ON stampies_identity.merchants, stampies_identity.merchant_memberships TO stampies_permission_locker;

CREATE FUNCTION stampies_identity.lock_staff_authority(
  p_business text, p_issuer text, p_subject text, p_operation text
) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $body$
DECLARE
  v_merchant uuid;
  v_status text;
  v_member_status text;
  v_role text;
BEGIN
  -- Separate statements deliberately define the canonical row-lock order.
  SELECT m.id,m.status INTO v_merchant,v_status
    FROM stampies_identity.merchants AS m WHERE m.business_id=p_business FOR SHARE;
  IF NOT FOUND OR v_status <> 'active' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='FORBIDDEN';
  END IF;
  SELECT ms.status,ms.role INTO v_member_status,v_role
    FROM stampies_identity.merchant_memberships AS ms
    WHERE ms.merchant_id=v_merchant AND ms.issuer=p_issuer AND ms.subject=p_subject FOR SHARE;
  IF NOT FOUND OR v_member_status <> 'active' OR p_operation IS NULL OR NOT (
    (p_operation IN ('create_location','create_program') AND v_role IN ('owner','admin')) OR
    (p_operation IN ('grant','stamp','redeem','read_pass') AND v_role IN ('owner','admin','manager','staff'))
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='FORBIDDEN';
  END IF;
  RETURN v_merchant;
END $body$;
REVOKE ALL ON FUNCTION stampies_identity.lock_staff_authority(text,text,text,text) FROM PUBLIC;

CREATE FUNCTION stampies_identity.lock_enrollment_merchant(p_merchant uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $body$
DECLARE v_merchant uuid; v_status text;
BEGIN
  SELECT m.id,m.status INTO v_merchant,v_status
    FROM stampies_identity.merchants AS m WHERE m.id=p_merchant FOR SHARE;
  IF NOT FOUND OR v_status <> 'active' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='PROGRAM_UNAVAILABLE';
  END IF;
  RETURN v_merchant;
END $body$;
REVOKE ALL ON FUNCTION stampies_identity.lock_enrollment_merchant(uuid) FROM PUBLIC;

-- Needed only for ownership transfer. Revoked before COMMIT.
GRANT CREATE ON SCHEMA stampies_identity TO stampies_permission_locker;
ALTER FUNCTION stampies_identity.lock_staff_authority(text,text,text,text) OWNER TO stampies_permission_locker;
ALTER FUNCTION stampies_identity.lock_enrollment_merchant(uuid) OWNER TO stampies_permission_locker;
REVOKE CREATE ON SCHEMA stampies_identity FROM stampies_permission_locker;
GRANT EXECUTE ON FUNCTION stampies_identity.lock_staff_authority(text,text,text,text),
  stampies_identity.lock_enrollment_merchant(uuid) TO stampies_loyalty_runtime;
-- Allow lifecycle SHARE locks, without granting status/configuration changes.
GRANT UPDATE (id) ON stampies_loyalty.programs, stampies_loyalty.locations TO stampies_loyalty_runtime;
COMMIT;
