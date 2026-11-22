// Compose the authenticated merchant/staff permission check for stamp intake.
// This is server-only. Never trust the Wallet pass ID, staff PIN, QR text, or
// user-supplied role as proof of permission to issue a stamp.
const bearerPattern = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const businessIdPattern = /^[A-Za-z0-9_-]{1,60}$/;
const issuingRoles = new Set(['owner', 'admin', 'manager', 'staff']);

export function createMerchantStampAuthorizer({verifyAccessToken, lookupMembership} = {}) {
  if (typeof verifyAccessToken !== 'function' || typeof lookupMembership !== 'function') {
    throw new Error('Merchant stamp authorizer requires a trusted token verifier and membership lookup.');
  }

  return async function authorizeStamp({request, stamp} = {}) {
    if (typeof request?.headers?.get !== 'function' ||
        typeof stamp?.businessId !== 'string' ||
        !businessIdPattern.test(stamp.businessId)) return false;

    const authorization = request.headers.get('authorization');
    if (typeof authorization !== 'string' || authorization.length > 12300) return false;
    const match = bearerPattern.exec(authorization);
    if (!match) return false;

    try {
      // The verifier must validate the OIDC signature, issuer, audience and
      // expiration; never substitute a JWT decoder or a client-side check.
      const identity = await verifyAccessToken(match[1]);
      if (!identity || typeof identity.iss !== 'string' ||
          typeof identity.sub !== 'string' || identity.sub.length < 1 ||
          identity.sub.length > 255) return false;

      // Live database lookup on EVERY stamp means suspended merchants and
      // revoked staff lose issuance rights without waiting for JWT expiry.
      const member = await lookupMembership({
        issuer: identity.iss,
        subject: identity.sub,
        businessId: stamp.businessId,
      });
      return member?.businessId === stamp.businessId &&
        member?.merchantStatus === 'active' &&
        member?.memberStatus === 'active' &&
        issuingRoles.has(member.role);
    } catch {
      // Network, identity provider, database and parsing failures fail closed.
      return false;
    }
  };
}
