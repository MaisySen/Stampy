// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import test from "node:test";
// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import assert from "node:assert/strict";
import {
  canInstall,
  canRetry,
  initialInstallStatus,
  installErrorMessage,
  installFailed,
  installStateLabel,
  installSucceeded,
  LOCAL_PREVIEW_NOTICE,
  previewStateLabel,
  resetInstall,
  retryInstall,
  startInstall,
} from "../src/lib/passInstall.js";

test("install starts not installed with no error", () => {
  const status = initialInstallStatus("apple");
  assert.equal(status.state, "notInstalled");
  assert.equal(status.attempts, 0);
  assert.equal(status.error, null);
  assert.equal(canInstall(status), true);
  assert.equal(canRetry(status), false);
  assert.equal(installStateLabel(status.state), "Add to Wallet");
});

test("install moves from not installed to installing", () => {
  const status = startInstall(initialInstallStatus("google"));
  assert.equal(status.state, "installing");
  assert.equal(installStateLabel(status.state), "Adding your pass");
});

test("install cannot start twice", () => {
  const started = startInstall(initialInstallStatus("apple"));
  assert.equal(startInstall(started), started);
});

test("install succeeds only from installing", () => {
  const done = installSucceeded(startInstall(initialInstallStatus("apple")));
  assert.equal(done.state, "installed");
  assert.equal(installStateLabel(done.state), "Pass added");
  assert.equal(installSucceeded(initialInstallStatus("apple")).state, "notInstalled");
});

test("install failure keeps the message and counts the attempt", () => {
  const failed = installFailed(
    startInstall(initialInstallStatus("apple")),
    installErrorMessage("network"),
  );
  assert.equal(failed.state, "failed");
  assert.equal(failed.attempts, 1);
  assert.equal(failed.error, "Check your connection and try again.");
  assert.ok(failed.lastErrorAt !== null);
  assert.equal(canRetry(failed), true);
  assert.equal(canInstall(failed), true);
});

test("install failure does nothing when not installing", () => {
  const status = installFailed(initialInstallStatus("apple"), "Nope.");
  assert.equal(status.state, "notInstalled");
  assert.equal(status.attempts, 0);
});

test("retry moves from failed back to installing", () => {
  const failed = installFailed(
    startInstall(initialInstallStatus("google")),
    installErrorMessage("unknown"),
  );
  const retried = retryInstall(failed);
  assert.equal(retried.state, "installing");
  assert.equal(retried.error, null);
  assert.equal(retried.attempts, 1);
});

test("retry does nothing when not failed", () => {
  const status = retryInstall(initialInstallStatus("apple"));
  assert.equal(status.state, "notInstalled");
});

test("reset returns to not installed and clears attempts", () => {
  const failed = installFailed(
    startInstall(initialInstallStatus("apple")),
    installErrorMessage("cancelled"),
  );
  const reset = resetInstall(failed);
  assert.equal(reset.state, "notInstalled");
  assert.equal(reset.attempts, 0);
  assert.equal(reset.error, null);
  assert.equal(reset.lastErrorAt, null);
});

test("install error messages are clear for each case", () => {
  assert.ok(installErrorMessage("network").includes("connection"));
  assert.ok(installErrorMessage("unsupported").includes("QR code"));
  assert.ok(installErrorMessage("cancelled").includes("cancelled"));
  assert.ok(installErrorMessage("missing").includes("fresh link"));
  assert.ok(installErrorMessage("unknown").includes("Try again"));
});

test("a second failure counts a second attempt", () => {
  let status = installFailed(
    startInstall(initialInstallStatus("apple")),
    installErrorMessage("network"),
  );
  status = installFailed(retryInstall(status), installErrorMessage("network"));
  assert.equal(status.attempts, 2);
  assert.equal(status.state, "failed");
});

test("preview labels never claim the pass was added to Wallet", () => {
  assert.equal(previewStateLabel("notInstalled"), "Preview Wallet pass");
  assert.equal(previewStateLabel("installing"), "Preparing preview");
  assert.equal(previewStateLabel("installed"), "Preview ready, not in Wallet");
  assert.equal(previewStateLabel("failed"), "Preview not shown");
  assert.match(LOCAL_PREVIEW_NOTICE, /No pass was issued/);
  assert.match(LOCAL_PREVIEW_NOTICE, /Apple or Google/);
});
