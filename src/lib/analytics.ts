/**
 * Analytics totals for the business dashboard.
 * Pure logic. No React Native imports, so tests run with plain Node.
 */

import type { DayStat, StampMethod } from "../data";

export type MethodSplit = Record<StampMethod, number>;

export function totalStamps(split: MethodSplit): number {
  return split.NFC + split.QR + split.Staff;
}

export function splitShare(split: MethodSplit, total: number): Record<StampMethod, number> {
  if (total <= 0) {
    return { NFC: 0, QR: 0, Staff: 0 };
  }
  return {
    NFC: Math.round((split.NFC / total) * 100),
    QR: Math.round((split.QR / total) * 100),
    Staff: Math.round((split.Staff / total) * 100),
  };
}

export function weekTotal(week: DayStat[]): number {
  return week.reduce((sum, day) => sum + day.stamps, 0);
}

export function fullCards(stampsGiven: number, target: number): number {
  if (target <= 0) {
    return 0;
  }
  return Math.floor(Math.max(0, stampsGiven) / target);
}

export function repeatRate(visitors: number, repeatVisitors: number): number {
  if (visitors <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((repeatVisitors / visitors) * 100));
}
