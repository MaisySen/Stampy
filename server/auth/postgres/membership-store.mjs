// Postgres-only active merchant/staff membership lookup.
// Use a dedicated read-only pool with privileges on stampies_identity.
// No user, business or role value is interpolated into SQL.
const sql = [
  'SELECT m.business_id AS "businessId", m.status AS "merchantStatus",',
  'ms.status AS "memberStatus", ms.role AS "role"',
  'FROM stampies_identity.merchant_memberships AS ms',
  'JOIN stampies_identity.merchants AS m ON m.id = ms.merchant_id',
  'WHERE ms.issuer = $1 AND ms.subject = $2 AND m.business_id = $3',
  'LIMIT 1',
].join(' ');

export function createPostgresMerchantMembershipStore({pool} = {}) {
  if (typeof pool?.query !== 'function') {
    throw new Error('A dedicated read-only Postgres identity pool is required.');
  }
  async function lookupMembership({issuer, subject, businessId} = {}) {
    if (typeof issuer !== 'string' || issuer.length < 8 || issuer.length > 512 ||
        typeof subject !== 'string' || subject.length < 1 || subject.length > 255 ||
        typeof businessId !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(businessId)) {
      return null;
    }
    const result = await pool.query(sql, [issuer, subject, businessId]);
    if (!result || result.rows?.length !== 1) return null;
    const row = result.rows[0];
    if (!row || row.businessId !== businessId) return null;
    return Object.freeze({
      businessId: row.businessId,
      merchantStatus: row.merchantStatus,
      memberStatus: row.memberStatus,
      role: row.role,
    });
  }
  return Object.freeze({lookupMembership});
}
