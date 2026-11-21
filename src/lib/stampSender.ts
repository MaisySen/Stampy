/**
 * Real stamp sender for the offline sync drain.
 * Pure logic. No React Native imports, no Node-only modules.
 *
 * Posts each queued stamp to POST /wallet/stamps on the Wallet
 * backend, one stamp per request. The drain passes the sender in,
 * so the sender only needs to do one thing: send one stamp and
 * resolve when the backend accepted it, or reject on any failure
 * so the drain marks the stamp failed and retries it later.
 *
 * The request carries exactly the four fields the endpoint
 * expects: stamp id, pass id, business id, and creation time in
 * milliseconds. It never sends a stamp count, a reward state, or
 * a device identifier beyond what the stamp already carries. The
 * backend derives the count from its own ledger and dedupes by
 * stamp id, so a retry after a lost response never double stamps.
 *
 * It uses the global fetch available in React Native, read lazily
 * off globalThis so this module also compiles in the Node test
 * runner, which has no fetch global declared. Tests inject a fake
 * fetch instead. The endpoint must be https; an http origin or a
 * malformed origin fails at sender creation, never per stamp.
 */
import type { QueuedStamp } from "./offlineQueue";
import type { StampSender } from "./offlineSync";
import { createUnconfiguredStampSender } from "./offlineSync";

/** Minimal shape of fetch used here. Only status and a JSON body. */
export type StampFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

function globalFetch(): StampFetch {
  const found = (globalThis as { fetch?: unknown }).fetch;
  if (typeof found !== "function") {
    throw new Error("Fetch is not available.");
  }
  return found as StampFetch;
}

function isValidStampResponse(body: unknown): boolean {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }
  const value = body as Record<string, unknown>;
  return (
    typeof value.recorded === "boolean" &&
    typeof value.duplicate === "boolean" &&
    Number.isSafeInteger(value.stamps) &&
    (value.stamps as number) >= 0
  );
}

/**
 * Build a sender that posts stamps to POST /wallet/stamps at the
 * given origin. Throws when the origin is not a usable https URL.
 * The returned sender resolves only on a 200 response with a
 * well-formed body ({recorded, duplicate, stamps}). Any other
 * status, a network failure, or a malformed response rejects, so
 * the drain marks the stamp failed and retries it later.
 */
export function createHttpStampSender({
  origin,
  fetchImpl,
}: {
  origin: string;
  fetchImpl?: StampFetch;
}): StampSender {
  let endpoint: string;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") {
      throw new Error("Wallet origin must use https.");
    }
    endpoint = `${url.origin}/wallet/stamps`;
  } catch (error) {
    if (error instanceof Error && error.message === "Wallet origin must use https.") {
      throw error;
    }
    throw new Error("Invalid Wallet origin.");
  }
  const sendWith = fetchImpl ?? globalFetch();
  return async (stamp: QueuedStamp): Promise<void> => {
    const response = await sendWith(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stampId: stamp.id,
        passId: stamp.passId,
        businessId: stamp.businessId,
        createdAtMs: stamp.createdAtMs,
      }),
    });
    if (response.status !== 200) {
      throw new Error(`Stamp sync failed with status ${response.status}.`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error("Stamp sync response was malformed.");
    }
    if (!isValidStampResponse(body)) {
      throw new Error("Stamp sync response was malformed.");
    }
  };
}

/**
 * Pick the sender for an app config origin. A missing, empty, or
 * unusable origin falls back to the unconfigured stub sender, so
 * the drain leaves stamps queued and burns no retry, and the app
 * stamps normally with sync unconfigured. The drain does not
 * change for the swap.
 */
export function createStampSenderForOrigin(
  origin: string | null,
  log: (message: string) => void = () => {},
  fetchImpl?: StampFetch,
): StampSender {
  if (origin === null || origin.trim() === "") {
    return createUnconfiguredStampSender();
  }
  try {
    return createHttpStampSender({ origin, fetchImpl });
  } catch {
    log("Wallet origin is not usable, server sync stays unconfigured.");
    return createUnconfiguredStampSender();
  }
}
