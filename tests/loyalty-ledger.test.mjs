import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresLoyaltyLedger} from '../server/loyalty/postgres/ledger.mjs';

const merchantId = '11111111-1111-4111-8111-111111111111';
const programId = '22222222-2222-4222-8222-222222222222';
const membershipId = '33333333-3333-4333-8333-333333333333';
const locationId = '44444444-4444-4444-8444-444444444444';
const businessId = 'real-cafe';
const goodAccessToken = 'signed-access-token-fixture';

const code = (n) => ('request-' + String(n).padStart(12, '0'));
const stampArgs = (key) => ({
  accessToken: goodAccessToken, businessId, membershipId, locationId,
  idempotencyKey: code(key),
});

function fixture({target = 2, dailyLimit = 20, cooldownSeconds = 0,
  timeZone = 'Australia/Sydney'} = {}) {
  const state = {
    balance: 0, lifetimeStamps: 0, rewardsRedeemed: 0, events: [],
    grants: new Map(), commits: 0, rollbacks: 0, memberStatus: 'active',
    merchantStatus: 'active', programStatus: 'active', role: 'staff',
    membershipQueries: 0, dbCalls: 0, lockedReads: 0,
    time: new Date('2026-11-22T00:00:00.000Z'),
  };
  const merchant = {id: merchantId};
  let publicCode = 'public-test-code-has-32characters-123';
  const pool = {
    async connect() {
      let began = false;
      return {
        release() {},
        async query(queryText, params = []) {
          state.dbCalls++;
          const sql = queryText.trim().replace(/\s+/g, ' ');
          if (sql === 'BEGIN') { began = true; return {rows: []}; }
          if (sql === 'COMMIT') { state.commits++; began = false; return {rows: []}; }
          if (sql === 'ROLLBACK') { state.rollbacks++; began = false; return {rows: []}; }
          assert.ok(began, 'queries must run inside transaction');
          if (sql.startsWith('SELECT id FROM stampies_identity.merchants')) {
            return {rows: state.merchantStatus === 'active' ? [merchant] : []};
          }
          if (sql.includes('FOR UPDATE OF m')) {
            state.lockedReads++;
            return {rows: [{
              id: membershipId, balance: state.balance, member_status: state.memberStatus,
              target, daily_limit: dailyLimit, cooldown_seconds: cooldownSeconds,
              time_zone: timeZone, program_status: state.programStatus,
            }]};
          }
          if (sql.startsWith('SELECT event_type,request_digest,next_balance FROM stampies_loyalty.events')) {
            const event = state.events.find((e) => e.membershipId === params[0] && e.key === params[1]);
            return {rows: event ? [{event_type: event.kind,
              request_digest: event.digest, next_balance: event.next}] : []};
          }
          if (sql.startsWith('SELECT id FROM stampies_loyalty.locations')) {
            return {rows: params[0] === locationId && params[1] === merchantId ? [{id: locationId}] : []};
          }
          if (sql.startsWith('SELECT COUNT(*)::int AS total FROM stampies_loyalty.events')) {
            return {rows: [{total: state.events.filter((e) =>
              e.kind === 'stamp' && e.day === params[2]).length}]};
          }
          if (sql.startsWith('SELECT created_at FROM stampies_loyalty.events')) {
            const stamps = state.events.filter((e) => e.kind === 'stamp');
            return {rows: stamps.length ? [{created_at: stamps[stamps.length - 1].createdAt}] : []};
          }
          if (sql.startsWith('INSERT INTO stampies_loyalty.events')) {
            state.events.push({
              membershipId: params[1], kind: params[3], key: params[4],
              digest: params[5], previous: params[6], next: params[7],
              day: params[8], createdAt: params[11],
            });
            return {rows: []};
          }
          if (sql.startsWith('UPDATE stampies_loyalty.memberships')) {
            state.balance = params[1];
            state.lifetimeStamps += params[2];
            state.rewardsRedeemed += params[3];
            return {rows: []};
          }
          if (sql.startsWith('INSERT INTO stampies_loyalty.locations')) {
            return {rows: [{id: locationId, code: params[1], name: params[2]}]};
          }
          if (sql.startsWith('INSERT INTO stampies_loyalty.programs')) {
            publicCode = params[1];
            return {rows: [{
              id: programId, public_code: params[1], reward_text: params[2],
              target: params[3], daily_limit: params[4],
              cooldown_seconds: params[5], time_zone: params[6],
            }]};
          }
          if (sql.startsWith('SELECT id FROM stampies_loyalty.programs')) {
            return {rows: params[0] === programId ? [{id: programId}] : []};
          }
          if (sql.startsWith('INSERT INTO stampies_loyalty.enrollment_grants')) {
            state.grants.set(params[0], {merchantId: params[1], programId: params[2], expires: params[3]});
            return {rows: []};
          }
          if (sql.startsWith('SELECT p.id,p.merchant_id FROM stampies_loyalty.programs')) {
            return {rows: params[0] === publicCode ? [{id: programId, merchant_id: merchantId}] : []};
          }
          if (sql.startsWith('DELETE FROM stampies_loyalty.enrollment_grants')) {
            const held = state.grants.get(params[0]);
            if (!held || held.merchantId !== params[1] || held.programId !== params[2] ||
                held.expires <= params[3]) return {rows: []};
            state.grants.delete(params[0]);
            return {rows: [{digest: params[0]}]};
          }
          if (sql.startsWith('INSERT INTO stampies_loyalty.memberships')) {
            return {rows: [{id: membershipId, pass_id: params[2], balance: 0}]};
          }
          if (sql.startsWith('SELECT m.id,m.pass_id,m.balance')) {
            return {rows: [{id: membershipId, pass_id: 'stp_123456789abcdef0123456789abcdef0',
              balance: state.balance, lifetime_stamps: state.lifetimeStamps,
              rewards_redeemed: state.rewardsRedeemed, target, status: 'active'}]};
          }
          throw new Error('Unexpected SQL: ' + sql);
        },
      };
    },
  };
  const ledger = createPostgresLoyaltyLedger({
    pool, now: () => state.time,
    verifyAccessToken: async (token) => token === goodAccessToken ?
      {iss: 'https://id.example/', sub: 'user-1'} : null,
    lookupMembership: async ({businessId: requested}) => {
      state.membershipQueries++;
      return {businessId: requested, role: state.role,
        memberStatus: state.memberStatus, merchantStatus: state.merchantStatus};
    },
  });
  return {ledger, state, setPublicCode: (x) => {publicCode = x;}};
}

const rejected = async (fn, code) =>
  assert.rejects(fn, (error) => error?.code === code);

test('real stamps are written under a row lock, with idempotent retry and accurate counts', async () => {
  const {ledger, state} = fixture();
  assert.deepEqual(await ledger.issueStamp(stampArgs(1)),
    {duplicate: false, balance: 1, kind: 'stamp', rewardReady: false});
  assert.deepEqual(await ledger.issueStamp(stampArgs(1)),
    {duplicate: true, balance: 1, kind: 'stamp'});
  assert.equal(state.events.length, 1);
  assert.equal(state.lifetimeStamps, 1);
  assert.equal(state.lockedReads, 2);
  assert.equal(state.commits, 2);
});

test('reused idempotency key with changed location is blocked', async () => {
  const {ledger, state} = fixture();
  await ledger.issueStamp(stampArgs(1));
  await rejected(() => ledger.issueStamp({...stampArgs(1),
    locationId: '55555555-5555-4555-8555-555555555555'}), 'IDEMPOTENCY_CONFLICT');
  assert.equal(state.balance, 1);
  assert.equal(state.events.length, 1);
  assert.equal(state.rollbacks, 1);
});

test('reward becomes ready at the configured target and only then can be redeemed', async () => {
  const {ledger, state} = fixture({target: 2});
  await rejected(() => ledger.redeemReward(stampArgs(20)), 'REWARD_NOT_READY');
  await ledger.issueStamp(stampArgs(1));
  const done = await ledger.issueStamp(stampArgs(2));
  assert.equal(done.rewardReady, true);
  await rejected(() => ledger.issueStamp(stampArgs(3)), 'REWARD_READY');
  const redeemed = await ledger.redeemReward(stampArgs(20));
  assert.equal(redeemed.balance, 0);
  assert.equal(redeemed.kind, 'redeem');
  assert.deepEqual(await ledger.redeemReward(stampArgs(20)),
    {duplicate: true, balance: 0, kind: 'redeem'});
  assert.equal(state.lifetimeStamps, 2);
  assert.equal(state.rewardsRedeemed, 1);
  assert.deepEqual(state.events.map((e) => e.kind), ['stamp', 'stamp', 'redeem']);
});

test('day limits are tenant-timezone aware and not client-supplied', async () => {
  const {ledger, state} = fixture({target: 4, dailyLimit: 1});
  await ledger.issueStamp(stampArgs(1));
  await rejected(() => ledger.issueStamp(stampArgs(2)), 'DAILY_LIMIT');
  // Sydney's next local calendar day, even though the server is UTC.
  state.time = new Date('2026-11-22T14:00:00.000Z');
  assert.equal((await ledger.issueStamp(stampArgs(2))).balance, 2);
  assert.equal(state.events[0].day, '2026-11-22');
  assert.equal(state.events[1].day, '2026-11-23');
});

test('cooldown, merchant suspension, blocked pass and staff revocation fail closed', async () => {
  const {ledger, state} = fixture({target: 10, cooldownSeconds: 60});
  await ledger.issueStamp(stampArgs(1));
  await rejected(() => ledger.issueStamp(stampArgs(2)), 'COOLDOWN');
  state.role = 'viewer';
  await rejected(() => ledger.issueStamp(stampArgs(3)), 'FORBIDDEN');
  state.role = 'staff';
  state.memberStatus = 'revoked';
  await rejected(() => ledger.issueStamp(stampArgs(3)), 'FORBIDDEN');
  state.memberStatus = 'active';
  state.merchantStatus = 'suspended';
  await rejected(() => ledger.issueStamp(stampArgs(3)), 'FORBIDDEN');
  state.merchantStatus = 'active';
  state.programStatus = 'paused';
  await rejected(() => ledger.issueStamp(stampArgs(3)), 'PASS_UNAVAILABLE');
  state.programStatus = 'active';
  state.memberStatus = 'blocked';
  await rejected(() => ledger.issueStamp(stampArgs(3)), 'FORBIDDEN');
  assert.equal(state.balance, 1);
});

test('unverified callers cannot access or modify merchant records', async () => {
  const {ledger, state} = fixture();
  await rejected(() => ledger.issueStamp({...stampArgs(1), accessToken: 'forged'}), 'UNAUTHORIZED');
  await rejected(() => ledger.issueStamp({...stampArgs(1), businessId: 'bad!'}), 'UNAUTHORIZED');
  assert.equal(state.dbCalls, 0);
});

test('one-time customer enrollment issues an opaque pass, no login, no demo customer', async () => {
  const {ledger, state, setPublicCode} = fixture();
  state.role = 'owner';
  const program = await ledger.createProgram({
    accessToken: goodAccessToken, businessId, rewardText: 'A free coffee',
    target: 9, dailyLimit: 1, cooldownSeconds: 60, timeZone: 'Australia/Sydney',
  });
  setPublicCode(program.public_code);
  const grant = await ledger.createEnrollmentGrant({
    accessToken: goodAccessToken, businessId, programId,
  });
  assert.match(grant.token, /^[A-Za-z0-9_-]{43}$/);
  const member = await ledger.enrollCustomer({
    publicCode: program.public_code, enrollmentToken: grant.token,
  });
  assert.match(member.passId, /^stp_[a-f0-9]{32}$/);
  assert.equal(member.balance, 0);
  await rejected(() => ledger.enrollCustomer({
    publicCode: program.public_code, enrollmentToken: grant.token,
  }), 'ENROLLMENT_EXPIRED');
  assert.equal(state.grants.size, 0);
});

test('program configuration and location creation require owner/admin permissions', async () => {
  const {ledger, state} = fixture();
  await rejected(() => ledger.createLocation({
    accessToken: goodAccessToken, businessId, code: 'branch1', name: 'Store One',
  }), 'FORBIDDEN');
  state.role = 'owner';
  const created = await ledger.createLocation({
    accessToken: goodAccessToken, businessId, code: 'branch1', name: 'Store One',
  });
  assert.equal(created.id, locationId);
  await rejected(() => ledger.createProgram({
    accessToken: goodAccessToken, businessId, rewardText: 'Free item',
    target: 0, timeZone: 'Australia/Sydney',
  }), 'INVALID_PROGRAM');
  await rejected(() => ledger.createProgram({
    accessToken: goodAccessToken, businessId, rewardText: 'Free item',
    target: 9, timeZone: 'not-a-time-zone',
  }), 'INVALID_TIMEZONE');
});
