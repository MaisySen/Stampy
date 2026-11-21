const CONTRACT=`
WITH actor AS (
  SELECT oid FROM pg_catalog.pg_roles
  WHERE rolname=current_user AND current_user=session_user AND rolname='stampies_wallet_runtime'
    AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreaterole
    AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls
), wallet_ns AS (
  SELECT oid FROM pg_catalog.pg_namespace WHERE nspname='stampies_wallet'
), expected(name,ins,del,update_cols) AS (VALUES
  ('issue_grants',true,true,ARRAY[]::text[]),
  ('apple_clock',false,false,ARRAY['revision']),
  ('apple_pass',true,false,ARRAY['payload','source_version','revision']),
  ('apple_registration',true,true,ARRAY['encrypted_push']),
  ('apple_wake',true,true,ARRAY['revision','ready_at','lease_id','lease_until','failures'])
), matched AS (
  SELECT c.oid,e.ins,e.del,e.update_cols FROM expected e
  JOIN wallet_ns n ON true
  JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=e.name AND c.relkind IN ('r','p')
), extra_access AS (
  SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema')
    AND n.nspname NOT LIKE 'pg_toast%' AND NOT EXISTS (SELECT 1 FROM matched m WHERE m.oid=c.oid)
    AND (pg_catalog.has_table_privilege(c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR pg_catalog.has_any_column_privilege(c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
)
SELECT EXISTS(SELECT 1 FROM actor) AS role_ok,
  NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members r JOIN actor a ON a.oid=r.member) AS no_role_membership,
  EXISTS(SELECT 1 FROM wallet_ns WHERE pg_catalog.has_schema_privilege(oid,'USAGE') AND NOT pg_catalog.has_schema_privilege(oid,'CREATE')) AS schema_ok,
  NOT pg_catalog.has_database_privilege(current_database(),'CREATE') AS no_database_create,
  NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n
      WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
        AND n.nspname NOT LIKE 'pg_temp_%' AND pg_catalog.has_schema_privilege(n.oid,'CREATE')) AS no_persistent_schema_create,
  (SELECT count(*)::int FROM matched) AS matched_count,
  NOT EXISTS(SELECT 1 FROM matched m WHERE NOT pg_catalog.has_table_privilege(m.oid,'SELECT')
    OR pg_catalog.has_table_privilege(m.oid,'INSERT') IS DISTINCT FROM m.ins
    OR pg_catalog.has_any_column_privilege(m.oid,'INSERT') IS DISTINCT FROM m.ins
    OR pg_catalog.has_any_column_privilege(m.oid,'REFERENCES')
    OR pg_catalog.has_table_privilege(m.oid,'DELETE') IS DISTINCT FROM m.del
    OR pg_catalog.has_table_privilege(m.oid,'UPDATE,TRUNCATE,REFERENCES,TRIGGER')
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=m.oid AND a.attnum>0 AND NOT a.attisdropped
         AND pg_catalog.has_column_privilege(m.oid,a.attnum,'UPDATE') IS DISTINCT FROM (a.attname::text=ANY(m.update_cols)))
  ) AS exact_grants,
  NOT EXISTS(SELECT 1 FROM extra_access) AS no_other_object_grants`;

// Probe the effective login before a handler accepts requests. Never return SQL or driver errors to a caller.
export async function verifyWalletRuntimeRole(pool) {
  if (!pool || typeof pool.query!=='function') throw new Error('Wallet database access not configured.');
  let row;
  try { const result=await pool.query({text:CONTRACT,query_timeout:5000});
    if(result.rowCount===1) row=result.rows[0];
  } catch { throw new Error('Wallet database access could not be verified.'); }
  const flags=['role_ok','no_role_membership','schema_ok','no_database_create','no_persistent_schema_create','exact_grants','no_other_object_grants'];
  if (row?.matched_count!==5 || !flags.every(k=>row[k]===true)) throw new Error('Wallet database access is not restricted.');
  return true;
}
