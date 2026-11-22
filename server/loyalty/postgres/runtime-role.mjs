// Effective-login startup contract, not RLS or proof against compromised server
// code. Migrations/provisioning are separate privileged operator work.
const contract=`
WITH actor AS (
 SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user AND current_user=session_user
 AND rolcanlogin AND rolinherit AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
 AND NOT rolreplication AND NOT rolbypassrls
), base AS (
 SELECT oid FROM pg_catalog.pg_roles WHERE rolname='stampies_loyalty_runtime'
 AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreaterole
 AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls
), expected(ns,name,ins,del,selcols,updcols) AS (VALUES
 ('stampies_identity','merchants',false,false,ARRAY['id','business_id','status']::text[],ARRAY[]::text[]),
 ('stampies_loyalty','locations',true,false,NULL::text[],ARRAY[]::text[]),
 ('stampies_loyalty','programs',true,false,NULL::text[],ARRAY[]::text[]),
 ('stampies_loyalty','enrollment_grants',true,true,NULL::text[],ARRAY[]::text[]),
 ('stampies_loyalty','memberships',true,false,NULL::text[],ARRAY['balance','lifetime_stamps','rewards_redeemed','updated_at']),
 ('stampies_loyalty','events',true,false,NULL::text[],ARRAY[]::text[])
), matched AS (
 SELECT c.oid,e.* FROM expected e JOIN pg_catalog.pg_namespace n ON n.nspname=e.ns
 JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=e.name AND c.relkind='r'
), helpers AS (
 SELECT p.* FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname,p.proname) IN (('stampies_identity','lock_staff_authority'),('stampies_identity','lock_enrollment_merchant'),
 ('stampies_loyalty','lock_program_lifecycle'),('stampies_loyalty','lock_location_lifecycle'))
)
SELECT
 EXISTS(SELECT 1 FROM actor) AND EXISTS(SELECT 1 FROM base WHERE pg_catalog.pg_has_role(oid,'USAGE')) AS login_ok,
 NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid<>(SELECT oid FROM actor)
 AND pg_catalog.pg_has_role(r.oid,'MEMBER') AND r.oid<>(SELECT oid FROM base))
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN actor a ON a.oid=m.member WHERE m.admin_option) AS roles_ok,
 NOT pg_catalog.has_database_privilege(current_database(),'CREATE') AND NOT EXISTS(
 SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema')
 AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
 AND pg_catalog.has_schema_privilege(n.oid,'CREATE')) AS no_ddl,
 pg_catalog.has_schema_privilege('stampies_identity','USAGE') AND pg_catalog.has_schema_privilege('stampies_loyalty','USAGE')
 AND NOT pg_catalog.has_schema_privilege('stampies_identity','USAGE WITH GRANT OPTION')
 AND NOT pg_catalog.has_schema_privilege('stampies_loyalty','USAGE WITH GRANT OPTION') AS schema_ok,
 (SELECT count(*)::int FROM matched) AS tables,
 NOT EXISTS(SELECT 1 FROM matched m WHERE
 pg_catalog.has_table_privilege(m.oid,'SELECT') IS DISTINCT FROM (m.selcols IS NULL)
 OR pg_catalog.has_table_privilege(m.oid,'INSERT') IS DISTINCT FROM m.ins
 OR pg_catalog.has_any_column_privilege(m.oid,'INSERT') IS DISTINCT FROM m.ins
 OR pg_catalog.has_table_privilege(m.oid,'DELETE') IS DISTINCT FROM m.del
 OR pg_catalog.has_table_privilege(m.oid,'UPDATE,TRUNCATE,REFERENCES,TRIGGER')
 OR pg_catalog.has_any_column_privilege(m.oid,'REFERENCES')
 OR pg_catalog.has_table_privilege(m.oid,'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION')
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=m.oid AND a.attnum>0 AND NOT a.attisdropped AND (
 pg_catalog.has_column_privilege(m.oid,a.attnum,'UPDATE') IS DISTINCT FROM (a.attname::text=ANY(m.updcols))
 OR pg_catalog.has_column_privilege(m.oid,a.attnum,'SELECT') IS DISTINCT FROM (m.selcols IS NULL OR a.attname::text=ANY(m.selcols))
 OR pg_catalog.has_column_privilege(m.oid,a.attnum,'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION')))) AS grants_ok,
 NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
 AND c.relkind IN ('r','p','v','m','f') AND NOT EXISTS(SELECT 1 FROM matched m WHERE m.oid=c.oid)
 AND (pg_catalog.has_table_privilege(c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 OR pg_catalog.has_any_column_privilege(c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) AS no_other_tables,
 (SELECT count(*)::int FROM helpers) AS functions,
 NOT EXISTS(SELECT 1 FROM helpers p JOIN pg_catalog.pg_roles r ON r.oid=p.proowner WHERE
 NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[]
 OR r.rolname<>'stampies_permission_locker' OR r.rolcanlogin OR r.rolsuper OR r.rolcreaterole OR r.rolcreatedb
 OR r.rolreplication OR r.rolbypassrls OR r.rolinherit
 OR NOT pg_catalog.has_function_privilege(p.oid,'EXECUTE')
 OR pg_catalog.has_function_privilege(p.oid,'EXECUTE WITH GRANT OPTION')
 OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
 WHERE a.grantee NOT IN (p.proowner,(SELECT oid FROM base)) OR a.privilege_type<>'EXECUTE'
 OR (a.is_grantable AND a.grantee<>p.proowner))) AS helpers_ok,
 NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
 AND NOT EXISTS(SELECT 1 FROM helpers h WHERE h.oid=p.oid) AND pg_catalog.has_function_privilege(p.oid,'EXECUTE')) AS no_other_functions,
 NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='S' AND n.nspname NOT IN ('pg_catalog','information_schema')
 AND CASE WHEN c.relkind='S' THEN pg_catalog.has_sequence_privilege(c.oid,'USAGE,SELECT,UPDATE') ELSE false END) AS no_sequences`;

export async function verifyLoyaltyRuntimeRole(pool) {
 let row;
 try{const result=await pool.query({text:contract,query_timeout:5000});if(result.rowCount===1)row=result.rows[0];}
 catch{throw new Error('Loyalty database startup verification failed');}
 const flags=['login_ok','roles_ok','no_ddl','schema_ok','grants_ok','no_other_tables','helpers_ok','no_other_functions','no_sequences'];
 if(row?.tables!==6||row?.functions!==4||!flags.every(key=>row[key]===true))throw new Error('Loyalty database privileges are not restricted');
 return true;
}
