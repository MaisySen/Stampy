// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import test from "node:test";
// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import assert from "node:assert/strict";
import {
  blockMessage,
  canStamp,
  checkStaffPin,
  dayString,
} from "../src/lib/fraud.js";

test("staff PIN must match exactly", () => {
  assert.equal(checkStaffPin("4821", "4821"), true);
  assert.equal(checkStaffPin("4822", "4821"), false);
  assert.equal(checkStaffPin("482", "4821"), false);
  assert.equal(checkStaffPin("48211", "4821"), false);
});

test("first stamp is allowed", () => {
  const check = canStamp(null, null, 1000, "2026-11-20");
  assert.equal(check.allowed, true);
  assert.equal(check.reason, null);
});

test("cooldown blocks a stamp within 60 seconds", () => {
  const now = 1_000_000;
  const check = canStamp(now - 30_000, null, now, "2026-11-20");
  assert.equal(check.allowed, false);
  assert.equal(check.reason, "cooldown");
  assert.equal(check.waitSeconds, 30);
});

test("cooldown passes after 60 seconds", () => {
  const now = 1_000_000;
  const check = canStamp(now - 61_000, null, now, "2026-11-20");
  assert.equal(check.allowed, true);
});

test("daily limit blocks a second stamp on the same day", () => {
  const check = canStamp(null, "2026-11-20", 1_000_000, "2026-11-20");
  assert.equal(check.allowed, false);
  assert.equal(check.reason, "daily-limit");
});

test("daily limit resets the next day", () => {
  const check = canStamp(null, "2026-11-19", 1_000_000, "2026-11-20");
  assert.equal(check.allowed, true);
});

test("day string is zero padded", () => {
  assert.equal(dayString(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(dayString(new Date(2026, 10, 20)), "2026-11-20");
});

test("block messages explain the rule", () => {
  assert.ok(blockMessage({ allowed: false, reason: "daily-limit", waitSeconds: 0 }).includes("One stamp per day"));
  assert.ok(
    blockMessage({ allowed: false, reason: "cooldown", waitSeconds: 30 }).includes("30 seconds"),
  );
});
