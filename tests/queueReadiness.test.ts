// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import test from "node:test";
// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import assert from "node:assert/strict";
import { OfflineStampQueue } from "../src/lib/offlineQueue.js";
import {
  OFFLINE_QUEUE_STORAGE_KEY,
  createPersistentOfflineQueueStore,
} from "../src/lib/offlineQueueStore.js";
import {
  StampQueueController,
  handOutboxByDestination,
  handOutboxToQueue,
} from "../src/lib/offlineQueueStartup.js";
import type { QueueState } from "../src/lib/offlineQueueStartup.js";
import { MemoryBackend } from "../src/lib/storage.js";

function controllerOver(backend: MemoryBackend) {
  return new StampQueueController(() =>
    Promise.resolve(createPersistentOfflineQueueStore(backend)),
  );
}

/** Read the state fresh, so each check sees the current phase. */
function now(controller: StampQueueController): QueueState {
  return controller.state;
}

function queueOf(controller: StampQueueController): OfflineStampQueue {
  const state = now(controller);
  if (state.phase === "starting") {
    throw new Error("queue is not ready");
  }
  return state.queue;
}

function ids(queue: OfflineStampQueue): string[] {
  return queue.pending().map((s) => s.id);
}

const stamp = (id: string, createdAtMs: number) => ({
  id,
  passId: "p",
  businessId: "b",
  createdAtMs,
});

test("before startup finishes the state is starting, then durable", async () => {
  const controller = controllerOver(new MemoryBackend());
  assert.equal(now(controller).phase, "starting");
  const seen: string[] = [];
  controller.subscribe((s) => seen.push(s.phase));
  await controller.start();
  assert.equal(now(controller).phase, "durable");
  assert.deepEqual(seen, ["durable"]);
});

test("a stamp taken while the queue starts is handed over once it is ready", async () => {
  const controller = controllerOver(new MemoryBackend());
  // The stamp exists only in the ledger outbox while the queue is starting.
  const outbox = [{ id: "stamp-1", createdAtMs: 100 }];
  assert.equal(now(controller).phase, "starting");
  await controller.start();
  const queue = queueOf(controller);
  assert.deepEqual(handOutboxToQueue(queue, outbox, "pass-1", "biz-1"), {
    handed: ["stamp-1"],
    conflicts: [],
  });
  assert.equal(queue.length, 1);
  // Handing over again after a retry or restart never duplicates.
  handOutboxToQueue(queue, outbox, "pass-1", "biz-1");
  assert.equal(queue.length, 1);
});

test("queued stamps survive a restart and a second handover adds no duplicate", async () => {
  const backend = new MemoryBackend();
  const first = createPersistentOfflineQueueStore(backend);
  await first.hydrate();
  const q1 = new OfflineStampQueue(first);
  handOutboxToQueue(q1, [{ id: "stamp-1", createdAtMs: 1 }, { id: "stamp-2", createdAtMs: 2 }], "p", "b");
  await first.flush();
  assert.equal(first.lastError, null);

  const controller = controllerOver(backend);
  await controller.start();
  assert.equal(now(controller).phase, "durable");
  const queue = queueOf(controller);
  assert.equal(queue.length, 2);
  handOutboxToQueue(queue, [{ id: "stamp-2", createdAtMs: 2 }, { id: "stamp-3", createdAtMs: 3 }], "p", "b");
  assert.deepEqual(ids(queue), ["stamp-1", "stamp-2", "stamp-3"]);
});

test("an unreadable store starts memory-only with a reason and leaves saved data alone", async () => {
  const backend = new MemoryBackend();
  backend.data.set(OFFLINE_QUEUE_STORAGE_KEY, "{broken");
  const controller = controllerOver(backend);
  await controller.start();
  const state = now(controller);
  assert.equal(state.phase, "memory-only");
  if (state.phase !== "memory-only") return;
  assert.ok(state.reason.length > 0);
  state.queue.enqueue({ ...stamp("s1", 1) });
  assert.equal(backend.data.get(OFFLINE_QUEUE_STORAGE_KEY), "{broken");
  // Retrying against the same unreadable data stays memory-only and keeps the stamp.
  await controller.retry();
  assert.equal(now(controller).phase, "memory-only");
  assert.deepEqual(ids(queueOf(controller)), ["s1"]);
  assert.equal(backend.data.get(OFFLINE_QUEUE_STORAGE_KEY), "{broken");
});

test("a read failure is memory-only, then retry moves stamps into the durable queue", async () => {
  const backend = new MemoryBackend();
  backend.failReads = true;
  const controller = controllerOver(backend);
  await controller.start();
  assert.equal(now(controller).phase, "memory-only");
  queueOf(controller).enqueue(stamp("s1", 1));

  await controller.retry();
  assert.equal(now(controller).phase, "memory-only");
  assert.deepEqual(ids(queueOf(controller)), ["s1"]);

  backend.failReads = false;
  await controller.retry();
  assert.equal(now(controller).phase, "durable");
  const queue = queueOf(controller);
  assert.deepEqual(ids(queue), ["s1"]);
  handOutboxToQueue(queue, [{ id: "s1", createdAtMs: 1 }], "p", "b");
  assert.deepEqual(ids(queue), ["s1"]);
  // The durable queue wrote it to storage, so a fresh start sees it.
  await new Promise((r) => setTimeout(r, 5));
  const fresh = createPersistentOfflineQueueStore(backend);
  await fresh.hydrate();
  assert.deepEqual(fresh.load().map((s) => s.id), ["s1"]);
});

test("a retry that finds a saved queue keeps saved and in-memory stamps once each", async () => {
  const backend = new MemoryBackend();
  const seed = createPersistentOfflineQueueStore(backend);
  await seed.hydrate();
  new OfflineStampQueue(seed).enqueue(stamp("old", 1));
  await seed.flush();

  backend.failReads = true;
  const controller = controllerOver(backend);
  await controller.start();
  assert.equal(now(controller).phase, "memory-only");
  queueOf(controller).enqueue(stamp("new", 2));
  queueOf(controller).enqueue(stamp("old", 1));
  backend.failReads = false;
  await controller.retry();
  assert.equal(now(controller).phase, "durable");
  assert.deepEqual(ids(queueOf(controller)).sort(), ["new", "old"]);
});

test("flush is true only when the durable queue write landed", async () => {
  const backend = new MemoryBackend();
  const controller = controllerOver(backend);
  assert.equal(await controller.flush(), false);
  await controller.start();
  queueOf(controller).enqueue(stamp("s1", 1));
  assert.equal(await controller.flush(), true);
  backend.failWrites = true;
  queueOf(controller).enqueue(stamp("s2", 2));
  assert.equal(await controller.flush(), false);
  backend.failWrites = false;
  assert.equal(await controller.flush(), true);
});

test("a memory-only queue never reports flushed", async () => {
  const backend = new MemoryBackend();
  backend.failReads = true;
  const controller = controllerOver(backend);
  await controller.start();
  queueOf(controller).enqueue(stamp("s1", 1));
  assert.equal(await controller.flush(), false);
});

test("overlapping retries share one open and never replace a queue that took stamps", async () => {
  const backend = new MemoryBackend();
  let failFirst = true;
  let opens = 0;
  const releases: Array<() => void> = [];
  const controller = new StampQueueController(async () => {
    if (failFirst) throw new Error("synthetic unavailable");
    return createPersistentOfflineQueueStore({
      getItem: async (key: string) => {
        const captured = await backend.getItem(key);
        opens++;
        await new Promise<void>((resolve) => releases.push(resolve));
        return captured;
      },
      setItem: (key: string, value: string) => backend.setItem(key, value),
    });
  });
  await controller.start();
  assert.equal(now(controller).phase, "memory-only");
  failFirst = false;
  const r1 = controller.retry();
  const r2 = controller.retry();
  assert.equal(r1, r2);
  while (opens < 1) await new Promise((resolve) => setImmediate(resolve));
  releases[0]();
  await r1;
  await r2;
  assert.equal(opens, 1);
  assert.equal(now(controller).phase, "durable");
  handOutboxToQueue(queueOf(controller), [{ id: "A", createdAtMs: 1 }], "p", "b");
  assert.equal(await controller.flush(), true);
  // A late retry after durable is a no-op.
  await controller.retry();
  handOutboxToQueue(queueOf(controller), [{ id: "B", createdAtMs: 2 }], "p", "b");
  assert.equal(await controller.flush(), true);
  const saved = JSON.parse(backend.data.get(OFFLINE_QUEUE_STORAGE_KEY) ?? "[]") as Array<{ id: string }>;
  assert.deepEqual(saved.map((x) => x.id), ["A", "B"]);
});

test("a queued stamp with the same id but different content is a conflict, not a handoff", async () => {
  const controller = controllerOver(new MemoryBackend());
  await controller.start();
  const queue = queueOf(controller);
  queue.enqueue({ id: "stamp-e0-1", passId: "old-pass", businessId: "old-biz", createdAtMs: 1 });
  const result = handOutboxToQueue(queue, [{ id: "stamp-e0-1", createdAtMs: 2 }], "new-pass", "new-biz");
  assert.deepEqual(result, { handed: [], conflicts: ["stamp-e0-1"] });
  assert.equal(queue.length, 1);
  assert.equal(queue.pending()[0].passId, "old-pass");
  // The same stamp again is a safe handoff.
  const same = handOutboxToQueue(queue, [{ id: "stamp-e0-1", createdAtMs: 1 }], "old-pass", "old-biz");
  assert.deepEqual(same, { handed: ["stamp-e0-1"], conflicts: [] });
});

test("a saved queue with a record this version cannot read is kept unchanged and never written", async () => {
  const backend = new MemoryBackend();
  const saved = JSON.stringify([
    { id: "old", passId: "p", businessId: "b", createdAtMs: 1, attempts: 0 },
    { id: "future", v: 2 },
  ]);
  backend.data.set(OFFLINE_QUEUE_STORAGE_KEY, saved);
  const controller = controllerOver(backend);
  await controller.start();
  const state = now(controller);
  assert.equal(state.phase, "memory-only");
  if (state.phase !== "memory-only") throw new Error("expected memory-only");
  assert.match(state.reason, /cannot read/);
  state.queue.enqueue(stamp("new", 2));
  await controller.flush();
  await controller.retry();
  assert.equal(now(controller).phase, "memory-only");
  assert.equal(backend.data.get(OFFLINE_QUEUE_STORAGE_KEY), saved);
});

test("handOutboxByDestination uses each stamp's saved destination and never guesses for a legacy one", () => {
  const queue = new OfflineStampQueue(null);
  const out = handOutboxByDestination(queue, [
    { id: "a", createdAtMs: 1, destination: { passId: "p-old", businessId: "b-old" } },
    { id: "b", createdAtMs: 2, destination: { passId: "p-new", businessId: "b-new" } },
    { id: "legacy", createdAtMs: 3 },
  ]);
  assert.deepEqual(out, { handed: ["a", "b"], conflicts: [], unrouted: ["legacy"] });
  const held = queue.pending();
  assert.deepEqual(held.map((x) => [x.id, x.passId, x.businessId]), [["a", "p-old", "b-old"], ["b", "p-new", "b-new"]]);
});
