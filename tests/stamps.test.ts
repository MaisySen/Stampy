// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import test from "node:test";
// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import assert from "node:assert/strict";
import { buildShareLink, buildShareSlug, stampProgress, validatePassBuilder } from "../src/lib/stamps.js";

test("stamp progress counts stamps left and percent", () => {
  const p = stampProgress(5, 9);
  assert.equal(p.stampsLeft, 4);
  assert.equal(p.rewardReady, false);
  assert.equal(p.percent, 56);
});

test("stamp progress is ready at the target", () => {
  const p = stampProgress(9, 9);
  assert.equal(p.stampsLeft, 0);
  assert.equal(p.rewardReady, true);
  assert.equal(p.percent, 100);
});

test("stamp progress caps percent at 100", () => {
  assert.equal(stampProgress(12, 9).percent, 100);
});

test("stamp progress starts at zero", () => {
  const p = stampProgress(0, 9);
  assert.equal(p.stampsLeft, 9);
  assert.equal(p.percent, 0);
});

test("pass builder accepts a valid draft", () => {
  const errors = validatePassBuilder({
    name: "Corner Cafe",
    reward: "Buy 8, get the 9th free",
    target: 9,
  });
  assert.deepEqual(errors, []);
});

test("pass builder requires name and reward", () => {
  const errors = validatePassBuilder({ name: "  ", reward: "", target: 9 });
  assert.ok(errors.some((e) => e.includes("Business name")));
  assert.ok(errors.some((e) => e.includes("Reward text")));
});

test("pass builder rejects a target outside 4 to 12", () => {
  assert.ok(
    validatePassBuilder({ name: "Cafe", reward: "Free coffee", target: 3 }).length > 0,
  );
  assert.ok(
    validatePassBuilder({ name: "Cafe", reward: "Free coffee", target: 13 }).length > 0,
  );
  assert.deepEqual(
    validatePassBuilder({ name: "Cafe", reward: "Free coffee", target: 12 }),
    [],
  );
});

test("pass builder rejects a bad menu link", () => {
  const errors = validatePassBuilder({
    name: "Cafe",
    reward: "Free coffee",
    target: 9,
    menuLink: "not a link",
  });
  assert.ok(errors.some((e) => e.includes("Menu link")));
});

test("pass builder needs a label for an external link", () => {
  const errors = validatePassBuilder({
    name: "Cafe",
    reward: "Free coffee",
    target: 9,
    externalLink: "https://example.com",
  });
  assert.ok(errors.some((e) => e.includes("label")));
});

test("share slug is lower case with hyphens", () => {
  assert.equal(buildShareSlug("Corner Cafe"), "corner-cafe");
  assert.equal(buildShareSlug("  My  Cafe! "), "my-cafe");
  assert.equal(buildShareSlug(""), "stampies");
});

test("share link uses the slug", () => {
  assert.equal(buildShareLink("Corner Cafe"), "https://stampies.app/p/corner-cafe");
});
