/**
 * Fraud controls for stamping.
 * Pure logic. No React Native imports, so tests run with plain Node.
 *
 * Defaults, also documented in docs/PLAN.md:
 * - Staff PIN: 4 digits, set by the business in Program settings.
 * - Cooldown: 60 seconds between stamps for the same pass.
 * - Daily limit: 1 stamp per pass per business per calendar day.
 */

import {
  DeviceHistory,
  deviceFlagMessage,
  type DeviceCheckResult,
} from "./device.js";

export type { DeviceCheckResult } from "./device.js";

export const STAFF_PIN_LENGTH = 4;
export const STAMP_COOLDOWN_SECONDS = 60;
export const STAMPS_PER_DAY = 1;

export function checkStaffPin(entered: string, expected: string): boolean {
  const clean = entered.replace(/[^0-9]/g, "");
  return clean.length === STAFF_PIN_LENGTH && clean === expected;
}

export type StampBlockReason = "cooldown" | "daily-limit";

export interface StampCheck {
  allowed: boolean;
  reason: StampBlockReason | null;
  waitSeconds: number;
}

export function canStamp(
  lastStampAtMs: number | null,
  lastStampDay: string | null,
  nowMs: number,
  today: string,
): StampCheck {
  if (lastStampDay !== null && lastStampDay === today) {
    return { allowed: false, reason: "daily-limit", waitSeconds: 0 };
  }
  if (lastStampAtMs !== null) {
    const waitMs = lastStampAtMs + STAMP_COOLDOWN_SECONDS * 1000 - nowMs;
    if (waitMs > 0) {
      return {
        allowed: false,
        reason: "cooldown",
        waitSeconds: Math.ceil(waitMs / 1000),
      };
    }
  }
  return { allowed: true, reason: null, waitSeconds: 0 };
}

export function dayString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function blockMessage(check: StampCheck): string {
  if (check.reason === "daily-limit") {
    return "One stamp per day. Come back tomorrow for the next stamp.";
  }
  if (check.reason === "cooldown") {
    return `Please wait ${check.waitSeconds} seconds before the next stamp.`;
  }
  return "";
}

/**
 * Device check hook for stamping. Records the stamp device in the
 * given history and returns the device flag result. PIN, cooldown,
 * and daily limit behaviour is unchanged, callers decide what to
 * do with a flagged device.
 */
export function checkStampDevice(
  history: DeviceHistory,
  passId: string,
  deviceId: string,
  nowMs: number,
): DeviceCheckResult {
  return history.check(passId, deviceId, nowMs);
}

export function deviceBlockMessage(result: DeviceCheckResult): string {
  return deviceFlagMessage(result);
}
