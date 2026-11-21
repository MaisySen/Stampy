// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import test from "node:test";
// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import assert from "node:assert/strict";
import { OfflineStampQueue } from "../src/lib/offlineQueue.js";
import {
  OFFLINE_QUEUE_STORAGE_KEY,
  createPersistentOfflineQueueStore,
} from "../src/lib/offlineQueueStore.js";

function stamp(id: string, passId = "pass-1") {
  return { id, passId, businessId: "biz-1", createdAtMs: 1_000 };
}

/** In-memory stand-in for AsyncStorage. One instance is one installed app. */
class MemoryBackend {
  data = new Map<string, string>();
  failWrites = false;
  failReads = false;

  async getItem(key: string): Promise<string | null> {
    if (this.failReads) {
      throw new Error("read failed");
    }
    return this.data.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    if (this.failWrites) {
      throw new Error("write failed");
    }
    this.data.set(key, value);
  }
}

test("a queued stamp survives a store reload", async () => {
  const backend = new MemoryBackend();
  const first = createPersistentOfflineQueueStore(backend);
  const queue = new OfflineStampQueue(first);
  queue.enqueue(stamp("s1"));
  queue.enqueue(stamp("s2"));
  await first.flush();
  assert.equal(first.lastError, null);
  assert.equal(backend.data.get(OFFLINE_QUEUE_STORAGE_KEY)?.includes("s1"), true);

  // A new store instance over the same backend is an app restart.
  const second = createPersistentOfflineQueueStore(backend);
  assert.equal(second.hydrated, false);
  await second.hydrate();
  assert.equal(second.hydrated, true);
  const restored = new OfflineStampQueue(second);
  assert.equal(restored.length, 2);
  assert.deepEqual(
    restored.pending().map((item) => item.id),
    ["s1", "s2"],
  );
});

test("a failed write does not drop the queue", async () => {
  const backend = new MemoryBackend();
  backend.failWrites = true;
  const store = createPersistentOfflineQueueStore(backend);
  const queue = new OfflineStampQueue(store);
  queue.enqueue(stamp("s1"));
  await store.flush();
  assert.notEqual(store.lastError, null);
  assert.equal(queue.length, 1);
  assert.deepEqual(
    store.load().map((item) => item.id),
    ["s1"],
  );
  // The queue keeps its dedupe behaviour while the write is failing.
  assert.equal(queue.enqueue(stamp("s1")), false);

  backend.failWrites = false;
  await store.flush();
  assert.equal(store.lastError, null);
  const reloaded = createPersistentOfflineQueueStore(backend);
  await reloaded.hydrate();
  assert.deepEqual(
    new OfflineStampQueue(reloaded).pending().map((item) => item.id),
    ["s1"],
  );
});

test("sent stamps stay sent across a reload", async () => {
  const backend = new MemoryBackend();
  const first = createPersistentOfflineQueueStore(backend);
  const queue = new OfflineStampQueue(first);
  queue.enqueue(stamp("s1"));
  queue.enqueue(stamp("s2"));
  queue.markSent("s1");
  await first.flush();
  const second = createPersistentOfflineQueueStore(backend);
  await second.hydrate();
  assert.deepEqual(
    new OfflineStampQueue(second).pending().map((item) => item.id),
    ["s2"],
  );
});

test("dedupe and retry behaviour is unchanged with the persistent store", async () => {
  const backend = new MemoryBackend();
  const store = createPersistentOfflineQueueStore(backend);
  const queue = new OfflineStampQueue(store);
  assert.equal(queue.enqueue(stamp("s1")), true);
  assert.equal(queue.enqueue(stamp("s1")), false);
  assert.equal(queue.markFailed("s1"), "retry");
  assert.equal(queue.markFailed("s1"), "retry");
  assert.equal(queue.markFailed("s1"), "dropped");
  assert.equal(queue.length, 0);
  await store.flush();
  assert.equal(store.lastError, null);
  const second = createPersistentOfflineQueueStore(backend);
  await second.hydrate();
  assert.equal(new OfflineStampQueue(second).length, 0);
});

test("corrupt saved data starts empty instead of throwing", async () => {
  const backend = new MemoryBackend();
  backend.data.set(OFFLINE_QUEUE_STORAGE_KEY, "not json{");
  const store = createPersistentOfflineQueueStore(backend);
  await store.hydrate();
  assert.notEqual(store.lastError, null);
  assert.equal(store.hydrated, true);
  assert.deepEqual(store.load(), []);
  const queue = new OfflineStampQueue(store);
  assert.equal(queue.enqueue(stamp("s1")), true);
  await store.flush();
  assert.equal(store.lastError, null);
});

test("a failed read leaves the queue empty and records the error", async () => {
  const backend = new MemoryBackend();
  backend.failReads = true;
  const store = createPersistentOfflineQueueStore(backend);
  await store.hydrate();
  assert.notEqual(store.lastError, null);
  assert.deepEqual(store.load(), []);
});
