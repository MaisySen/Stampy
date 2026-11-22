/**
 * Stamp ledger for the local/demo journey: paid-visit progress, reward
 * eligibility, local redemptions and the outbox of stamps not yet handed to
 * the offline queue. Pure logic plus a small serialized persister.
 *
 * Rules:
 * - Each stamp is one paid visit. After paidVisits stamps the card is
 *   eligible, and the next visit is the free reward visit.
 * - Redeem works only when eligible. It takes paidVisits off the progress,
 *   so any extra visits (after a lowered threshold) carry over.
 * - Stamp ids come from a saved counter, never the clock, so a restart
 *   cannot reuse an id and a replay of the same id is refused.
 * - A redemption here is recorded on this device. It is not a server
 *   confirmed transaction.
 */
import { readJson, writeJson } from "./storage";
import type { KeyValueBackend } from "./storage";
import type { ProgramSettings } from "./program";

export const LEDGER_STORAGE_KEY = "stampies:demo-ledger:v1";
const MAX_APPLIED_IDS = 500;
const MAX_REDEMPTIONS = 200;

export interface OutboxStamp {
  id: string;
  createdAtMs: number;
}

export interface Redemption {
  id: string;
  atMs: number;
  paidVisits: number;
}

export interface LedgerState {
  v: 1;
  /** Paid visits counted on the current card. */
  progress: number;
  /** Next stamp number, saved so ids survive a restart. */
  nextSeq: number;
  /** Stamps recorded here that the offline queue has not taken yet. */
  outbox: OutboxStamp[];
  /** Time of the latest stamp, saved so the cooldown survives a restart. */
  lastStampAtMs: number | null;
  /** Recent stamp ids, so a replay of the same id is refused. */
  appliedIds: string[];
  redemptions: Redemption[];
}

export function emptyLedger(): LedgerState {
  return { v: 1, progress: 0, nextSeq: 1, outbox: [], lastStampAtMs: null, appliedIds: [], redemptions: [] };
}

export interface CardStatus {
  paidVisits: number;
  progress: number;
  /** Paid visits shown on the card, never above paidVisits. */
  shown: number;
  eligible: boolean;
  remaining: number;
}

export function cardStatus(state: LedgerState, program: ProgramSettings): CardStatus {
  const paid = program.paidVisits;
  return {
    paidVisits: paid,
    progress: state.progress,
    shown: Math.min(state.progress, paid),
    eligible: state.progress >= paid,
    remaining: Math.max(0, paid - state.progress),
  };
}

export type StampOutcome =
  | { outcome: "stamped"; state: LedgerState; stampId: string }
  | { outcome: "card-full"; state: LedgerState }
  | { outcome: "duplicate"; state: LedgerState };

/** Add one paid visit. Refuses when the card is already eligible. */
export function applyStamp(
  state: LedgerState,
  program: ProgramSettings,
  nowMs: number,
  stampId?: string,
): StampOutcome {
  const id = stampId ?? `stamp-${state.nextSeq}`;
  if (state.appliedIds.includes(id)) {
    return { outcome: "duplicate", state };
  }
  if (cardStatus(state, program).eligible) {
    return { outcome: "card-full", state };
  }
  const next: LedgerState = {
    ...state,
    progress: state.progress + 1,
    nextSeq: state.nextSeq + 1,
    outbox: [...state.outbox, { id, createdAtMs: nowMs }],
    lastStampAtMs: nowMs,
    appliedIds: [...state.appliedIds, id].slice(-MAX_APPLIED_IDS),
  };
  return { outcome: "stamped", state: next, stampId: id };
}

export type RedeemOutcome =
  | { outcome: "redeemed"; state: LedgerState; redemptionId: string }
  | { outcome: "not-eligible"; state: LedgerState };

/** Redeem the free reward visit, only when eligible. */
export function redeem(
  state: LedgerState,
  program: ProgramSettings,
  nowMs: number,
): RedeemOutcome {
  if (!cardStatus(state, program).eligible) {
    return { outcome: "not-eligible", state };
  }
  const id = `redeem-${state.redemptions.length + 1}`;
  const next: LedgerState = {
    ...state,
    progress: state.progress - program.paidVisits,
    redemptions: [
      ...state.redemptions,
      { id, atMs: nowMs, paidVisits: program.paidVisits },
    ].slice(-MAX_REDEMPTIONS),
  };
  return { outcome: "redeemed", state: next, redemptionId: id };
}

/** Drop outbox entries the offline queue has taken. */
export function markHandedToQueue(state: LedgerState, ids: string[]): LedgerState {
  if (ids.length === 0) {
    return state;
  }
  const handed = new Set(ids);
  return { ...state, outbox: state.outbox.filter((s) => !handed.has(s.id)) };
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseLedger(value: unknown): LedgerState | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = value as Partial<Record<keyof LedgerState, unknown>>;
  if (
    raw.v !== 1 ||
    !isCount(raw.progress) ||
    !isCount(raw.nextSeq) ||
    raw.nextSeq < 1 ||
    !Array.isArray(raw.outbox) ||
    !Array.isArray(raw.appliedIds) ||
    !Array.isArray(raw.redemptions)
  ) {
    return null;
  }
  const outbox: OutboxStamp[] = [];
  for (const item of raw.outbox) {
    const s = item as Partial<OutboxStamp> | null;
    if (
      typeof s !== "object" || s === null ||
      typeof s.id !== "string" || s.id.length === 0 ||
      typeof s.createdAtMs !== "number" || !Number.isFinite(s.createdAtMs)
    ) {
      return null;
    }
    outbox.push({ id: s.id, createdAtMs: s.createdAtMs });
  }
  if (!raw.appliedIds.every((id) => typeof id === "string")) {
    return null;
  }
  const redemptions: Redemption[] = [];
  for (const item of raw.redemptions) {
    const r = item as Partial<Redemption> | null;
    if (
      typeof r !== "object" || r === null ||
      typeof r.id !== "string" || r.id.length === 0 ||
      typeof r.atMs !== "number" || !Number.isFinite(r.atMs) ||
      !isCount(r.paidVisits)
    ) {
      return null;
    }
    redemptions.push({ id: r.id, atMs: r.atMs, paidVisits: r.paidVisits });
  }
  return {
    v: 1,
    progress: raw.progress,
    nextSeq: raw.nextSeq,
    outbox,
    lastStampAtMs:
      typeof raw.lastStampAtMs === "number" && Number.isFinite(raw.lastStampAtMs)
        ? raw.lastStampAtMs
        : null,
    appliedIds: raw.appliedIds as string[],
    redemptions,
  };
}

export type LedgerLoad =
  | { status: "ok"; state: LedgerState }
  | { status: "missing"; state: LedgerState }
  | { status: "invalid"; state: LedgerState; message: string }
  | { status: "error"; state: LedgerState; message: string };

/**
 * Load the saved ledger. "invalid" and "error" return an empty ledger for
 * display, but the caller must not save over saved data until the user
 * retries a good read or explicitly resets.
 */
export async function loadLedger(backend: KeyValueBackend): Promise<LedgerLoad> {
  const read = await readJson(backend, LEDGER_STORAGE_KEY);
  if (read.status === "missing") {
    return { status: "missing", state: emptyLedger() };
  }
  if (read.status === "error") {
    return { status: "error", state: emptyLedger(), message: read.message };
  }
  if (read.status === "corrupt") {
    return { status: "invalid", state: emptyLedger(), message: read.message };
  }
  const parsed = parseLedger(read.value);
  if (parsed === null) {
    return {
      status: "invalid",
      state: emptyLedger(),
      message: "Saved stamp progress has an unknown format.",
    };
  }
  return { status: "ok", state: parsed };
}

/**
 * Serialized ledger writes. Each save writes the whole state, writes run
 * in call order, so the last state saved is the one left on disk. A failed
 * write is remembered and shown; retry writes the latest state again.
 */
export class LedgerPersister {
  private chain: Promise<void> = Promise.resolve();
  private latest: LedgerState | null = null;
  private error: string | null = null;
  private writesBlocked = false;

  constructor(
    private readonly backend: KeyValueBackend,
    private readonly key: string = LEDGER_STORAGE_KEY,
  ) {}

  /** Last write error, or null when the latest write landed. */
  get lastError(): string | null {
    return this.error;
  }

  /** Stop all writes, used while a saved ledger could not be read. */
  blockWrites(blocked: boolean): void {
    this.writesBlocked = blocked;
  }

  /** Save a state. Resolves true when this write landed. Never throws. */
  save(state: LedgerState): Promise<boolean> {
    this.latest = state;
    const run = this.chain.then(async () => {
      if (this.writesBlocked) {
        this.error = "Stamp progress is not saved because the saved copy could not be read.";
        return false;
      }
      const written = await writeJson(this.backend, this.key, state);
      this.error = written.ok ? null : written.message;
      return written.ok;
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Write the latest state again. Resolves false when there is nothing to retry or it failed. */
  retry(): Promise<boolean> {
    if (this.latest === null) {
      return Promise.resolve(false);
    }
    return this.save(this.latest);
  }
}
