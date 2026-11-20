/**
 * Birthday reward and win-back logic.
 * Pure logic, local only. No server sync yet, and no login.
 * Dates are plain calendar dates, no time zones in the logic.
 */

export const WINBACK_DAYS = 30;
export const BIRTHDAY_SOON_DAYS = 14;

export interface Customer {
  id: string;
  name: string;
  visits: number;
  lastVisit: string;
  birthdayMonth: number;
  birthdayDay: number;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00`);
  const to = new Date(`${toIso}T00:00:00`);
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function isBirthdayMonth(birthdayMonth: number, today: Date): boolean {
  return birthdayMonth === today.getMonth() + 1;
}

export function isBirthdayToday(
  birthdayMonth: number,
  birthdayDay: number,
  today: Date,
): boolean {
  return (
    birthdayMonth === today.getMonth() + 1 && birthdayDay === today.getDate()
  );
}

export function daysUntilBirthday(
  birthdayMonth: number,
  birthdayDay: number,
  today: Date,
): number {
  const year = today.getFullYear();
  const thisYear = new Date(year, birthdayMonth - 1, birthdayDay);
  const start = new Date(year, today.getMonth(), today.getDate());
  if (thisYear.getTime() >= start.getTime()) {
    return Math.round((thisYear.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  }
  const nextYear = new Date(year + 1, birthdayMonth - 1, birthdayDay);
  return Math.round((nextYear.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

export function isWinback(
  lastVisitIso: string,
  todayIso: string,
  days = WINBACK_DAYS,
): boolean {
  return daysBetween(lastVisitIso, todayIso) >= days;
}

export function lapsedCustomers(
  customers: Customer[],
  todayIso: string,
  days = WINBACK_DAYS,
): Customer[] {
  return customers.filter((c) => isWinback(c.lastVisit, todayIso, days));
}

export function birthdayCustomers(
  customers: Customer[],
  today: Date,
): Customer[] {
  return customers.filter((c) => isBirthdayMonth(c.birthdayMonth, today));
}
