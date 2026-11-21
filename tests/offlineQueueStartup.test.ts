// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import test from "node:test";
// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import assert from "node:assert/strict";
import { OfflineStampQueue } from "../src/lib/offlineQueue.js";
import {
  OFFLINE_QUEUE_STORAGE_KEY,
  createPersistentOfflineQueueStore,
} from "../src/lib/offlineQueueStore.js";
import { startOfflineStampQueue } from "../src/lib/offlineQueueStartup.js";

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

test("startup restores a queued stamp from storage", async () => {
  const backend = new MemoryBackend();
  const firstStore = createPersistentOfflineQueueStore(backend);
  const first = new OfflineStampQueue(firstStore);
  first.enqueue(stamp("s1"));
  await firstStore.flush();
  assert.equal(firstStore.lastError, null);

  // A new startup over the same backend is an app restart.
  const restored = await startOfflineStampQueue(() =>
    Promise.resolve(createPersistentOfflineQueueStore(backend)),
  );
  assert.equal(restored.length, 1);
  assert.deepEqual(
    restored.pending().map((item) => item.id),
    ["s1"],
  );

  // A second restart still sees the same stamp.
  const again = await startOfflineStampQueue(() =>
    Promise.resolve(createPersistentOfflineQueueStore(backend)),
  );
  assert.deepEqual(
    again.pending().map((item) => item.id),
    ["s1"],
  );
});

test("startup falls back to memory when storage reads fail", async () => {
  const backend = new MemoryBackend();
  backend.failReads = true;
  const queue = await startOfflineStampQueue(() =>
    Promise.resolve(createPersistentOfflineQueueStore(backend)),
  );
  // The app still starts and stamps: the queue works in memory.
  assert.equal(queue.length, 0);
  assert.equal(queue.enqueue(stamp("s1")), true);
  assert.equal(queue.length, 1);
  assert.deepEqual(
    queue.pending().map((item) => item.id),
    ["s1"],
  );
});

test("startup falls back to memory when the store cannot be created", async () => {
  const queue = await startOfflineStampQueue(() =>
    Promise.reject(new Error("no storage")),
  );
  assert.equal(queue.length, 0);
  assert.equal(queue.enqueue(stamp("s1")), true);
  assert.equal(queue.length, 1);
});

test("startup falls back to memory when the saved data is corrupt", async () => {
  const backend = new MemoryBackend();
  backend.data.set(OFFLINE_QUEUE_STORAGE_KEY, "not json{");
  const queue = await startOfflineStampQueue(() =>
    Promise.resolve(createPersistentOfflineQueueStore(backend)),
  );
  assert.equal(queue.length, 0);
  assert.equal(queue.enqueue(stamp("s1")), true);
  assert.equal(queue.length, 1);
});

test("startup keeps working in memory when storage writes fail", async () => {
  const backend = new MemoryBackend();
  backend.failWrites = true;
  const queue = await startOfflineStampQueue(() =>
    Promise.resolve(createPersistentOfflineQueueStore(backend)),
  );
  assert.equal(queue.enqueue(stamp("s1")), true);
  assert.equal(queue.length, 1);
  assert.equal(queue.enqueue(stamp("s1")), false);
});
