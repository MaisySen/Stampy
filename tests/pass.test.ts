// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import test from "node:test";
// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import assert from "node:assert/strict";
import {
  buildApplePass,
  buildGooglePass,
  buildPassPayloads,
  isPassExpired,
  passRewardState,
  passStateLabel,
  updatePassOnStamp,
  validatePassProgram,
} from "../src/lib/pass.js";
import type { PassProgram } from "../src/lib/pass.js";

function program(overrides: Partial<PassProgram> = {}): PassProgram {
  return {
    businessName: "Corner Cafe",
    reward: "Buy 8, get the 9th free",
    target: 9,
    brandColor: "#C9B8FF",
    cover: "Lavender dusk",
    barcodeValue: "stampies-c1-0001",
    ...overrides,
  };
}

test("pass program accepts a valid program", () => {
  assert.deepEqual(validatePassProgram(program()), []);
});

test("pass program requires name and reward", () => {
  const errors = validatePassProgram(program({ businessName: "  ", reward: "" }));
  assert.ok(errors.some((e) => e.includes("Business name")));
  assert.ok(errors.some((e) => e.includes("Reward text")));
});

test("pass program rejects a target outside 4 to 12", () => {
  assert.ok(validatePassProgram(program({ target: 3 })).length > 0);
  assert.ok(validatePassProgram(program({ target: 13 })).length > 0);
  assert.deepEqual(validatePassProgram(program({ target: 12 })), []);
});

test("pass program rejects a bad brand colour", () => {
  const errors = validatePassProgram(program({ brandColor: "lavender" }));
  assert.ok(errors.some((e) => e.includes("hex colour")));
});

test("pass program rejects a bad expiry date", () => {
  const errors = validatePassProgram(program({ expiryIso: "30 June 2027" }));
  assert.ok(errors.some((e) => e.includes("Expiry date")));
});

test("pass program needs both parts of a location", () => {
  const errors = validatePassProgram(program({ latitude: -33.86 }));
  assert.ok(errors.some((e) => e.includes("latitude and longitude")));
});

test("pass program rejects a latitude outside range", () => {
  const errors = validatePassProgram(
    program({ latitude: 120, longitude: 151.2 }),
  );
  assert.ok(errors.some((e) => e.includes("Latitude")));
});

test("reward state is active below the target", () => {
  assert.equal(passRewardState(5, 9), "active");
  assert.equal(passStateLabel("active"), "Collecting stamps");
});

test("reward state is full at the target", () => {
  assert.equal(passRewardState(9, 9), "full");
  assert.equal(passStateLabel("full"), "Reward ready");
});

test("reward state is redeemed after a claim", () => {
  assert.equal(passRewardState(9, 9, { redeemed: true }), "redeemed");
});

test("reward state is expired after the expiry date", () => {
  assert.equal(
    passRewardState(5, 9, { expiryIso: "2026-01-01", todayIso: "2026-06-01" }),
    "expired",
  );
  assert.equal(
    passRewardState(5, 9, { expiryIso: "2027-01-01", todayIso: "2026-06-01" }),
    "active",
  );
});

test("isPassExpired compares dates", () => {
  assert.equal(isPassExpired("2026-01-01", "2026-06-01"), true);
  assert.equal(isPassExpired("2027-01-01", "2026-06-01"), false);
  assert.equal(isPassExpired(undefined, "2026-06-01"), false);
  assert.equal(isPassExpired("not a date", "2026-06-01"), false);
});

test("apple pass carries the stamp count and reward", () => {
  const payload = buildApplePass(program(), 5);
  assert.equal(payload.passTypeIdentifier, "pass.au.fintex.stampies");
  assert.equal(payload.organizationName, "Fintex Australia Pty Ltd");
  assert.equal(payload.storeCard.primaryFields[0].value, "5 of 9");
  assert.equal(payload.storeCard.secondaryFields[0].value, "Buy 8, get the 9th free");
  assert.equal(payload.barcode.format, "PKBarcodeFormatQR");
  assert.equal(payload.barcode.message, "stampies-c1-0001");
  assert.equal(payload.voided, false);
});

test("apple pass shows reward ready at full", () => {
  const payload = buildApplePass(program(), 9);
  assert.equal(payload.storeCard.auxiliaryFields[0].value, "Reward ready");
});

test("apple pass carries location and expiry when given", () => {
  const payload = buildApplePass(
    program({ latitude: -33.86, longitude: 151.2, expiryIso: "2027-06-30" }),
    2,
  );
  assert.equal(payload.locations?.[0].latitude, -33.86);
  assert.equal(payload.locations?.[0].longitude, 151.2);
  assert.equal(payload.expirationDate, "2027-06-30");
});

test("apple pass has no location when none is given", () => {
  const payload = buildApplePass(program(), 2);
  assert.equal(payload.locations, undefined);
  assert.equal(payload.expirationDate, undefined);
});

test("google pass carries the stamp count and share link", () => {
  const payload = buildGooglePass(program(), 5);
  assert.equal(payload.loyaltyPoints.balance.string, "5 of 9");
  assert.equal(payload.state, "ACTIVE");
  assert.equal(payload.barcode.type, "QR_CODE");
  assert.equal(
    payload.linksModuleData.uris[0].uri,
    "https://stampies.app/p/corner-cafe",
  );
});

test("google pass is expired after the expiry date", () => {
  const payload = buildGooglePass(program({ expiryIso: "2026-01-01" }), 5, {
    todayIso: "2026-06-01",
  });
  assert.equal(payload.state, "EXPIRED");
  assert.equal(payload.validTimeInterval?.end.date, "2026-01-01");
});

test("pass update on stamp moves the count and state", () => {
  const before = buildPassPayloads(program(), 8);
  assert.equal(before.state, "active");
  assert.equal(before.stampsLeft, 1);
  const after = updatePassOnStamp(program(), 9);
  assert.equal(after.state, "full");
  assert.equal(after.stamps, 9);
  assert.equal(after.stampsLeft, 0);
  assert.equal(after.apple.storeCard.primaryFields[0].value, "9 of 9");
  assert.equal(after.google.loyaltyPoints.balance.string, "9 of 9");
});

test("pass payloads cap stamps at the target", () => {
  const payloads = buildPassPayloads(program(), 14);
  assert.equal(payloads.stamps, 9);
  assert.equal(payloads.state, "full");
});
