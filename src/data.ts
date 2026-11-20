/**
 * Local data for Stampy.
 * This is demo data for one business. It lives on the device.
 * The business can clear it from the Analytics screen.
 * Server sync ships with the Wallet pass work.
 */

export type StampMethod = "NFC" | "QR" | "Staff";

export interface DayStat {
  day: string;
  stamps: number;
}

export interface RecentStamp {
  id: string;
  customer: string;
  method: StampMethod;
  time: string;
}

export interface BusinessState {
  name: string;
  reward: string;
  stampsGiven: number;
  visitors: number;
  repeatRate: number;
  split: Record<StampMethod, number>;
  week: DayStat[];
  recent: RecentStamp[];
}

export const STAMPS_TO_REWARD = 8;

export const DEMO_STAFF_CODE = "4821";

export const demoBusiness: BusinessState = {
  name: "Corner Cafe",
  reward: "Buy 8, get the 9th free",
  stampsGiven: 499,
  visitors: 98,
  repeatRate: 64,
  split: { NFC: 214, QR: 187, Staff: 98 },
  week: [
    { day: "Mon", stamps: 62 },
    { day: "Tue", stamps: 78 },
    { day: "Wed", stamps: 54 },
    { day: "Thu", stamps: 89 },
    { day: "Fri", stamps: 96 },
    { day: "Sat", stamps: 71 },
    { day: "Sun", stamps: 49 },
  ],
  recent: [
    { id: "r1", customer: "Maya", method: "NFC", time: "Today, 9:41" },
    { id: "r2", customer: "Jordan", method: "QR", time: "Today, 9:12" },
    { id: "r3", customer: "Priya", method: "Staff", time: "Today, 8:48" },
    { id: "r4", customer: "Tom", method: "NFC", time: "Yesterday, 17:20" },
  ],
};

export const emptyBusiness: BusinessState = {
  name: "Corner Cafe",
  reward: "Buy 8, get the 9th free",
  stampsGiven: 0,
  visitors: 0,
  repeatRate: 0,
  split: { NFC: 0, QR: 0, Staff: 0 },
  week: [
    { day: "Mon", stamps: 0 },
    { day: "Tue", stamps: 0 },
    { day: "Wed", stamps: 0 },
    { day: "Thu", stamps: 0 },
    { day: "Fri", stamps: 0 },
    { day: "Sat", stamps: 0 },
    { day: "Sun", stamps: 0 },
  ],
  recent: [],
};

export const BIRTHDAY_DAYS_TO_GO = 12;
