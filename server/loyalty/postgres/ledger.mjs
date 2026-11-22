// Production-oriented, merchant-scoped transactional loyalty ledger.
// Server-only. Uses verified OIDC identity and same-transaction authority locks.
// No HTTP route, mock auth, client-controlled balances, demo rows or device
// secrets are supplied here. The host must expose ONLY authenticated handlers.
import {createHash, randomBytes, randomUUID} from 'node:crypto';

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const businessPattern = /^[A-Za-z0-9_-]{1,60}$/;
const requestPattern = /^[A-Za-z0-9_-]{16,100}$/;
const publicCodePattern = /^[A-Za-z0-9_-]{20,64}$/;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export class LoyaltyError extends Error {
  constructor(code) {
    super(code);
    this.name = 'LoyaltyError';
    this.code = code;
  }
}
const deny = (code) => { throw new LoyaltyError(code); };
const validId = (x) => typeof x === 'string' && idPattern.test(x);
const validBusiness = (x) => typeof x === 'string' && businessPattern.test(x);
const digest = (x) => createHash('sha256').update(x).digest('hex');
const clean = (text, max) => typeof text === 'string' && text.trim().length > 0 &&
  text.trim().length <= max ? text.trim() : null;
const one = (result) => result?.rows?.length === 1 ? result.rows[0] : null;

function nowDate(now) {
  const date = now();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) deny('INVALID_CLOCK');
  return date;
}
function localDay(date, timeZone) {
  // Intl applies the merchant's IANA timezone and handles DST boundaries.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const x = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return x.year + '-' + x.month + '-' + x.day;
}
function validateZone(zone) {
  if (typeof zone !== 'string' || zone.length < 1 || zone.length > 100) deny('INVALID_TIMEZONE');
  try { localDay(new Date(), zone); } catch { deny('INVALID_TIMEZONE'); }
  return zone;
}
function requestDigest({kind, businessId, membershipId, locationId, actor}) {
  return digest(JSON.stringify([
    kind, businessId, membershipId, locationId, actor.iss, actor.sub,
  ]));
}

export function createPostgresLoyaltyLedger({
  pool, verifyAccessToken, now = () => new Date(),
} = {}) {
  if (typeof pool?.connect !== 'function' ||
      typeof verifyAccessToken !== 'function' ||
      typeof now !== 'function') {
    throw new Error('Loyalty ledger requires Postgres and a trusted OIDC verifier.');
  }

  // JWT verification is outside the transaction. Its claims are identity only,
  // never permission: canonical membership is checked/locked on its DB client.
  async function identity(accessToken, businessId) {
    if (typeof accessToken !== 'string' || accessToken.length > 12288 ||
        !validBusiness(businessId)) deny('UNAUTHORIZED');
    let actor;
    try { actor = await verifyAccessToken(accessToken); } catch { deny('UNAUTHORIZED'); }
    if (!actor || typeof actor.iss !== 'string' || actor.iss.length < 8 || actor.iss.length > 512 ||
        typeof actor.sub !== 'string' || !actor.sub.length || actor.sub.length > 255) deny('UNAUTHORIZED');
    return {iss: actor.iss, sub: actor.sub};
  }

  async function authority(client, actor, businessId, operation) {
    const row = one(await client.query(
      'SELECT stampies_identity.lock_staff_authority($1,$2,$3,$4) AS id',
      [businessId, actor.iss, actor.sub, operation],
    ));
    if (!row || !validId(row.id)) deny('FORBIDDEN');
    return row.id;
  }

  async function lockProgram(client, merchantId, programId) {
    const row = one(await client.query(
      'SELECT id,status,target,daily_limit,cooldown_seconds,time_zone,reward_text FROM stampies_loyalty.programs WHERE merchant_id=$1 AND id=$2 FOR SHARE',
      [merchantId, programId],
    ));
    if (!row || row.status !== 'active') deny('PROGRAM_UNAVAILABLE');
    return row;
  }

  async function discoverProgram(client, merchantId, membershipId) {
    // Discovery is not authority. Revalidate this relation under the card lock.
    const row = one(await client.query(
      'SELECT program_id FROM stampies_loyalty.memberships WHERE merchant_id=$1 AND id=$2',
      [merchantId, membershipId],
    ));
    if (!row) deny('PASS_UNAVAILABLE');
    return row.program_id;
  }

  async function transaction(run) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve the original error */ }
      if (error?.code === '42501') deny(error.message === 'PROGRAM_UNAVAILABLE' ? 'PROGRAM_UNAVAILABLE' : 'FORBIDDEN');
      throw error;
    } finally {
      client.release();
    }
  }

  async function createLocation({accessToken, businessId, code, name}) {
    const actor = await identity(accessToken, businessId);
    if (!validBusiness(code) || !clean(name, 160)) deny('INVALID_LOCATION');
    return transaction(async (client) => {
      const merchantId = await authority(client, actor, businessId, 'create_location');
      const row = one(await client.query(
        'INSERT INTO stampies_loyalty.locations(merchant_id,code,name) VALUES($1,$2,$3) RETURNING id,code,name',
        [merchantId, code, name.trim()],
      ));
      return row;
    });
  }

  async function createProgram({
    accessToken, businessId, rewardText, target,
    dailyLimit = 1, cooldownSeconds = 60, timeZone,
  }) {
    const actor = await identity(accessToken, businessId);
    if (!clean(rewardText, 200) || !Number.isInteger(target) || target < 1 || target > 100 ||
        !Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 20 ||
        !Number.isInteger(cooldownSeconds) || cooldownSeconds < 0 ||
        cooldownSeconds > 86400) deny('INVALID_PROGRAM');
    validateZone(timeZone);
    const publicCode = randomBytes(24).toString('base64url');
    return transaction(async (client) => {
      const merchantId = await authority(client, actor, businessId, 'create_program');
      const row = one(await client.query(
        'INSERT INTO stampies_loyalty.programs(merchant_id,public_code,reward_text,target,daily_limit,cooldown_seconds,time_zone) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,public_code,reward_text,target,daily_limit,cooldown_seconds,time_zone',
        [merchantId, publicCode, rewardText.trim(), target, dailyLimit, cooldownSeconds, timeZone],
      ));
      return row;
    });
  }

  async function createEnrollmentGrant({accessToken, businessId, programId}) {
    const actor = await identity(accessToken, businessId);
    if (!validId(programId)) deny('INVALID_PROGRAM');
    const rawToken = randomBytes(32).toString('base64url');
    return transaction(async (client) => {
      const merchantId = await authority(client, actor, businessId, 'grant');
      await lockProgram(client, merchantId, programId);
      const expires = new Date(nowDate(now).getTime() + 5 * 60 * 1000);
      await client.query(
        'INSERT INTO stampies_loyalty.enrollment_grants(digest,merchant_id,program_id,expires_at) VALUES($1,$2,$3,$4)',
        [digest(rawToken), merchantId, programId, expires.toISOString()],
      );
      return {token: rawToken, expiresAt: expires.toISOString()};
    });
  }

  async function enrollCustomer({publicCode, enrollmentToken}) {
    // Customer requires no login, but MUST possess a one-time, short-lived
    // enrollment grant minted by authorised merchant staff. No PII recorded.
    if (typeof publicCode !== 'string' || !publicCodePattern.test(publicCode) ||
        typeof enrollmentToken !== 'string' || !tokenPattern.test(enrollmentToken)) {
      deny('INVALID_ENROLLMENT');
    }
    return transaction(async (client) => {
      const discovered = one(await client.query(
        'SELECT id,merchant_id FROM stampies_loyalty.programs WHERE public_code=$1', [publicCode],
      ));
      if (!discovered) deny('PROGRAM_UNAVAILABLE');
      const locked = one(await client.query(
        'SELECT stampies_identity.lock_enrollment_merchant($1) AS id', [discovered.merchant_id],
      ));
      if (!locked || locked.id !== discovered.merchant_id) deny('PROGRAM_UNAVAILABLE');
      const program = await lockProgram(client, locked.id, discovered.id);
      // public_code may have changed while waiting: do not bind an obsolete URL.
      const sameCode = one(await client.query(
        'SELECT id FROM stampies_loyalty.programs WHERE id=$1 AND merchant_id=$2 AND public_code=$3',
        [program.id, locked.id, publicCode],
      ));
      if (!sameCode) deny('PROGRAM_UNAVAILABLE');
      // DELETE obtains the grant lock first. Expiry is evaluated AFTER any wait;
      // expired grants are restored by transaction rollback, not consumed.
      const grant = one(await client.query(
        'DELETE FROM stampies_loyalty.enrollment_grants WHERE digest=$1 AND merchant_id=$2 AND program_id=$3 RETURNING expires_at',
        [digest(enrollmentToken), locked.id, program.id],
      ));
      const at = nowDate(now);
      if (!grant || !(new Date(grant.expires_at).getTime() > at.getTime())) deny('ENROLLMENT_EXPIRED');
      const passId = 'stp_' + randomUUID().replaceAll('-', '');
      const member = one(await client.query(
        'INSERT INTO stampies_loyalty.memberships(merchant_id,program_id,pass_id) VALUES($1,$2,$3) RETURNING id,pass_id,balance',
        [locked.id, program.id, passId],
      ));
      return {membershipId: member.id, passId: member.pass_id, balance: member.balance};
    });
  }

  async function transactReward({
    kind, accessToken, businessId, membershipId, locationId, idempotencyKey,
  }) {
    const actor = await identity(accessToken, businessId);
    if (!validId(membershipId) || !validId(locationId) ||
        typeof idempotencyKey !== 'string' || !requestPattern.test(idempotencyKey)) {
      deny('INVALID_TRANSACTION');
    }
    const hash = requestDigest({kind, businessId, membershipId, locationId, actor});
    return transaction(async (client) => {
      const merchantId = await authority(client, actor, businessId, kind);
      const programId = await discoverProgram(client, merchantId, membershipId);
      const program = await lockProgram(client, merchantId, programId);
      const place = one(await client.query(
        'SELECT id,status FROM stampies_loyalty.locations WHERE merchant_id=$1 AND id=$2 FOR SHARE',
        [merchantId, locationId],
      ));
      if (!place || place.status !== 'active') deny('LOCATION_UNAVAILABLE');
      const card = one(await client.query(
        'SELECT id,program_id,balance,status FROM stampies_loyalty.memberships WHERE merchant_id=$1 AND id=$2 FOR UPDATE',
        [merchantId, membershipId],
      ));
      if (!card || card.status !== 'active' || card.program_id !== programId) deny('PASS_UNAVAILABLE');
      const source = {...program, balance: card.balance};
      // Clock is sampled only after ALL blocking lifecycle/balance locks.
      const at = nowDate(now);
      const previous = Number(source.balance);
      if (!Number.isSafeInteger(previous) || previous < 0 ||
          previous > Number(source.target)) deny('INVALID_BALANCE');
      const existing = one(await client.query(
        'SELECT event_type,request_digest,next_balance FROM stampies_loyalty.events WHERE membership_id=$1 AND request_key=$2',
        [membershipId, idempotencyKey],
      ));
      if (existing) {
        if (existing.event_type !== kind || existing.request_digest !== hash) {
          deny('IDEMPOTENCY_CONFLICT');
        }
        return {duplicate: true, balance: Number(existing.next_balance), kind};
      }
      const day = localDay(at, source.time_zone);
      let next;
      if (kind === 'stamp') {
        if (previous >= Number(source.target)) deny('REWARD_READY');
        const count = one(await client.query(
          'SELECT COUNT(*)::int AS total FROM stampies_loyalty.events WHERE membership_id=$1 AND event_type=$2 AND local_day=$3',
          [membershipId, 'stamp', day],
        ));
        if (Number(count?.total) >= Number(source.daily_limit)) deny('DAILY_LIMIT');
        const recent = one(await client.query(
          'SELECT created_at FROM stampies_loyalty.events WHERE membership_id=$1 AND event_type=$2 ORDER BY created_at DESC LIMIT 1',
          [membershipId, 'stamp'],
        ));
        if (recent) {
          const lastAt = new Date(recent.created_at).getTime();
          if (!Number.isFinite(lastAt)) deny('INVALID_CLOCK');
          if (at.getTime() - lastAt < Number(source.cooldown_seconds) * 1000) {
            deny('COOLDOWN');
          }
        }
        next = previous + 1;
      } else if (kind === 'redeem') {
        if (previous < Number(source.target)) deny('REWARD_NOT_READY');
        next = 0;
      } else {
        deny('INVALID_TRANSACTION');
      }
      await client.query(
        [
          'INSERT INTO stampies_loyalty.events',
          '(merchant_id,membership_id,location_id,event_type,request_key,request_digest,',
          'previous_balance,next_balance,local_day,actor_issuer,actor_subject,created_at)',
          'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        ].join(' '),
        [merchantId, membershipId, locationId, kind, idempotencyKey, hash,
          previous, next, day, actor.iss, actor.sub, at.toISOString()],
      );
      await client.query(
        [
          'UPDATE stampies_loyalty.memberships',
          'SET balance=$2, lifetime_stamps=lifetime_stamps+$3,',
          'rewards_redeemed=rewards_redeemed+$4,updated_at=$5',
          'WHERE id=$1',
        ].join(' '), [membershipId, next, kind === 'stamp' ? 1 : 0,
          kind === 'redeem' ? 1 : 0, at.toISOString()],
      );
      return {duplicate: false, balance: next, kind, rewardReady: kind === 'stamp' &&
        next === Number(source.target)};
    });
  }

  const issueStamp = (args) => transactReward({...args, kind: 'stamp'});
  const redeemReward = (args) => transactReward({...args, kind: 'redeem'});

  async function getMerchantPass({accessToken, businessId, membershipId}) {
    const actor = await identity(accessToken, businessId);
    if (!validId(membershipId)) deny('INVALID_PASS');
    return transaction(async (client) => {
      const merchantId = await authority(client, actor, businessId, 'read_pass');
      const programId = await discoverProgram(client, merchantId, membershipId);
      const program = await lockProgram(client, merchantId, programId);
      const card = one(await client.query(
        'SELECT id,program_id,pass_id,balance,lifetime_stamps,rewards_redeemed,status FROM stampies_loyalty.memberships WHERE merchant_id=$1 AND id=$2 FOR SHARE',
        [merchantId, membershipId],
      ));
      const row = card?.status === 'active' && card.program_id === programId ? {
        id: card.id, pass_id: card.pass_id, balance: card.balance,
        lifetime_stamps: card.lifetime_stamps, rewards_redeemed: card.rewards_redeemed,
        status: card.status, target: program.target, reward_text: program.reward_text, time_zone: program.time_zone,
      } : null;
      if (!row) deny('PASS_UNAVAILABLE');
      return row;
    });
  }

  return Object.freeze({
    createLocation, createProgram, createEnrollmentGrant, enrollCustomer,
    issueStamp, redeemReward, getMerchantPass,
  });
}
