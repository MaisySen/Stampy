// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import test from "node:test";
// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import assert from "node:assert/strict";
import {
  createHttpStampSender,
  createStampSenderForOrigin,
} from "../src/lib/stampSender.js";
import { SyncNotConfiguredError } from "../src/lib/offlineSync.js";
import type { QueuedStamp } from "../src/lib/offlineQueue.js";

const ORIGIN = "https://wallet.example";

function stamp(): QueuedStamp {
  return {
    id: "r-1790000000000",
    passId: "stampies-corner-cafe",
    businessId: "corner-cafe",
    createdAtMs: 1790000000000,
    attempts: 0,
  };
}

interface RecordedCall {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string };
}

function fakeFetch(
  status: number,
  body: unknown = { recorded: true, duplicate: false, stamps: 3 },
  calls: RecordedCall[] = [],
) {
  return async (url: string, init: RecordedCall["init"]) => {
    calls.push({ url, init });
    return {
      status,
      json: async () => body,
    };
  };
}

test("sender posts the exact four fields to /wallet/stamps with JSON content type", async () => {
  const calls: RecordedCall[] = [];
  const send = createHttpStampSender({ origin: ORIGIN, fetchImpl: fakeFetch(200, undefined, calls) });
  await send(stamp());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://wallet.example/wallet/stamps");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    stampId: "r-1790000000000",
    passId: "stampies-corner-cafe",
    businessId: "corner-cafe",
    createdAtMs: 1790000000000,
  });
});

test("sender resolves only on 200, including a duplicate 200", async () => {
  const recorded = createHttpStampSender({
    origin: ORIGIN,
    fetchImpl: fakeFetch(200, { recorded: true, duplicate: false, stamps: 3 }),
  });
  await recorded(stamp());
  const duplicate = createHttpStampSender({
    origin: ORIGIN,
    fetchImpl: fakeFetch(200, { recorded: false, duplicate: true, stamps: 3 }),
  });
  await duplicate(stamp());
});

test("sender rejects on 400, 404, 409, and 500", async () => {
  for (const status of [400, 404, 409, 500]) {
    const send = createHttpStampSender({ origin: ORIGIN, fetchImpl: fakeFetch(status) });
    await assert.rejects(send(stamp()), /Stamp sync failed with status/);
  }
});

test("sender rejects on network failure", async () => {
  const send = createHttpStampSender({
    origin: ORIGIN,
    fetchImpl: async () => {
      throw new Error("Network request failed.");
    },
  });
  await assert.rejects(send(stamp()), /Network request failed/);
});

test("sender rejects on a malformed response", async () => {
  const unparsable = createHttpStampSender({
    origin: ORIGIN,
    fetchImpl: async () => ({
      status: 200,
      json: async () => {
        throw new Error("Unexpected token.");
      },
    }),
  });
  await assert.rejects(unparsable(stamp()), /malformed/);
  const wrongShape = createHttpStampSender({
    origin: ORIGIN,
    fetchImpl: fakeFetch(200, { recorded: "yes", duplicate: false, stamps: 3 }),
  });
  await assert.rejects(wrongShape(stamp()), /malformed/);
  const missingField = createHttpStampSender({
    origin: ORIGIN,
    fetchImpl: fakeFetch(200, { recorded: true, duplicate: false }),
  });
  await assert.rejects(missingField(stamp()), /malformed/);
});

test("sender sends no count, reward state, or device identifier", async () => {
  const calls: RecordedCall[] = [];
  const send = createHttpStampSender({ origin: ORIGIN, fetchImpl: fakeFetch(200, undefined, calls) });
  await send(stamp());
  const body = JSON.parse(calls[0].init.body) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), [
    "businessId",
    "createdAtMs",
    "passId",
    "stampId",
  ]);
});

test("sender rejects a non-https origin and a malformed origin", () => {
  assert.throws(
    () => createHttpStampSender({ origin: "http://wallet.example" }),
    /https/,
  );
  assert.throws(
    () => createHttpStampSender({ origin: "not a url" }),
    /Invalid Wallet origin/,
  );
});

test("sender strips a trailing slash from the origin", async () => {
  const calls: RecordedCall[] = [];
  const send = createHttpStampSender({
    origin: "https://wallet.example/",
    fetchImpl: fakeFetch(200, undefined, calls),
  });
  await send(stamp());
  assert.equal(calls[0].url, "https://wallet.example/wallet/stamps");
});

test("unconfigured origin falls back to the stub sender", async () => {
  for (const origin of [null, "", "   "]) {
    const messages: string[] = [];
    const send = createStampSenderForOrigin(origin, (message) => {
      messages.push(message);
    });
    await assert.rejects(send(stamp()), SyncNotConfiguredError);
  }
});

test("unusable origin falls back to the stub sender and logs once", async () => {
  const messages: string[] = [];
  const send = createStampSenderForOrigin("http://wallet.example", (message) => {
    messages.push(message);
  });
  assert.deepEqual(messages, [
    "Wallet origin is not usable, server sync stays unconfigured.",
  ]);
  await assert.rejects(send(stamp()), SyncNotConfiguredError);
});

test("configured origin returns a working real sender", async () => {
  const calls: RecordedCall[] = [];
  const send = createStampSenderForOrigin(
    ORIGIN,
    () => {},
    fakeFetch(200, undefined, calls),
  );
  await send(stamp());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://wallet.example/wallet/stamps");
});
