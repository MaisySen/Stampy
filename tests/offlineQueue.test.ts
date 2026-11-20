// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import test from "node:test";
// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import assert from "node:assert/strict";
import {
  MAX_QUEUE_RETRIES,
  OfflineStampQueue,
} from "../src/lib/offlineQueue.js";

function stamp(id: string, passId = "pass-1") {
  return { id, passId, businessId: "biz-1", createdAtMs: 1_000 };
}

test("queue keeps stamps in order, oldest first", () => {
  const queue = new OfflineStampQueue();
  queue.enqueue(stamp("s1"));
  queue.enqueue(stamp("s2"));
  queue.enqueue(stamp("s3"));
  assert.equal(queue.length, 3);
  assert.deepEqual(
    queue.pending().map((item) => item.id),
    ["s1", "s2", "s3"],
  );
  assert.equal(queue.next()?.id, "s1");
});

test("dedupe by stamp id, a retry never double stamps", () => {
  const queue = new OfflineStampQueue();
  assert.equal(queue.enqueue(stamp("s1")), true);
  assert.equal(queue.enqueue(stamp("s1")), false);
  assert.equal(queue.enqueue(stamp("s1", "pass-2")), false);
  assert.equal(queue.length, 1);
});

test("markSent removes the stamp and the next stamp moves up", () => {
  const queue = new OfflineStampQueue();
  queue.enqueue(stamp("s1"));
  queue.enqueue(stamp("s2"));
  assert.equal(queue.markSent("s1"), true);
  assert.equal(queue.markSent("s1"), false);
  assert.equal(queue.length, 1);
  assert.equal(queue.next()?.id, "s2");
});

test("markFailed retries until 3 failures, then drops the stamp", () => {
  const queue = new OfflineStampQueue();
  queue.enqueue(stamp("s1"));
  assert.equal(queue.markFailed("s1"), "retry");
  assert.equal(queue.markFailed("s1"), "retry");
  assert.equal(queue.length, 1);
  assert.equal(queue.markFailed("s1"), "dropped");
  assert.equal(queue.length, 0);
  assert.equal(queue.next(), null);
  assert.deepEqual(
    queue.dropped().map((item) => item.id),
    ["s1"],
  );
  assert.equal(queue.dropped()[0].attempts, MAX_QUEUE_RETRIES);
});

test("markFailed on an unknown id is not-found", () => {
  const queue = new OfflineStampQueue();
  assert.equal(queue.markFailed("missing"), "not-found");
});

test("dropped stamps do not block the rest of the queue", () => {
  const queue = new OfflineStampQueue();
  queue.enqueue(stamp("s1"));
  queue.enqueue(stamp("s2"));
  queue.markFailed("s1");
  queue.markFailed("s1");
  queue.markFailed("s1");
  assert.equal(queue.length, 1);
  assert.equal(queue.next()?.id, "s2");
});

test("pending returns a copy, so callers cannot reorder the queue", () => {
  const queue = new OfflineStampQueue();
  queue.enqueue(stamp("s1"));
  const list = queue.pending();
  list.push({ ...stamp("s2"), attempts: 0 });
  assert.equal(queue.length, 1);
});

test("queue restores from a store and persists changes", () => {
  let saved: Array<{ id: string }> = [];
  const store = {
    load: () => [
      { id: "old-1", passId: "pass-1", businessId: "biz-1", createdAtMs: 500, attempts: 1 },
    ],
    save: (items: Array<{ id: string }>) => {
      saved = items;
    },
  };
  const queue = new OfflineStampQueue(store);
  assert.equal(queue.length, 1);
  assert.equal(queue.next()?.id, "old-1");
  queue.enqueue(stamp("new-1"));
  assert.deepEqual(
    saved.map((item) => item.id),
    ["old-1", "new-1"],
  );
});

test("clear empties the queue and the dropped list", () => {
  const queue = new OfflineStampQueue();
  queue.enqueue(stamp("s1"));
  queue.enqueue(stamp("s2"));
  queue.markFailed("s1");
  queue.markFailed("s1");
  queue.markFailed("s1");
  queue.clear();
  assert.equal(queue.length, 0);
  assert.deepEqual(queue.dropped(), []);
});
