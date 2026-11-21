// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import test from "node:test";
// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import assert from "node:assert/strict";
import { OfflineStampQueue } from "../src/lib/offlineQueue.js";
import {
  OfflineSyncDrain,
  SyncNotConfiguredError,
  createOfflineSyncDrain,
  createUnconfiguredStampSender,
} from "../src/lib/offlineSync.js";

function stamp(id: string, passId = "pass-1") {
  return { id, passId, businessId: "biz-1", createdAtMs: 1_000 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

test("drain sends stamps in FIFO order, oldest first", async () => {
  const queue = new OfflineStampQueue();
  queue.enqueue(stamp("s1"));
  queue.enqueue(stamp("s2"));
  queue.enqueue(stamp("s3"));
  const sent: string[] = [];
  const drain = createOfflineSyncDrain(queue, async (item) => {
    sent.push(item.id);
  });
  const result = await drain.drain();
  assert.deepEqual(sent, ["s1", "s2", "s3"]);
  assert.equal(result.sent, 3);
  assert.equal(result.failed, 0);
  assert.equal(result.dropped, 0);
  assert.equal(result.notConfigured, false);
  assert.equal(queue.length, 0);
});

test("markSent on success removes each stamp as it is sent", async () => {
  const queue = new OfflineStampQueue();
  queue.enqueue(stamp("s1"));
  queue.enqueue(stamp("s2"));
  const drain = createOfflineSyncDrain(queue, async () => {});
  assert.deepEqual(await drain.drain(), {
    sent: 2,
    failed: 0,
    dropped: 0,
    notConfigured: false,
  });
  assert.equal(queue.length, 0);
  assert.equal(queue.next(), null);
});

test("dedupe: the same stamp id is never sent twice", async () => {
  const queue = new OfflineStampQueue();
  assert.equal(queue.enqueue(stamp("s1")), true);
  assert.equal(queue.enqueue(stamp("s1")), false);
  const sent: string[] = [];
  const drain = createOfflineSyncDrain(queue, async (item) => {
    sent.push(item.id);
  });
  await drain.drain();
  await drain.drain();
  assert.deepEqual(sent, ["s1"]);
  assert.equal(queue.length, 0);
});

test("one drain at a time: concurrent drains share the same flight", async () => {
  const queue = new OfflineStampQueue();
  queue.enqueue(stamp("s1"));
  queue.enqueue(stamp("s2"));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent: string[] = [];
  const drain = createOfflineSyncDrain(queue, async (item) => {
    sent.push(item.id);
    await gate;
  });
  const first = drain.drain();
  const second = drain.drain();
  assert.equal(first, second);
  release();
  const result = await first;
  assert.equal(result.sent, 2);
  assert.deepEqual(sent, ["s1", "s2"]);
  assert.equal(queue.length, 0);
});

test("markFailed and retry: a failed send stays queued and succeeds later", async () => {
  const queue = new OfflineStampQueue();
  queue.enqueue(stamp("s1"));
  let calls = 0;
  const drain = createOfflineSyncDrain(queue, async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error("offline");
    }
  });
  const first = await drain.drain();
  assert.equal(first.sent, 0);
  assert.equal(first.failed, 1);
  assert.equal(first.dropped, 0);
  assert.equal(queue.length, 1);
  assert.equal(queue.next()?.attempts, 1);
  const second = await drain.drain();
  assert.equal(second.sent, 1);
  assert.equal(second.failed, 0);
  assert.equal(calls, 2);
  assert.equal(queue.length, 0);
});

test("drop after 3 failures: the stamp lands in the dropped list", async () => {
  const queue = new OfflineStampQueue();
  queue.enqueue(stamp("s1"));
  const drain = createOfflineSyncDrain(queue, async () => {
    throw new Error("offline");
  });
  assert.deepEqual(await drain.drain(), {
    sent: 0,
    failed: 1,
    dropped: 0,
    notConfigured: false,
  });
  assert.equal(queue.next()?.attempts, 1);
  assert.deepEqual(await drain.drain(), {
    sent: 0,
    failed: 1,
    dropped: 0,
    notConfigured: false,
  });
  assert.equal(queue.next()?.attempts, 2);
  assert.deepEqual(await drain.drain(), {
    sent: 0,
    failed: 1,
    dropped: 1,
    notConfigured: false,
  });
  assert.equal(queue.length, 0);
  assert.deepEqual(
    queue.dropped().map((item) => item.id),
    ["s1"],
  );
  assert.equal(queue.dropped()[0].attempts, 3);
});

test("no spin when the backend is unreachable: one attempt per drain pass", async () => {
  const queue = new OfflineStampQueue();
  queue.enqueue(stamp("s1"));
  queue.enqueue(stamp("s2"));
  queue.enqueue(stamp("s3"));
  let calls = 0;
  const drain = createOfflineSyncDrain(queue, async () => {
    calls += 1;
    throw new Error("offline");
  });
  const result = await drain.drain();
  assert.equal(calls, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.sent, 0);
  assert.equal(queue.length, 3);
  assert.equal(queue.next()?.id, "s1");
  assert.equal(queue.next()?.attempts, 1);
});

test("unconfigured stub: the stamp stays queued and burns no retry", async () => {
  const queue = new OfflineStampQueue();
  queue.enqueue(stamp("s1"));
  const logged: string[] = [];
  const drain = createOfflineSyncDrain(
    queue,
    createUnconfiguredStampSender((message) => {
      logged.push(message);
    }),
  );
  const first = await drain.drain();
  assert.deepEqual(first, {
    sent: 0,
    failed: 0,
    dropped: 0,
    notConfigured: true,
  });
  assert.deepEqual(logged, ["Server sync is not configured yet."]);
  assert.equal(queue.length, 1);
  assert.equal(queue.next()?.attempts, 0);
  const second = await drain.drain();
  assert.equal(second.notConfigured, true);
  assert.equal(queue.next()?.attempts, 0);
  assert.equal(logged.length, 2);
});

test("unconfigured stub sender throws SyncNotConfiguredError", async () => {
  const send = createUnconfiguredStampSender(() => {});
  await assert.rejects(send({ ...stamp("s1"), attempts: 0 }), SyncNotConfiguredError);
});

test("start drains on a cadence and stop blocks later drains", async () => {
  const queue = new OfflineStampQueue();
  queue.enqueue(stamp("s1"));
  queue.enqueue(stamp("s2"));
  const sent: string[] = [];
  const drain = new OfflineSyncDrain(queue, async (item) => {
    sent.push(item.id);
  }, 20);
  drain.start();
  await sleep(100);
  drain.stop();
  assert.deepEqual(sent, ["s1", "s2"]);
  assert.equal(queue.length, 0);
  queue.enqueue(stamp("s3"));
  assert.deepEqual(await drain.drain(), {
    sent: 0,
    failed: 0,
    dropped: 0,
    notConfigured: false,
  });
  assert.deepEqual(sent, ["s1", "s2"]);
  assert.equal(queue.length, 1);
});

test("stop lets a drain already in flight finish", async () => {
  const queue = new OfflineStampQueue();
  queue.enqueue(stamp("s1"));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const drain = createOfflineSyncDrain(queue, async () => {
    await gate;
  });
  const inFlight = drain.drain();
  drain.stop();
  release();
  const result = await inFlight;
  assert.equal(result.sent, 1);
  assert.equal(queue.length, 0);
});
