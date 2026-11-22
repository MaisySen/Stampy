// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import test from "node:test";
// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import assert from "node:assert/strict";
import {
  DEFAULT_PAID_VISITS,
  DEFAULT_PROGRAM,
  MAX_PAID_VISITS,
  MIN_PAID_VISITS,
  PROGRAM_STORAGE_KEY,
  cardLength,
  defaultReward,
  loadProgram,
  saveProgram,
  validateProgram,
} from "../src/lib/program.js";
import { MemoryBackend } from "../src/lib/storage.js";

test("default program is 8 paid visits and the 9th visit is the reward", () => {
  assert.equal(DEFAULT_PAID_VISITS, 8);
  assert.equal(DEFAULT_PROGRAM.paidVisits, 8);
  assert.equal(cardLength(8), 9);
  assert.equal(DEFAULT_PROGRAM.reward, "Buy 8, get the 9th free");
  assert.equal(defaultReward(5), "Buy 5, get the 6th free");
});

test("paid visit range is 3 to 11, matching the 4 to 12 card length", () => {
  assert.equal(MIN_PAID_VISITS, 3);
  assert.equal(MAX_PAID_VISITS, 11);
  for (const paid of [3, 8, 11]) {
    assert.equal(validateProgram({ name: "A", reward: "B", paidVisits: paid }).ok, true);
  }
  for (const paid of [2, 12, 0, -1, 8.5, NaN, "8", null, undefined]) {
    assert.equal(validateProgram({ name: "A", reward: "B", paidVisits: paid }).ok, false);
  }
});

test("invalid name and reward are reported together", () => {
  const result = validateProgram({ name: "  ", reward: "", paidVisits: 20 });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errors.length, 3);
  }
  const long = validateProgram({ name: "x".repeat(61), reward: "ok", paidVisits: 8 });
  assert.equal(long.ok, false);
});

test("a non-default program saves and reopens", async () => {
  const backend = new MemoryBackend();
  const saved = await saveProgram(backend, {
    name: "  Synthetic Bakery ",
    reward: "Free croissant",
    paidVisits: 5,
  });
  assert.equal(saved.ok, true);
  const reopened = await loadProgram(backend);
  assert.equal(reopened.status, "ok");
  assert.deepEqual(reopened.settings, {
    name: "Synthetic Bakery",
    reward: "Free croissant",
    paidVisits: 5,
  });
});

test("nothing saved means defaults with status missing", async () => {
  const loaded = await loadProgram(new MemoryBackend());
  assert.equal(loaded.status, "missing");
  assert.deepEqual(loaded.settings, DEFAULT_PROGRAM);
});

test("invalid settings are refused and nothing is written", async () => {
  const backend = new MemoryBackend();
  const result = await saveProgram(backend, { name: "", reward: "x", paidVisits: 2 });
  assert.equal(result.ok, false);
  assert.equal(backend.data.size, 0);
});

test("saved settings that fail validation load as invalid and are not repaired", async () => {
  const backend = new MemoryBackend();
  backend.data.set(
    PROGRAM_STORAGE_KEY,
    JSON.stringify({ v: 1, settings: { name: "X", reward: "Y", paidVisits: 99 } }),
  );
  const loaded = await loadProgram(backend);
  assert.equal(loaded.status, "invalid");
  assert.deepEqual(loaded.settings, DEFAULT_PROGRAM);
  assert.ok(backend.data.get(PROGRAM_STORAGE_KEY)?.includes("99"));
  backend.data.set(PROGRAM_STORAGE_KEY, "{not json");
  assert.equal((await loadProgram(backend)).status, "invalid");
  backend.data.set(PROGRAM_STORAGE_KEY, JSON.stringify({ v: 2, settings: {} }));
  assert.equal((await loadProgram(backend)).status, "invalid");
});

test("storage read failure and write failure are visible, not silent", async () => {
  const backend = new MemoryBackend();
  backend.failReads = true;
  const loaded = await loadProgram(backend);
  assert.equal(loaded.status, "error");
  backend.failReads = false;
  backend.failWrites = true;
  const saved = await saveProgram(backend, { name: "A", reward: "B", paidVisits: 8 });
  assert.equal(saved.ok, false);
  if (!saved.ok) {
    assert.equal(saved.storage, true);
    assert.match(saved.errors[0], /Could not save/);
  }
  assert.equal(backend.data.size, 0);
});
