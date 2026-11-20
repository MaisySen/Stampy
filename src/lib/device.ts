/**
 * Fraud device check for stamping.
 * Pure logic. No React Native imports, no secrets, no login.
 *
 * The device identifier is passed in by the caller. This lib never
 * collects a device id itself and never reads the device. It only
 * records the ids it is given, per pass, and flags suspicious use.
 *
 * Rules:
 * - The first device seen for a pass is the baseline, not a flag.
 * - A pass stamped from a new device after that is flagged.
 * - More than 3 different devices in 24 hours for one pass is
 *   flagged as too many devices.
 *
 * Time is injected by the caller as nowMs, so tests can move the
 * clock and the 24 hour window is exact.
 */

export const MAX_DEVICES_24H = 3;
export const DEVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type DeviceFlagReason = "new-device" | "too-many-devices";

export interface DeviceCheckResult {
  flagged: boolean;
  newDevice: boolean;
  deviceCount: number;
  reason: DeviceFlagReason | null;
  message: string;
}

interface DeviceSeen {
  firstSeenMs: number;
  lastSeenMs: number;
}

export class DeviceHistory {
  private seen = new Map<string, Map<string, DeviceSeen>>();

  /**
   * Record a stamp from a device for a pass and check it.
   * Returns whether the stamp is flagged, why, and how many
   * different devices have stamped this pass in the last 24 hours.
   */
  check(passId: string, deviceId: string, nowMs: number): DeviceCheckResult {
    let perPass = this.seen.get(passId);
    if (perPass === undefined) {
      perPass = new Map<string, DeviceSeen>();
      this.seen.set(passId, perPass);
    }
    this.prune(perPass, nowMs);
    const isFirstDevice = perPass.size === 0;
    const newDevice = !perPass.has(deviceId);
    const existing = perPass.get(deviceId);
    perPass.set(deviceId, {
      firstSeenMs: existing === undefined ? nowMs : existing.firstSeenMs,
      lastSeenMs: nowMs,
    });
    const deviceCount = perPass.size;
    if (deviceCount > MAX_DEVICES_24H) {
      return {
        flagged: true,
        newDevice,
        deviceCount,
        reason: "too-many-devices",
        message: `This pass was stamped from more than ${MAX_DEVICES_24H} devices in 24 hours. Please check with staff.`,
      };
    }
    if (newDevice && !isFirstDevice) {
      return {
        flagged: true,
        newDevice,
        deviceCount,
        reason: "new-device",
        message:
          "This pass was stamped from a new device. Please check with staff.",
      };
    }
    return {
      flagged: false,
      newDevice,
      deviceCount,
      reason: null,
      message: "",
    };
  }

  /** Different devices seen for a pass in the last 24 hours. */
  deviceCount(passId: string, nowMs: number): number {
    const perPass = this.seen.get(passId);
    if (perPass === undefined) {
      return 0;
    }
    this.prune(perPass, nowMs);
    return perPass.size;
  }

  /** True if this device has stamped this pass in the last 24 hours. */
  isKnownDevice(passId: string, deviceId: string, nowMs: number): boolean {
    const perPass = this.seen.get(passId);
    if (perPass === undefined) {
      return false;
    }
    this.prune(perPass, nowMs);
    return perPass.has(deviceId);
  }

  /** Forget all recorded devices, for tests or a fresh start. */
  clear(): void {
    this.seen.clear();
  }

  private prune(perPass: Map<string, DeviceSeen>, nowMs: number): void {
    const cutoff = nowMs - DEVICE_WINDOW_MS;
    for (const [deviceId, seen] of perPass) {
      if (seen.lastSeenMs < cutoff) {
        perPass.delete(deviceId);
      }
    }
  }
}

export function deviceFlagMessage(result: DeviceCheckResult): string {
  return result.message;
}
