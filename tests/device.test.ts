// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import test from "node:test";
// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import assert from "node:assert/strict";
import { DEVICE_WINDOW_MS, DeviceHistory, deviceFlagMessage } from "../src/lib/device.js";
import { checkStampDevice } from "../src/lib/fraud.js";

const HOUR_MS = 60 * 60 * 1000;
const NOW = 10_000_000;

test("first device for a pass is the baseline, not a flag", () => {
  const history = new DeviceHistory();
  const result = history.check("pass-1", "device-a", NOW);
  assert.equal(result.flagged, false);
  assert.equal(result.newDevice, true);
  assert.equal(result.deviceCount, 1);
  assert.equal(result.reason, null);
});

test("same device again is not flagged", () => {
  const history = new DeviceHistory();
  history.check("pass-1", "device-a", NOW);
  const result = history.check("pass-1", "device-a", NOW + HOUR_MS);
  assert.equal(result.flagged, false);
  assert.equal(result.newDevice, false);
  assert.equal(result.deviceCount, 1);
});

test("a new device for a known pass is flagged", () => {
  const history = new DeviceHistory();
  history.check("pass-1", "device-a", NOW);
  const result = history.check("pass-1", "device-b", NOW + HOUR_MS);
  assert.equal(result.flagged, true);
  assert.equal(result.newDevice, true);
  assert.equal(result.reason, "new-device");
  assert.equal(result.deviceCount, 2);
  assert.ok(result.message.includes("new device"));
});

test("more than 3 devices in 24 hours is flagged", () => {
  const history = new DeviceHistory();
  history.check("pass-1", "device-a", NOW);
  history.check("pass-1", "device-b", NOW + HOUR_MS);
  history.check("pass-1", "device-c", NOW + 2 * HOUR_MS);
  const result = history.check("pass-1", "device-d", NOW + 3 * HOUR_MS);
  assert.equal(result.flagged, true);
  assert.equal(result.reason, "too-many-devices");
  assert.equal(result.deviceCount, 4);
  assert.ok(result.message.includes("more than 3 devices"));
});

test("devices are counted per pass, not across passes", () => {
  const history = new DeviceHistory();
  history.check("pass-1", "device-a", NOW);
  history.check("pass-1", "device-b", NOW + HOUR_MS);
  history.check("pass-1", "device-c", NOW + 2 * HOUR_MS);
  const result = history.check("pass-2", "device-d", NOW + 3 * HOUR_MS);
  assert.equal(result.flagged, false);
  assert.equal(result.deviceCount, 1);
});

test("24 hour window: devices older than 24 hours do not count", () => {
  const history = new DeviceHistory();
  history.check("pass-1", "device-a", NOW);
  history.check("pass-1", "device-b", NOW + HOUR_MS);
  history.check("pass-1", "device-c", NOW + 2 * HOUR_MS);
  const later = NOW + DEVICE_WINDOW_MS + 3 * HOUR_MS;
  assert.equal(history.deviceCount("pass-1", later), 0);
  assert.equal(history.isKnownDevice("pass-1", "device-a", later), false);
  const result = history.check("pass-1", "device-d", later);
  assert.equal(result.flagged, false);
  assert.equal(result.deviceCount, 1);
  assert.equal(result.reason, null);
});

test("device inside the 24 hour window still counts", () => {
  const history = new DeviceHistory();
  history.check("pass-1", "device-a", NOW);
  assert.equal(history.deviceCount("pass-1", NOW + DEVICE_WINDOW_MS - 1000), 1);
  assert.equal(history.isKnownDevice("pass-1", "device-a", NOW + HOUR_MS), true);
});

test("fraud hook calls the device check without changing PIN or limit rules", () => {
  const history = new DeviceHistory();
  const first = checkStampDevice(history, "pass-1", "device-a", NOW);
  assert.equal(first.flagged, false);
  const second = checkStampDevice(history, "pass-1", "device-b", NOW + HOUR_MS);
  assert.equal(second.flagged, true);
  assert.equal(second.reason, "new-device");
  assert.ok(deviceFlagMessage(second).includes("new device"));
});
