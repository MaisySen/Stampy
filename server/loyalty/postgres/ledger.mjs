// Production-oriented, merchant-scoped transactional loyalty ledger.
// Server-only. Pair with the verified OIDC and live membership lookup in PR #5.
// No HTTP route, mock auth, client-controlled balances, demo rows or device
// secrets are supplied here. The host must expose ONLY authenticated handlers.
import {createHash, randomBytes, randomUUID} from 'node:crypto';

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const businessPattern = /^[A-Za-z0-9_-]{1,60}$/;
const requestPattern = /^[A-Za-z0-9_-]{16,100}$/;
const publicCodePattern = /^[A-Za-z0-9_-]{20,64}$/;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const writerRoles = new Set(['owner', 'admin', 'manager', 'staff']);
const managerRoles = new Set(['owner', 'admin', 'manager']);
const ownerRoles = new Set(['owner', 'admin']);

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
  pool, verifyAccessToken, lookupMembership, now = () => new Date(),
} = {}) {
  if (typeof pool?.connect !== 'function' ||
      typeof verifyAccessToken !== 'function' ||
      typeof lookupMembership !== 'function' ||
      typeof now !== 'function') {
    throw new Error('Loyalty ledger requires Postgres and trusted OIDC/member adapters.');
  }

  async function authorize(accessToken, businessId, roles) {
    if (typeof accessToken !== 'string' || accessToken.length > 12288 ||
        !validBusiness(businessId)) deny('UNAUTHORIZED');
    let actor, member;
    try {
      actor = await verifyAccessToken(accessToken);
      if (!actor || typeof actor.iss !== 'string' || typeof actor.sub !== 'string') {
        deny('UNAUTHORIZED');
      }
      member = await lookupMembership({
        issuer: actor.iss, subject: actor.sub, businessId,
      });
    } catch {
      deny('UNAUTHORIZED');
    }
    if (member?.businessId !== businessId ||
        member?.merchantStatus !== 'active' ||
        member?.memberStatus !== 'active' || !roles.has(member?.role)) {
      deny('FORBIDDEN');
    }
    return {iss: actor.iss, sub: actor.sub};
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
      throw error;
    } finally {
      client.release();
    }
  }

  async function merchant(client, businessId) {
    const result = await client.query(
      'SELECT id FROM stampies_identity.merchants WHERE business_id=$1 AND status=$2',
      [businessId, 'active'],
    );
    const row = one(result);
    if (!row) deny('MERCHANT_UNAVAILABLE');
    return row.id;
  }

  async function createLocation({accessToken, businessId, code, name}) {
    await authorize(accessToken, businessId, ownerRoles);
    if (!validBusiness(code) || !clean(name, 160)) deny('INVALID_LOCATION');
    return transaction(async (client) => {
      const merchantId = await merchant(client, businessId);
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
    await authorize(accessToken, businessId, ownerRoles);
    if (!clean(rewardText, 200) || !Number.isInteger(target) || target < 1 || target > 100 ||
        !Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 20 ||
        !Number.isInteger(cooldownSeconds) || cooldownSeconds < 0 ||
        cooldownSeconds > 86400) deny('INVALID_PROGRAM');
    validateZone(timeZone);
    const publicCode = randomBytes(24).toString('base64url');
    return transaction(async (client) => {
      const merchantId = await merchant(client, businessId);
      const row = one(await client.query(
        'INSERT INTO stampies_loyalty.programs(merchant_id,public_code,reward_text,target,daily_limit,cooldown_seconds,time_zone) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,public_code,reward_text,target,daily_limit,cooldown_seconds,time_zone',
        [merchantId, publicCode, rewardText.trim(), target, dailyLimit, cooldownSeconds, timeZone],
      ));
      return row;
    });
  }

  async function createEnrollmentGrant({accessToken, businessId, programId}) {
    await authorize(accessToken, businessId, writerRoles);
    if (!validId(programId)) deny('INVALID_PROGRAM');
    const rawToken = randomBytes(32).toString('base64url');
    const expires = new Date(nowDate(now).getTime() + 5 * 60 * 1000);
    return transaction(async (client) => {
      const merchantId = await merchant(client, businessId);
      const active = one(await client.query(
        'SELECT id FROM stampies_loyalty.programs WHERE id=$1 AND merchant_id=$2 AND status=$3',
        [programId, merchantId, 'active'],
      ));
      if (!active) deny('PROGRAM_UNAVAILABLE');
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
      const program = one(await client.query(
        'SELECT p.id,p.merchant_id FROM stampies_loyalty.programs p JOIN stampies_identity.merchants m ON m.id=p.merchant_id WHERE p.public_code=$1 AND p.status=$2 AND m.status=$3',
        [publicCode, 'active', 'active'],
      ));
      if (!program) deny('PROGRAM_UNAVAILABLE');
      const grant = one(await client.query(
        'DELETE FROM stampies_loyalty.enrollment_grants WHERE digest=$1 AND merchant_id=$2 AND program_id=$3 AND expires_at > $4 RETURNING digest',
        [digest(enrollmentToken), program.merchant_id, program.id, nowDate(now).toISOString()],
      ));
      if (!grant) deny('ENROLLMENT_EXPIRED');
      const passId = 'stp_' + randomUUID().replaceAll('-', '');
      const member = one(await client.query(
        'INSERT INTO stampies_loyalty.memberships(merchant_id,program_id,pass_id) VALUES($1,$2,$3) RETURNING id,pass_id,balance',
        [program.merchant_id, program.id, passId],
      ));
      return {membershipId: member.id, passId: member.pass_id, balance: member.balance};
    });
  }

  async function transactReward({
    kind, accessToken, businessId, membershipId, locationId, idempotencyKey,
  }) {
    const actor = await authorize(accessToken, businessId, writerRoles);
    if (!validId(membershipId) || !validId(locationId) ||
        typeof idempotencyKey !== 'string' || !requestPattern.test(idempotencyKey)) {
      deny('INVALID_TRANSACTION');
    }
    const at = nowDate(now);
    const hash = requestDigest({kind, businessId, membershipId, locationId, actor});
    return transaction(async (client) => {
      const merchantId = await merchant(client, businessId);
      // A row lock serialises *all* stamp and redeem requests for one card.
      // A second concurrent request sees the committed first transaction.
      const source = one(await client.query(
        [
          'SELECT m.id,m.balance,m.status AS member_status,',
          'p.target,p.daily_limit,p.cooldown_seconds,p.time_zone,p.status AS program_status',
          'FROM stampies_loyalty.memberships m',
          'JOIN stampies_loyalty.programs p ON p.id=m.program_id AND p.merchant_id=m.merchant_id',
          'WHERE m.id=$1 AND m.merchant_id=$2 FOR UPDATE OF m',
        ].join(' '), [membershipId, merchantId],
      ));
      if (!source || source.member_status !== 'active' ||
          source.program_status !== 'active') deny('PASS_UNAVAILABLE');
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
      const place = one(await client.query(
        'SELECT id FROM stampies_loyalty.locations WHERE id=$1 AND merchant_id=$2 AND status=$3',
        [locationId, merchantId, 'active'],
      ));
      if (!place) deny('LOCATION_UNAVAILABLE');

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
    await authorize(accessToken, businessId, writerRoles);
    if (!validId(membershipId)) deny('INVALID_PASS');
    return transaction(async (client) => {
      const merchantId = await merchant(client, businessId);
      const row = one(await client.query(
        [
          'SELECT m.id,m.pass_id,m.balance,m.lifetime_stamps,m.rewards_redeemed,',
          'm.status,p.target,p.reward_text,p.time_zone',
          'FROM stampies_loyalty.memberships m',
          'JOIN stampies_loyalty.programs p ON p.id=m.program_id',
          'WHERE m.id=$1 AND m.merchant_id=$2',
        ].join(' '), [membershipId, merchantId],
      ));
      if (!row) deny('PASS_UNAVAILABLE');
      return row;
    });
  }

  return Object.freeze({
    createLocation, createProgram, createEnrollmentGrant, enrollCustomer,
    issueStamp, redeemReward, getMerchantPass,
  });
}
