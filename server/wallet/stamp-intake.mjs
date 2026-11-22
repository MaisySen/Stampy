// Stamp intake for the Wallet backend. One stamp per request, recorded
// exactly once against the committed merchant ledger, deduped by stamp id.
//
// The app drains its offline queue with one stamp per POST to /wallet/stamps.
// The backend never trusts a stamp count or reward state from the device:
// it verifies the pass and business against the committed merchant ledger,
// records the stamp in its own stamp ledger, and returns the count derived
// from that ledger. A retry after a lost response is a no-op success, never
// a second stamp.
//
// This handler does not issue passes, does not sign, and does not send
// pushes. Recording a stamp calls onRecorded, which the service wires to
// committedAppleChange, so the pass refresh is queued through the existing
// update path. The merchant ledger stays the authority for the pass count;
// the stamp ledger is the exactly-once intake record. The committed ledger
// record for a pass must carry businessId, the same slug the app sends,
// or the business cannot be verified and the stamp is refused.

// The app sends stamp ids like r-1790000000000, pass ids like
// stampies-corner-cafe, and business ids as slugs like corner-cafe.
// These are shorter than the opaque ids used for grants, so the patterns
// here accept the app shapes as well as opaque ids.
const stampIdPattern = /^[A-Za-z0-9_-]{8,80}$/;
const passIdPattern = /^[A-Za-z0-9_-]{8,80}$/;
const businessIdPattern = /^[A-Za-z0-9_-]{1,60}$/;
const MAX_STAMP_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

const jsonResponse = (status, value) => new Response(value === undefined ? null : JSON.stringify(value), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
  },
});

function validationError(body, nowMs) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return 'Invalid stamp.';
  if (typeof body.stampId !== 'string' || !stampIdPattern.test(body.stampId)) return 'Invalid stamp.';
  if (typeof body.passId !== 'string' || !passIdPattern.test(body.passId)) return 'Invalid stamp.';
  if (typeof body.businessId !== 'string' || !businessIdPattern.test(body.businessId)) return 'Invalid stamp.';
  if (!Number.isSafeInteger(body.createdAtMs) || body.createdAtMs <= 0) return 'Invalid stamp.';
  if (body.createdAtMs > nowMs + FUTURE_SKEW_MS) return 'Invalid stamp.';
  if (body.createdAtMs < nowMs - MAX_STAMP_AGE_MS) return 'Invalid stamp.';
  return null;
}

export function createStampIntakeHandler({stampStore, loadCommittedPass, authorizeStamp, now = Date.now, onRecorded}) {
  if (!stampStore || typeof stampStore.record !== 'function' || typeof stampStore.count !== 'function' ||
      typeof loadCommittedPass !== 'function' || typeof authorizeStamp !== 'function' || typeof now !== 'function') {
    throw new Error('Invalid stamp intake configuration.');
  }
  return async function handleStampIntake(request) {
    let body;
    try {
      const type = request.headers.get('content-type') ?? '';
      if (!type.startsWith('application/json')) return jsonResponse(400);
      body = await request.json();
    } catch {
      return jsonResponse(400);
    }
    if (validationError(body, now())) return jsonResponse(400);
    // A pass ID is not proof of permission to award stamps. The host
    // must authenticate the staff/merchant and authorise this business.
    // Reject failures before looking up the pass or touching the ledger.
    let authorised = false;
    try {
      authorised = await authorizeStamp({request, stamp: body});
    } catch {
      return jsonResponse(403);
    }
    if (authorised !== true) return jsonResponse(403);
    const row = await loadCommittedPass(body.passId);
    if (!row || row.record?.passId !== body.passId) return jsonResponse(404);
    if (row.record?.businessId !== body.businessId) return jsonResponse(404);
    const outcome = await stampStore.record({
      stampId: body.stampId,
      passId: body.passId,
      businessId: body.businessId,
      createdAtMs: body.createdAtMs,
    });
    if (outcome.status === 'conflict') return jsonResponse(409);
    if (outcome.status === 'recorded' && typeof onRecorded === 'function') {
      // The stamp is already recorded. A failed refresh must not fail the
      // stamp; the merchant ledger applying the stamp and calling
      // committedAppleChange again is the recovery.
      try { await onRecorded(body.passId); } catch { /* best effort pass refresh */ }
    }
    return jsonResponse(200, {
      recorded: outcome.status === 'recorded',
      duplicate: outcome.status === 'duplicate',
      stamps: outcome.stamps,
    });
  };
}
