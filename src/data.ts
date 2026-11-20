/**
 * Local data for Stampies.
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

export const BIRTHDAY_DAYS_TO_GO = 5;

export interface Customer {
  id: string;
  name: string;
  visits: number;
  lastVisit: string;
  birthdayMonth: number;
  birthdayDay: number;
}

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayIso(): string {
  return isoDaysAgo(0);
}

/**
 * Demo customers. Dates are relative to today, so the win-back list
 * stays true as time passes. One customer lapsed 45 days ago, one has
 * a birthday this month. The business can clear this data.
 */
export const demoCustomers: Customer[] = [
  {
    id: "c1",
    name: "Maya",
    visits: 12,
    lastVisit: isoDaysAgo(2),
    birthdayMonth: new Date().getMonth() + 1,
    birthdayDay: new Date().getDate(),
  },
  {
    id: "c2",
    name: "Jordan",
    visits: 7,
    lastVisit: isoDaysAgo(5),
    birthdayMonth: ((new Date().getMonth() + 3) % 12) + 1,
    birthdayDay: 14,
  },
  {
    id: "c3",
    name: "Priya",
    visits: 9,
    lastVisit: isoDaysAgo(45),
    birthdayMonth: ((new Date().getMonth() + 6) % 12) + 1,
    birthdayDay: 3,
  },
  {
    id: "c4",
    name: "Tom",
    visits: 4,
    lastVisit: isoDaysAgo(38),
    birthdayMonth: ((new Date().getMonth() + 9) % 12) + 1,
    birthdayDay: 21,
  },
];

export const emptyCustomers: Customer[] = [];

/**
 * Demo customer birthday for the Wallet screen. Five days from today,
 * kept inside the current month, so the birthday reward card shows.
 */
export const DEMO_BIRTHDAY: { month: number; day: number } = (() => {
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const day = Math.min(today.getDate() + BIRTHDAY_DAYS_TO_GO, daysInMonth);
  return { month: today.getMonth() + 1, day };
})();
