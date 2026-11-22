import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// This test starts its own cluster, with no TCP listener or external DB URL.
// Missing PostgreSQL binaries FAIL the test rather than silently skipping it.
const root = fileURLToPath(new URL('../', import.meta.url));
const systemBins = existsSync('/usr/lib/postgresql') ?
  readdirSync('/usr/lib/postgresql').sort((a, b) => Number(b) - Number(a))
    .map((v) => `/usr/lib/postgresql/${v}/bin`) : [];
const bin = process.env.PG_BIN || systemBins.find((p) => existsSync(join(p, 'initdb')));
const executable = (name) => bin ? join(bin, name) : name;
const testEnv = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !key.startsWith('PG')));
function run(command, args, input) {
  const result = spawnSync(command, args, {
    input, encoding: 'utf8', timeout: 30000,
    env: testEnv,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

test('loyalty migration and runtime grants on disposable real PostgreSQL', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'stampies-pg-'));
  const data = join(dir, 'data');
  const socket = join(dir, 'socket');
  mkdirSync(socket, {mode: 0o700});
  let started = false;
  const psqlBin = bin && existsSync(join(bin, 'psql')) ? join(bin, 'psql') : 'psql';
  const args = ['-X', '-h', socket, '-p', '5432', '-U', 'stampies_test_admin',
    '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'];
  const sql = (text) => run(psqlBin, args, text);
  const file = (path) => run(psqlBin, [...args, '--single-transaction', '-f', resolve(root, path)]);
  const check = (text) => assert.equal(sql(text), 't');
  const rejects = (statement, condition) => {
    // Deliberately distinct expected SQLSTATEs, so unrelated errors cannot pass.
    sql(`DO $test$ BEGIN
      BEGIN
        ${statement};
        RAISE EXCEPTION 'statement unexpectedly succeeded';
      EXCEPTION WHEN ${condition} THEN NULL;
      END;
    END $test$;`);
  };
  try {
    run(executable('initdb'), ['-D', data, '-U', 'stampies_test_admin', '-A', 'trust', '--no-locale', '-E', 'UTF8']);
    run(executable('pg_ctl'), ['-D', data, '-l', join(dir, 'server.log'), '-o', `-h "" -k ${socket}`, '-w', 'start']);
    started = true;
    t.diagnostic(sql('SELECT version();'));
    // Exact PR #5 prerequisite, pinned and documented with the fixture.
    file('tests/fixtures/merchant-identities.pr5.sql');
    file('server/loyalty/postgres/001-loyalty-ledger.sql');
    file('server/loyalty/postgres/provision-loyalty-runtime.sql');

    await t.test('migration creates exactly five empty tables and expected indexes', () => {
      check(`SELECT array_agg(tablename::text ORDER BY tablename) =
        ARRAY['enrollment_grants','events','locations','memberships','programs']
        FROM pg_tables WHERE schemaname='stampies_loyalty';`);
      check(`SELECT (SELECT count(*) FROM stampies_loyalty.locations) +
        (SELECT count(*) FROM stampies_loyalty.programs) +
        (SELECT count(*) FROM stampies_loyalty.enrollment_grants) +
        (SELECT count(*) FROM stampies_loyalty.memberships) +
        (SELECT count(*) FROM stampies_loyalty.events) = 0;`);
      check(`SELECT count(*) = 4 FROM pg_indexes WHERE schemaname='stampies_loyalty'
        AND indexname IN ('enrollment_grants_expiry','memberships_merchant_program',
        'loyalty_events_day','loyalty_events_recent');`);
      check(`SELECT array_agg(column_name::text ORDER BY ordinal_position) =
        ARRAY['digest','merchant_id','program_id','expires_at','created_at']
        FROM information_schema.columns WHERE table_schema='stampies_loyalty'
        AND table_name='enrollment_grants';`);
    });

    // All rows below are isolated test fixtures, not migration seed data.
    sql(`INSERT INTO stampies_identity.merchants(id,business_id,name) VALUES
      ('11111111-1111-4111-8111-111111111111','test-one','Test One'),
      ('22222222-2222-4222-8222-222222222222','test-two','Test Two');
      INSERT INTO stampies_loyalty.programs(id,merchant_id,public_code,reward_text,target,time_zone) VALUES
      ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','test-program-one','Test reward',2,'Australia/Sydney'),
      ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','test-program-two','Test reward',2,'Australia/Sydney');
      INSERT INTO stampies_loyalty.locations(id,merchant_id,code,name) VALUES
      ('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','one','Test One'),
      ('66666666-6666-4666-8666-666666666666','22222222-2222-4222-8222-222222222222','two','Test Two');
      INSERT INTO stampies_loyalty.memberships(id,merchant_id,program_id,pass_id) VALUES
      ('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333','stp_00000000000000000000000000000001');`);
    const merchant = "'11111111-1111-4111-8111-111111111111'";
    const otherMerchant = "'22222222-2222-4222-8222-222222222222'";
    const program = "'33333333-3333-4333-8333-333333333333'";
    const member = "'77777777-7777-4777-8777-777777777777'";
    const location = "'55555555-5555-4555-8555-555555555555'";
    const grant = (digest, owner = merchant) => `INSERT INTO stampies_loyalty.enrollment_grants
      (digest,merchant_id,program_id,expires_at) VALUES (${digest},${owner},${program},now()+interval '5 minutes')`;
    const event = (key, owner = merchant, place = location) => `INSERT INTO stampies_loyalty.events
      (merchant_id,membership_id,location_id,event_type,request_key,request_digest,
      previous_balance,next_balance,local_day,actor_issuer,actor_subject)
      VALUES (${owner},${member},${place},'stamp','${key}',repeat('a',64),0,1,current_date,'https://test.invalid','test-subject')`;

    await t.test('membership and program defaults remain intact', () => {
      check(`SELECT balance=0 AND lifetime_stamps=0 AND rewards_redeemed=0 AND status='active'
        AND created_at IS NOT NULL AND updated_at IS NOT NULL FROM stampies_loyalty.memberships;`);
      check(`SELECT bool_and(daily_limit=1 AND cooldown_seconds=60 AND status='active') FROM stampies_loyalty.programs;`);
    });
    await t.test('digest constraint rejects malformed input and preserves unique valid grants', () => {
      rejects(grant("repeat('A',64)"), 'check_violation');
      rejects(grant("repeat('a',63)"), 'check_violation');
      rejects(grant("repeat('g',64)"), 'check_violation');
      sql(grant("repeat('a',64)"));
      rejects(grant("repeat('a',64)"), 'unique_violation');
      check('SELECT count(*)=1 FROM stampies_loyalty.enrollment_grants;');
    });
    await t.test('grant expiry and one-time consumption use the repaired columns', () => {
      sql(`UPDATE stampies_loyalty.enrollment_grants SET expires_at=now()-interval '1 second';`);
      check(`WITH consumed AS (DELETE FROM stampies_loyalty.enrollment_grants
        WHERE digest=repeat('a',64) AND merchant_id=${merchant} AND program_id=${program}
        AND expires_at>now() RETURNING digest) SELECT count(*)=0 FROM consumed;`);
      sql(`UPDATE stampies_loyalty.enrollment_grants SET expires_at=now()+interval '5 minutes';`);
      for (const count of [1, 0]) check(`WITH consumed AS (DELETE FROM stampies_loyalty.enrollment_grants
        WHERE digest=repeat('a',64) AND merchant_id=${merchant} AND program_id=${program}
        AND expires_at>now() RETURNING digest) SELECT count(*)=${count} FROM consumed;`);
    });
    await t.test('composite foreign keys reject cross-merchant grants, memberships and events', () => {
      rejects(grant("repeat('b',64)", otherMerchant), 'foreign_key_violation');
      rejects(`INSERT INTO stampies_loyalty.memberships(merchant_id,program_id,pass_id)
        VALUES(${otherMerchant},${program},'stp_00000000000000000000000000000002')`, 'foreign_key_violation');
      rejects(event('cross-merchant-01', otherMerchant), 'foreign_key_violation');
      rejects(event('cross-location-01', merchant, "'66666666-6666-4666-8666-666666666666'"), 'foreign_key_violation');
    });
    await t.test('balance, pass, program limits and event checks are enforced by PostgreSQL', () => {
      for (const balance of [-1, 101]) rejects(`UPDATE stampies_loyalty.memberships SET balance=${balance}`, 'check_violation');
      rejects(`UPDATE stampies_loyalty.memberships SET pass_id='invalid'`, 'check_violation');
      rejects('UPDATE stampies_loyalty.memberships SET lifetime_stamps=-1', 'check_violation');
      rejects('UPDATE stampies_loyalty.memberships SET rewards_redeemed=-1', 'check_violation');
      for (const assignment of ['target=0','target=101','daily_limit=0','daily_limit=21',
        'cooldown_seconds=-1','cooldown_seconds=86401']) {
        rejects(`UPDATE stampies_loyalty.programs SET ${assignment}`, 'check_violation');
      }
      sql(event('valid-request-0001'));
      rejects(`UPDATE stampies_loyalty.events SET event_type='other'`, 'check_violation');
      rejects(`UPDATE stampies_loyalty.events SET request_digest='invalid'`, 'check_violation');
      rejects('UPDATE stampies_loyalty.events SET next_balance=101', 'check_violation');
    });
    await t.test('unique pass IDs, public codes, tenant location codes and request keys reject duplicates', () => {
      rejects(event('valid-request-0001'), 'unique_violation');
      rejects(`INSERT INTO stampies_loyalty.memberships(merchant_id,program_id,pass_id)
        VALUES(${merchant},${program},'stp_00000000000000000000000000000001')`, 'unique_violation');
      rejects(`INSERT INTO stampies_loyalty.locations(merchant_id,code,name) VALUES(${merchant},'one','Duplicate')`, 'unique_violation');
      rejects(`INSERT INTO stampies_loyalty.programs(merchant_id,public_code,reward_text,target,time_zone)
        VALUES(${merchant},'test-program-one','Duplicate',2,'UTC')`, 'unique_violation');
    });
    await t.test('runtime role can create, consume, stamp and redeem within its column grants', () => {
      sql(`BEGIN; SET LOCAL ROLE stampies_loyalty_runtime;
        SELECT id,business_id,status FROM stampies_identity.merchants;
        INSERT INTO stampies_loyalty.locations(merchant_id,code,name) VALUES(${merchant},'runtime','Runtime');
        INSERT INTO stampies_loyalty.programs(merchant_id,public_code,reward_text,target,time_zone)
          VALUES(${merchant},'runtime-program','Test reward',2,'UTC');
        ${grant("repeat('c',64)")};
        DELETE FROM stampies_loyalty.enrollment_grants WHERE digest=repeat('c',64) RETURNING digest;
        INSERT INTO stampies_loyalty.memberships(merchant_id,program_id,pass_id)
          VALUES(${merchant},${program},'stp_00000000000000000000000000000003');
        SELECT id FROM stampies_loyalty.memberships WHERE id=${member} FOR UPDATE;
        ${event('runtime-request-01')};
        UPDATE stampies_loyalty.memberships SET balance=2,lifetime_stamps=lifetime_stamps+1,updated_at=now() WHERE id=${member};
        INSERT INTO stampies_loyalty.events
          (merchant_id,membership_id,location_id,event_type,request_key,request_digest,
          previous_balance,next_balance,local_day,actor_issuer,actor_subject)
          VALUES(${merchant},${member},${location},'redeem','runtime-redeem-01',repeat('d',64),2,0,current_date,'https://test.invalid','test-subject');
        UPDATE stampies_loyalty.memberships SET balance=0,rewards_redeemed=rewards_redeemed+1,updated_at=now() WHERE id=${member};
        ROLLBACK;`);
      check('SELECT count(*)=1 FROM stampies_loyalty.events;');
    });
    await t.test('runtime cannot rewrite audit history, tenancy, identity or schema', () => {
      for (const statement of [
        'UPDATE stampies_loyalty.events SET next_balance=0',
        'DELETE FROM stampies_loyalty.events',
        'DELETE FROM stampies_loyalty.memberships',
        `UPDATE stampies_loyalty.memberships SET merchant_id=${otherMerchant}`,
        "UPDATE stampies_identity.merchants SET status='closed'",
        'SELECT * FROM stampies_identity.merchant_memberships',
        'CREATE TABLE stampies_loyalty.forbidden(id int)',
        'ALTER TABLE stampies_loyalty.events ADD COLUMN forbidden int',
        'TRUNCATE stampies_loyalty.events',
      ]) rejects(`SET LOCAL ROLE stampies_loyalty_runtime; ${statement}`, 'insufficient_privilege');
      check(`SELECT NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb
        AND NOT rolcreaterole AND NOT rolbypassrls FROM pg_roles WHERE rolname='stampies_loyalty_runtime';`);
    });
    await t.test('PUBLIC has no loyalty schema or table access', () => {
      sql('CREATE ROLE stampies_test_anonymous NOLOGIN NOINHERIT;');
      check(`SELECT NOT has_schema_privilege('stampies_test_anonymous','stampies_loyalty','USAGE');`);
      for (const table of ['locations','programs','enrollment_grants','memberships','events']) {
        check(`SELECT NOT has_table_privilege('stampies_test_anonymous','stampies_loyalty.${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');`);
        rejects(`SET LOCAL ROLE stampies_test_anonymous; SELECT * FROM stampies_loyalty.${table}`, 'insufficient_privilege');
      }
    });
    await t.test('failed transaction rolls back preceding event insert and balance update', () => {
      const failed = spawnSync(psqlBin, args, {encoding: 'utf8', timeout: 30000, env: testEnv,
        input: `BEGIN; ${event('rollback-request-01')};
          UPDATE stampies_loyalty.memberships SET balance=1 WHERE id=${member};
          UPDATE stampies_loyalty.memberships SET balance=-1 WHERE id=${member}; COMMIT;`});
      assert.ifError(failed.error);
      assert.equal(failed.status, 3);
      assert.match(failed.stderr, /check constraint/);
      check('SELECT count(*)=1 FROM stampies_loyalty.events;');
      check(`SELECT balance=0 AND lifetime_stamps=0 AND rewards_redeemed=0 FROM stampies_loyalty.memberships WHERE id=${member};`);
    });
  } finally {
    if (started) run(executable('pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop']);
    rmSync(dir, {recursive: true, force: true});
  }
});
