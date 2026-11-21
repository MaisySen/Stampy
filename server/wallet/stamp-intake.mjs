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
// The pass state machine from src/lib/pass.ts decides whether a stamp
// is allowed. The committed pass record carries the target, the expiry
// date, and the redeemed flag. A stamp on an expired pass is refused with
// 410. A stamp on a redeemed pass, or on a card that is already full, is
// refused with 409. A recorded stamp returns the state after the stamp,
// so the caller can see the card flip to reward earned on the stamp that
// completes it. Dedupe comes before the refusal: a retry of a stamp that
// is already recorded is a no-op success even when the card has since
// become full. Recording a stamp calls onRecorded, which the service
// wires to committedAppleChange, so the pass refresh is queued through
// the existing update path and carries the new state.
//
// This handler does not issue passes, does not sign, and does not send
// pushes. The merchant ledger stays the authority for the pass count;
// the stamp ledger is the exactly-once intake record. The committed ledger
// record for a pass must carry businessId, the same slug the app sends,
// or the business cannot be verified and the stamp is refused.

import { derivePassState } from '../../src/lib/pass.ts';

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

export function createStampIntakeHandler({stampStore, loadCommittedPass, now = Date.now, onRecorded}) {
  if (!stampStore || typeof stampStore.record !== 'function' || typeof stampStore.count !== 'function' ||
      typeof stampStore.find !== 'function' ||
      typeof loadCommittedPass !== 'function' || typeof now !== 'function') {
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
    const row = await loadCommittedPass(body.passId);
    if (!row || row.record?.passId !== body.passId) return jsonResponse(404);
    if (row.record?.businessId !== body.businessId) return jsonResponse(404);
    // The state machine decides whether this pass can take a stamp.
    // The committed record is the authority: its stamp count, target,
    // expiry date, and redeemed flag. A stamp on an expired pass is
    // gone for good, so it is 410. A stamp on a redeemed or full card
    // is a conflict, so it is 409. Nothing is recorded in either case.
    const record = row.record;
    const recordStamps = typeof record.stamps === 'number' ? record.stamps : 0;
    const todayIso = new Date(now()).toISOString().slice(0, 10);
    // A record without a target cannot be full: the intake must not
    // refuse a stamp it cannot prove is past the target. Expiry and
    // redeemed still apply, since those do not need the target.
    const hasTarget = typeof record.target === 'number' && record.target >= 1;
    const stateInput = {
      stamps: recordStamps,
      target: hasTarget ? record.target : Number.MAX_SAFE_INTEGER,
      redeemed: record.redeemed === true,
      expiryIso: record.expiryIso,
      todayIso,
    };
    const stateBefore = derivePassState(stateInput);
    // Dedupe comes before the state refusal. A retry of a stamp that
    // is already recorded is a no-op success, even when the card has
    // since become full: the retry must never be refused as a second
    // stamp, and it must never record again. A stamp id reused for
    // another pass or business is a conflict.
    const prior = await stampStore.find(body.stampId);
    if (prior) {
      if (prior.passId !== body.passId || prior.businessId !== body.businessId) return jsonResponse(409);
      return jsonResponse(200, {
        recorded: false,
        duplicate: true,
        stamps: await stampStore.count(body.passId),
        state: stateBefore,
      });
    }
    // The state machine decides whether this pass can take a stamp.
    // The committed record is the authority: its stamp count, target,
    // expiry date, and redeemed flag. A stamp on an expired pass is
    // gone for good, so it is 410. A stamp on a redeemed or full card
    // is a conflict, so it is 409. Nothing is recorded in either case.
    if (stateBefore === 'expired' || stateBefore === 'redeemed' || stateBefore === 'reward-earned') {
      const status = stateBefore === 'expired' ? 410 : 409;
      return jsonResponse(status, {
        recorded: false,
        duplicate: false,
        stamps: await stampStore.count(body.passId),
        state: stateBefore,
      });
    }
    const outcome = await stampStore.record({
      stampId: body.stampId,
      passId: body.passId,
      businessId: body.businessId,
      createdAtMs: body.createdAtMs,
    });
    if (outcome.status === 'conflict') return jsonResponse(409);
    if (outcome.status === 'duplicate') {
      // A concurrent retry raced past the find above. Same no-op
      // success as the find path: the stamp is already recorded.
      return jsonResponse(200, {
        recorded: false,
        duplicate: true,
        stamps: outcome.stamps,
        state: stateBefore,
      });
    }
    if (typeof onRecorded === 'function') {
      // The stamp is already recorded. A failed refresh must not fail the
      // stamp; the merchant ledger applying the stamp and calling
      // committedAppleChange again is the recovery.
      try { await onRecorded(body.passId); } catch { /* best effort pass refresh */ }
    }
    // The state after this stamp: the recorded stamp lands on the
    // merchant ledger, so a stamp that completes the card flips the
    // state to reward earned in this response.
    const stateAfter = derivePassState({
      ...stateInput,
      stamps: recordStamps + 1,
    });
    return jsonResponse(200, {
      recorded: true,
      duplicate: false,
      stamps: outcome.stamps,
      state: stateAfter,
    });
  };
}
