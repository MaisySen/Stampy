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
  passShareLink,
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

test("pass share link uses the business slug", () => {
  assert.equal(passShareLink("Corner Cafe"), "https://stampies.app/p/corner-cafe");
  assert.equal(passShareLink("  "), "https://stampies.app/p/stampies");
});

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

test("reward state is reward earned at the target", () => {
  assert.equal(passRewardState(9, 9), "reward-earned");
  assert.equal(passStateLabel("reward-earned"), "Reward ready");
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

test("apple pass carries the stamp grid, terms and Powered by Stampies", () => {
  const payload = buildApplePass(program(), 5);
  assert.equal(payload.storeCard.primaryFields[1].key, "grid");
  assert.equal(payload.storeCard.primaryFields[1].value, "●●●●●○○○○");
  const back = new Map(
    payload.storeCard.backFields.map((f) => [f.key, f.value]),
  );
  assert.equal(
    back.get("terms"),
    "One stamp per visit. One visit per day. The reward is the free item shown on this card. The pass cannot be used after its expiry date.",
  );
  assert.equal(back.get("poweredBy"), "Powered by Stampies");
  assert.equal(back.get("state"), "Collecting stamps");
});

test("apple pass for a full 9 stamp card carries every field", () => {
  const payload = buildApplePass(
    program({ latitude: -33.86, longitude: 151.2, expiryIso: "2027-06-30" }),
    9,
  );
  assert.equal(payload.description, "Corner Cafe stamp card");
  assert.equal(payload.logoText, "Corner Cafe");
  assert.equal(payload.storeCard.primaryFields[0].value, "9 of 9");
  assert.equal(payload.storeCard.primaryFields[1].value, "●●●●●●●●●");
  assert.equal(
    payload.storeCard.secondaryFields[0].value,
    "Buy 8, get the 9th free",
  );
  assert.equal(payload.storeCard.auxiliaryFields[0].value, "Reward ready");
  assert.equal(payload.barcode.format, "PKBarcodeFormatQR");
  assert.equal(payload.barcode.message, "stampies-c1-0001");
  assert.equal(payload.barcode.messageEncoding, "iso-8859-1");
  assert.equal(payload.locations?.[0].latitude, -33.86);
  assert.equal(payload.locations?.[0].longitude, 151.2);
  assert.equal(
    payload.locations?.[0].relevantText,
    "You are near Corner Cafe.",
  );
  assert.equal(payload.expirationDate, "2027-06-30");
  assert.equal(payload.voided, false);
  const back = new Map(
    payload.storeCard.backFields.map((f) => [f.key, f.value]),
  );
  assert.equal(back.get("state"), "Reward ready");
  assert.equal(back.get("poweredBy"), "Powered by Stampies");
});

test("apple pass for an expired card is voided", () => {
  const payload = buildApplePass(program({ expiryIso: "2026-01-01" }), 5, {
    todayIso: "2026-06-01",
  });
  assert.equal(payload.voided, true);
  const back = new Map(
    payload.storeCard.backFields.map((f) => [f.key, f.value]),
  );
  assert.equal(back.get("state"), "Pass expired");
});

test("google pass carries the business, grid, terms and Powered by Stampies", () => {
  const payload = buildGooglePass(program(), 5);
  const modules = new Map(
    payload.textModulesData.map((m) => [m.id, m.body]),
  );
  assert.equal(modules.get("business"), "Corner Cafe");
  assert.equal(modules.get("reward"), "Buy 8, get the 9th free");
  assert.equal(modules.get("stamp-grid"), "●●●●●○○○○");
  assert.equal(modules.get("status"), "Collecting stamps");
  assert.equal(
    modules.get("terms"),
    "One stamp per visit. One visit per day. The reward is the free item shown on this card. The pass cannot be used after its expiry date.",
  );
  assert.equal(modules.get("powered-by"), "Powered by Stampies");
  assert.equal(payload.barcode.type, "QR_CODE");
  assert.equal(payload.barcode.value, "stampies-c1-0001");
});

test("google pass for a full 9 stamp card carries every field", () => {
  const payload = buildGooglePass(
    program({ latitude: -33.86, longitude: 151.2, expiryIso: "2027-06-30" }),
    9,
  );
  assert.equal(payload.loyaltyPoints.label, "Stamps");
  assert.equal(payload.loyaltyPoints.balance.string, "9 of 9");
  assert.equal(payload.state, "ACTIVE");
  const modules = new Map(
    payload.textModulesData.map((m) => [m.id, m.body]),
  );
  assert.equal(modules.get("business"), "Corner Cafe");
  assert.equal(modules.get("stamp-grid"), "●●●●●●●●●");
  assert.equal(
    modules.get("to-go"),
    "Reward ready. Show this pass at the counter.",
  );
  assert.equal(modules.get("status"), "Reward ready");
  assert.equal(payload.locations?.[0].latitude, -33.86);
  assert.equal(payload.locations?.[0].longitude, 151.2);
  assert.equal(payload.validTimeInterval?.end.date, "2027-06-30");
  assert.equal(
    payload.linksModuleData.uris[0].uri,
    "https://stampies.app/p/corner-cafe",
  );
});

test("google pass for a redeemed card is inactive", () => {
  const payload = buildGooglePass(program(), 9, { redeemed: true });
  assert.equal(payload.state, "INACTIVE");
  const modules = new Map(
    payload.textModulesData.map((m) => [m.id, m.body]),
  );
  assert.equal(modules.get("status"), "Reward claimed");
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
  assert.equal(after.state, "reward-earned");
  assert.equal(after.stamps, 9);
  assert.equal(after.stampsLeft, 0);
  assert.equal(after.apple.storeCard.primaryFields[0].value, "9 of 9");
  assert.equal(after.google.loyaltyPoints.balance.string, "9 of 9");
});

test("pass payloads cap stamps at the target", () => {
  const payloads = buildPassPayloads(program(), 14);
  assert.equal(payloads.stamps, 9);
  assert.equal(payloads.state, "reward-earned");
});
