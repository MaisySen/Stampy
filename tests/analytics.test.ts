// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import test from "node:test";
// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import assert from "node:assert/strict";
import {
  fullCards,
  repeatRate,
  splitShare,
  totalStamps,
  weekTotal,
} from "../src/lib/analytics.js";

test("total stamps sums the method split", () => {
  assert.equal(totalStamps({ NFC: 214, QR: 187, Staff: 98 }), 499);
});

test("split share is a percent of the total", () => {
  const share = splitShare({ NFC: 214, QR: 187, Staff: 98 }, 499);
  assert.equal(share.NFC, 43);
  assert.equal(share.QR, 37);
  assert.equal(share.Staff, 20);
});

test("split share is zero when there are no stamps", () => {
  assert.deepEqual(splitShare({ NFC: 0, QR: 0, Staff: 0 }, 0), {
    NFC: 0,
    QR: 0,
    Staff: 0,
  });
});

test("week total sums the daily counts", () => {
  const week = [
    { day: "Mon", stamps: 62 },
    { day: "Tue", stamps: 78 },
    { day: "Wed", stamps: 54 },
    { day: "Thu", stamps: 89 },
    { day: "Fri", stamps: 96 },
    { day: "Sat", stamps: 71 },
    { day: "Sun", stamps: 49 },
  ];
  assert.equal(weekTotal(week), 499);
});

test("full cards counts completed cards", () => {
  assert.equal(fullCards(499, 9), 55);
  assert.equal(fullCards(8, 9), 0);
  assert.equal(fullCards(0, 9), 0);
});

test("repeat rate is a percent of visitors", () => {
  assert.equal(repeatRate(98, 63), 64);
  assert.equal(repeatRate(0, 0), 0);
});
