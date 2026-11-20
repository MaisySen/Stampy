/**
 * Pass install flow for Stampies.
 * A small state machine, with no platform calls.
 * The real Add to Wallet call is server and store work, so this
 * tracks the flow only, and gives a clear message on failure.
 */

export type PassInstallState = "notInstalled" | "installing" | "installed" | "failed";

export type InstallPlatform = "apple" | "google";

export interface PassInstallStatus {
  state: PassInstallState;
  platform: InstallPlatform;
  attempts: number;
  error: string | null;
  lastErrorAt: string | null;
}

export function initialInstallStatus(platform: InstallPlatform): PassInstallStatus {
  return {
    state: "notInstalled",
    platform,
    attempts: 0,
    error: null,
    lastErrorAt: null,
  };
}

export function canInstall(status: PassInstallStatus): boolean {
  return status.state === "notInstalled" || status.state === "failed";
}

export function canRetry(status: PassInstallStatus): boolean {
  return status.state === "failed";
}

export function startInstall(status: PassInstallStatus): PassInstallStatus {
  if (!canInstall(status)) {
    return status;
  }
  return { ...status, state: "installing", error: null };
}

export function installSucceeded(status: PassInstallStatus): PassInstallStatus {
  if (status.state !== "installing") {
    return status;
  }
  return { ...status, state: "installed", error: null };
}

export function installFailed(
  status: PassInstallStatus,
  error: string,
): PassInstallStatus {
  if (status.state !== "installing") {
    return status;
  }
  return {
    ...status,
    state: "failed",
    attempts: status.attempts + 1,
    error,
    lastErrorAt: new Date().toISOString(),
  };
}

export function retryInstall(status: PassInstallStatus): PassInstallStatus {
  if (!canRetry(status)) {
    return status;
  }
  return { ...status, state: "installing", error: null };
}

export function resetInstall(status: PassInstallStatus): PassInstallStatus {
  return {
    state: "notInstalled",
    platform: status.platform,
    attempts: 0,
    error: null,
    lastErrorAt: null,
  };
}

export type InstallErrorCode = "network" | "unsupported" | "cancelled" | "missing" | "unknown";

export function installErrorMessage(code: InstallErrorCode): string {
  if (code === "network") {
    return "Check your connection and try again.";
  }
  if (code === "unsupported") {
    return "This phone cannot add a Wallet pass. Use the QR code at the counter instead.";
  }
  if (code === "cancelled") {
    return "Install was cancelled. You can try again.";
  }
  if (code === "missing") {
    return "The pass link is missing. Ask the business for a fresh link.";
  }
  return "The pass could not be added. Try again.";
}

export function installStateLabel(state: PassInstallState): string {
  if (state === "installing") {
    return "Adding your pass";
  }
  if (state === "installed") {
    return "Pass added";
  }
  if (state === "failed") {
    return "Pass not added";
  }
  return "Add to Wallet";
}
