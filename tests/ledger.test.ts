// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import test from "node:test";
// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import assert from "node:assert/strict";
import {
  LEDGER_STORAGE_KEY,
  LedgerPersister,
  applyStamp,
  cardStatus,
  destinationForCard,
  emptyLedger,
  loadLedger,
  markHandedToQueue,
  newEpoch,
  redeem,
} from "../src/lib/ledger.js";
import type { LedgerState } from "../src/lib/ledger.js";
import { DEFAULT_PROGRAM } from "../src/lib/program.js";
import type { ProgramSettings } from "../src/lib/program.js";
import { MemoryBackend } from "../src/lib/storage.js";

const five: ProgramSettings = { name: "Synthetic Bakery", reward: "Free croissant", paidVisits: 5 };

function stampTimes(state: LedgerState, program: ProgramSettings, n: number): LedgerState {
  let s = state;
  for (let i = 0; i < n; i++) {
    const r = applyStamp(s, program, 1000 + i);
    assert.equal(r.outcome, "stamped");
    s = r.state;
  }
  return s;
}

test("default card is eligible after 8 paid visits, the 9th visit is the reward", () => {
  let s = stampTimes(emptyLedger(), DEFAULT_PROGRAM, 7);
  assert.equal(cardStatus(s, DEFAULT_PROGRAM).eligible, false);
  assert.equal(cardStatus(s, DEFAULT_PROGRAM).remaining, 1);
  s = stampTimes(s, DEFAULT_PROGRAM, 1);
  const status = cardStatus(s, DEFAULT_PROGRAM);
  assert.equal(status.eligible, true);
  assert.equal(status.shown, 8);
});

test("a non-default threshold is reached at its own count", () => {
  const s = stampTimes(emptyLedger(), five, 4);
  assert.equal(cardStatus(s, five).eligible, false);
  assert.equal(cardStatus(stampTimes(s, five, 1), five).eligible, true);
});

test("a full card refuses more stamps", () => {
  const full = stampTimes(emptyLedger(), five, 5);
  const again = applyStamp(full, five, 9000);
  assert.equal(again.outcome, "card-full");
  assert.equal(again.state.progress, 5);
});

test("redeem works only when eligible and records an id", () => {
  const early = stampTimes(emptyLedger(), five, 4);
  assert.equal(redeem(early, five, 5000).outcome, "not-eligible");
  const full = stampTimes(emptyLedger(), five, 5);
  const done = redeem(full, five, 5000);
  assert.equal(done.outcome, "redeemed");
  assert.equal(done.state.progress, 0);
  assert.equal(done.state.redemptions.length, 1);
  assert.equal(done.state.redemptions[0].id, "redeem-e0-1");
  assert.equal(redeem(done.state, five, 6000).outcome, "not-eligible");
});

test("stamp ids come from a counter and a replayed id is refused", () => {
  const a = applyStamp(emptyLedger(), five, 1);
  assert.equal(a.outcome, "stamped");
  if (a.outcome !== "stamped") return;
  assert.equal(a.stampId, "stamp-e0-1");
  const replay = applyStamp(a.state, five, 2, "stamp-e0-1");
  assert.equal(replay.outcome, "duplicate");
  assert.equal(replay.state.progress, 1);
  const b = applyStamp(a.state, five, 1);
  if (b.outcome !== "stamped") return;
  assert.equal(b.stampId, "stamp-e0-2");
});

test("lowering the threshold keeps visits and carries extras over a redemption", () => {
  const s = stampTimes(emptyLedger(), DEFAULT_PROGRAM, 6);
  const lowered: ProgramSettings = { ...DEFAULT_PROGRAM, paidVisits: 4 };
  const status = cardStatus(s, lowered);
  assert.equal(status.eligible, true);
  assert.equal(status.progress, 6);
  assert.equal(status.shown, 4);
  const done = redeem(s, lowered, 7000);
  assert.equal(done.outcome, "redeemed");
  assert.equal(done.state.progress, 2);
  assert.equal(done.state.redemptions.length, 1);
});

test("raising the threshold keeps progress and makes the card not yet eligible", () => {
  const s = stampTimes(emptyLedger(), five, 5);
  const raised: ProgramSettings = { ...five, paidVisits: 8 };
  assert.equal(cardStatus(s, raised).eligible, false);
  assert.equal(cardStatus(s, raised).remaining, 3);
  assert.equal(redeem(s, raised, 1).outcome, "not-eligible");
});

test("stamps, eligibility and redemption survive a restart", async () => {
  const backend = new MemoryBackend();
  const persister = new LedgerPersister(backend);
  let s = stampTimes(emptyLedger(), five, 5);
  assert.equal(await persister.save(s), true);
  const afterStamps = await loadLedger(backend);
  assert.equal(afterStamps.status, "ok");
  assert.equal(cardStatus(afterStamps.state, five).eligible, true);
  const done = redeem(afterStamps.state, five, 8000);
  if (done.outcome !== "redeemed") throw new Error("expected redeem");
  assert.equal(await persister.save(done.state), true);
  const restarted = await loadLedger(backend);
  assert.equal(restarted.status, "ok");
  assert.equal(restarted.state.progress, 0);
  assert.equal(restarted.state.redemptions.length, 1);
  assert.equal(restarted.state.nextSeq, 6);
  const next = applyStamp(restarted.state, five, 9000);
  if (next.outcome !== "stamped") throw new Error("expected stamp");
  assert.equal(next.stampId, "stamp-e0-6");
  s = next.state;
});

test("writes run in order, the last state is the one saved", async () => {
  const backend = new MemoryBackend();
  const persister = new LedgerPersister(backend);
  let s = emptyLedger();
  const writes: Promise<boolean>[] = [];
  for (let i = 0; i < 4; i++) {
    const r = applyStamp(s, five, i);
    if (r.outcome !== "stamped") throw new Error("expected stamp");
    s = r.state;
    writes.push(persister.save(s));
  }
  assert.deepEqual(await Promise.all(writes), [true, true, true, true]);
  assert.equal((await loadLedger(backend)).state.progress, 4);
});

test("a storage write failure is visible and retry saves the latest state", async () => {
  const backend = new MemoryBackend();
  const persister = new LedgerPersister(backend);
  backend.failWrites = true;
  const r = applyStamp(emptyLedger(), five, 1);
  if (r.outcome !== "stamped") throw new Error("expected stamp");
  assert.equal(await persister.save(r.state), false);
  assert.match(persister.lastError ?? "", /write failed/i);
  assert.equal(backend.data.size, 0);
  backend.failWrites = false;
  assert.equal(await persister.retry(), true);
  assert.equal(persister.lastError, null);
  assert.equal((await loadLedger(backend)).state.progress, 1);
});

test("an unreadable saved ledger is reported and never overwritten", async () => {
  const backend = new MemoryBackend();
  backend.data.set(LEDGER_STORAGE_KEY, "{broken");
  const loaded = await loadLedger(backend);
  assert.equal(loaded.status, "invalid");
  const persister = new LedgerPersister(backend);
  persister.blockWrites(true);
  const r = applyStamp(loaded.state, five, 1);
  if (r.outcome !== "stamped") throw new Error("expected stamp");
  assert.equal(await persister.save(r.state), false);
  assert.equal(backend.data.get(LEDGER_STORAGE_KEY), "{broken");
  backend.failReads = true;
  assert.equal((await loadLedger(backend)).status, "error");
  backend.failReads = false;
  backend.data.set(LEDGER_STORAGE_KEY, JSON.stringify({ v: 1, progress: -3 }));
  assert.equal((await loadLedger(backend)).status, "invalid");
});

test("handed-to-queue stamps leave the outbox", () => {
  const a = applyStamp(emptyLedger(), five, 1);
  if (a.outcome !== "stamped") throw new Error("expected stamp");
  assert.equal(a.state.outbox.length, 1);
  assert.equal(markHandedToQueue(a.state, ["stamp-e0-1"]).outbox.length, 0);
  assert.equal(markHandedToQueue(a.state, ["other"]).outbox.length, 1);
});

test("a new card gets its own epoch, so ids never repeat after a reset", () => {
  const a = emptyLedger(newEpoch());
  const b = emptyLedger(newEpoch());
  assert.notEqual(a.epoch, b.epoch);
  const first = applyStamp(a, five, 1);
  const second = applyStamp(b, five, 1);
  if (first.outcome !== "stamped" || second.outcome !== "stamped") throw new Error("expected stamps");
  assert.notEqual(first.stampId, second.stampId);
});

test("redemption ids stay unique and the full history is kept past 200", () => {
  let s = emptyLedger();
  const ids: string[] = [];
  for (let i = 0; i < 205; i++) {
    s = { ...s, progress: five.paidVisits };
    const r = redeem(s, five, i);
    if (r.outcome !== "redeemed") throw new Error("expected redeem");
    ids.push(r.redemptionId);
    s = r.state;
  }
  assert.equal(new Set(ids).size, 205);
  assert.equal(s.redemptions.length, 205);
  assert.equal(s.nextRedeemSeq, 206);
});

test("epoch and redemption sequence survive save and load, and an older save loads", async () => {
  const backend = new MemoryBackend();
  const persister = new LedgerPersister(backend);
  let s = emptyLedger("ep1");
  s = { ...s, progress: 5 };
  const r = redeem(s, five, 1);
  if (r.outcome !== "redeemed") throw new Error("expected redeem");
  await persister.save(r.state);
  const loaded = await loadLedger(backend);
  assert.equal(loaded.state.epoch, "ep1");
  assert.equal(loaded.state.nextRedeemSeq, 2);
  const old = { v: 1, progress: 1, nextSeq: 2, outbox: [], lastStampAtMs: null, appliedIds: [], redemptions: [] };
  backend.data.set(LEDGER_STORAGE_KEY, JSON.stringify(old));
  const legacy = await loadLedger(backend);
  assert.equal(legacy.status, "ok");
  assert.equal(legacy.state.epoch, "legacy");
});

test("a stamp keeps the destination of its card, whatever the program is later called", async () => {
  const a: ProgramSettings = { ...DEFAULT_PROGRAM, name: "Old Cafe" };
  const b: ProgramSettings = { ...DEFAULT_PROGRAM, name: "\u8336\u5C4B" };
  const first = applyStamp(emptyLedger(), a, 1000);
  assert.equal(first.outcome, "stamped");
  if (first.outcome !== "stamped") return;
  const second = applyStamp(first.state, b, 2000 + 86_400_000);
  assert.equal(second.outcome, "stamped");
  if (second.outcome !== "stamped") return;
  const want = destinationForCard(second.state.epoch);
  assert.deepEqual(second.state.outbox.map((s) => s.destination), [want, want]);
  assert.ok(want.passId.length > 0 && want.businessId.length > 0);
  assert.notDeepEqual(destinationForCard("e1"), destinationForCard("e2"));
});

test("destination survives save and load; a legacy entry stays without one; a bad one is unreadable", async () => {
  const backend = new MemoryBackend();
  const s = applyStamp(emptyLedger(), DEFAULT_PROGRAM, 1000);
  assert.equal(s.outcome, "stamped");
  if (s.outcome !== "stamped") return;
  const withLegacy = { ...s.state, outbox: [...s.state.outbox, { id: "old", createdAtMs: 5 }] };
  backend.data.set(LEDGER_STORAGE_KEY, JSON.stringify(withLegacy));
  const loaded = await loadLedger(backend);
  assert.equal(loaded.status, "ok");
  if (loaded.status !== "ok") return;
  assert.deepEqual(loaded.state.outbox[0].destination, destinationForCard(s.state.epoch));
  assert.equal(loaded.state.outbox[1].destination, undefined);
  backend.data.set(
    LEDGER_STORAGE_KEY,
    JSON.stringify({ ...s.state, outbox: [{ id: "x", createdAtMs: 1, destination: { passId: "", businessId: "b" } }] }),
  );
  assert.equal((await loadLedger(backend)).status, "invalid");
});
