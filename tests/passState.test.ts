// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import test from "node:test";
// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import assert from "node:assert/strict";
import {
  applyStampToPass,
  canStampPass,
  derivePassState,
  passStateLabel,
  redeemPass,
  stampGrid,
} from "../src/lib/pass.js";

test("state is active while collecting stamps", () => {
  assert.equal(derivePassState({ stamps: 0, target: 9 }), "active");
  assert.equal(derivePassState({ stamps: 8, target: 9 }), "active");
  assert.equal(canStampPass("active"), true);
  assert.equal(passStateLabel("active"), "Collecting stamps");
});

test("state is reward earned at the target", () => {
  assert.equal(derivePassState({ stamps: 9, target: 9 }), "reward-earned");
  assert.equal(passStateLabel("reward-earned"), "Reward ready");
});

test("state is redeemed after a claim", () => {
  assert.equal(
    derivePassState({ stamps: 9, target: 9, redeemed: true }),
    "redeemed",
  );
  assert.equal(passStateLabel("redeemed"), "Reward claimed");
});

test("state is expired after the expiry date", () => {
  assert.equal(
    derivePassState({
      stamps: 5,
      target: 9,
      expiryIso: "2026-01-01",
      todayIso: "2026-06-01",
    }),
    "expired",
  );
  assert.equal(
    derivePassState({
      stamps: 5,
      target: 9,
      expiryIso: "2027-01-01",
      todayIso: "2026-06-01",
    }),
    "active",
  );
  assert.equal(passStateLabel("expired"), "Pass expired");
});

test("redeemed wins over expired", () => {
  assert.equal(
    derivePassState({
      stamps: 9,
      target: 9,
      redeemed: true,
      expiryIso: "2026-01-01",
      todayIso: "2026-06-01",
    }),
    "redeemed",
  );
});

test("a stamp on a full card moves it to reward earned", () => {
  const after = applyStampToPass({ stamps: 8, target: 9 });
  assert.equal(after.stamps, 9);
  assert.equal(after.state, "reward-earned");
});

test("a stamp on an expired pass is refused and changes nothing", () => {
  const after = applyStampToPass({
    stamps: 5,
    target: 9,
    expiryIso: "2026-01-01",
    todayIso: "2026-06-01",
  });
  assert.equal(after.stamps, 5);
  assert.equal(after.state, "expired");
  assert.equal(canStampPass("expired"), false);
});

test("a stamp on a redeemed pass is refused and changes nothing", () => {
  const after = applyStampToPass({ stamps: 9, target: 9, redeemed: true });
  assert.equal(after.stamps, 9);
  assert.equal(after.state, "redeemed");
  assert.equal(canStampPass("redeemed"), false);
});

test("a stamp on a full card is refused and changes nothing", () => {
  const after = applyStampToPass({ stamps: 9, target: 9 });
  assert.equal(after.stamps, 9);
  assert.equal(after.state, "reward-earned");
  assert.equal(canStampPass("reward-earned"), false);
});

test("redeem moves a full card to redeemed and nothing else", () => {
  assert.equal(redeemPass({ stamps: 9, target: 9 }), "redeemed");
  assert.equal(redeemPass({ stamps: 5, target: 9 }), "active");
  assert.equal(
    redeemPass({
      stamps: 5,
      target: 9,
      expiryIso: "2026-01-01",
      todayIso: "2026-06-01",
    }),
    "expired",
  );
  assert.equal(redeemPass({ stamps: 9, target: 9, redeemed: true }), "redeemed");
});

test("stamp grid shows filled and empty dots", () => {
  assert.equal(stampGrid(0, 9), "○○○○○○○○○");
  assert.equal(stampGrid(5, 9), "●●●●●○○○○");
  assert.equal(stampGrid(9, 9), "●●●●●●●●●");
  assert.equal(stampGrid(14, 9), "●●●●●●●●●");
});
