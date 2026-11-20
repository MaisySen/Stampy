const clockSkew = 30_000;
const allowed = new Set(['apple-vas', 'google-smart-tap']);
const id = /^[A-Za-z0-9_-]{16,100}$/;

// verifyReader must be supplied by an approved terminal integration. It validates signature,
// audience and merchant/terminal binding before returning decoded fields. Raw taps/URLs are not proof.
// redeemOnce must atomically reconcile event ID, active pass/program/merchant, cooldown and quota
// before writing a stamp; it must return the same outcome for a retried event for the same reader.
export function createWalletTapBoundary({ approved = [], verifyReader, redeemOnce, now = Date.now }) {
  if (!Array.isArray(approved) || approved.some((x) => !allowed.has(x))) throw new Error('Invalid Wallet terminal providers.');
  if (approved.length && (typeof verifyReader !== 'function' || typeof redeemOnce !== 'function')) throw new Error('A verified reader and transactional redemption are required.');
  const enabled = new Set(approved);
  return async (provider, signedRequest) => {
    if (!enabled.has(provider)) return {status: 'unavailable'};
    try {
      const input = await verifyReader(provider, signedRequest);
      const stamp = now();
      if (!input || input.provider !== provider || !Number.isSafeInteger(stamp) || !Number.isSafeInteger(input.issuedAt) || Math.abs(stamp - input.issuedAt) > clockSkew || ![input.readerId,input.merchantId,input.passId,input.eventId].every((x) => typeof x === 'string' && id.test(x))) return {status: 'denied'};
      const result = await redeemOnce({provider, readerId: input.readerId, merchantId: input.merchantId, passId: input.passId, eventId: input.eventId, issuedAt: input.issuedAt});
      return {status: ['stamped','already-processed','denied'].includes(result) ? result : 'unavailable'};
    } catch { return {status: 'unavailable'}; }
  };
}
