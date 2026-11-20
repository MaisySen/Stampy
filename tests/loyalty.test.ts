// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import test from "node:test";
// @ts-ignore - no @types/node in this repo; tests run on compiled JS.
import assert from "node:assert/strict";
import {
  birthdayCustomers,
  daysBetween,
  daysUntilBirthday,
  isBirthdayMonth,
  isBirthdayToday,
  isWinback,
  lapsedCustomers,
} from "../src/lib/loyalty.js";

const customers = [
  { id: "c1", name: "Maya", visits: 12, lastVisit: "2026-11-18", birthdayMonth: 11, birthdayDay: 20 },
  { id: "c2", name: "Jordan", visits: 7, lastVisit: "2026-11-15", birthdayMonth: 2, birthdayDay: 14 },
  { id: "c3", name: "Priya", visits: 9, lastVisit: "2026-10-06", birthdayMonth: 5, birthdayDay: 3 },
];

test("days between counts calendar days", () => {
  assert.equal(daysBetween("2026-11-01", "2026-11-20"), 19);
  assert.equal(daysBetween("2026-11-20", "2026-11-20"), 0);
});

test("birthday month matches the current month", () => {
  assert.equal(isBirthdayMonth(11, new Date(2026, 10, 20)), true);
  assert.equal(isBirthdayMonth(2, new Date(2026, 10, 20)), false);
});

test("birthday today needs month and day", () => {
  assert.equal(isBirthdayToday(11, 20, new Date(2026, 10, 20)), true);
  assert.equal(isBirthdayToday(11, 21, new Date(2026, 10, 20)), false);
});

test("days until birthday counts forward", () => {
  assert.equal(daysUntilBirthday(11, 20, new Date(2026, 10, 8)), 12);
  assert.equal(daysUntilBirthday(11, 20, new Date(2026, 10, 20)), 0);
});

test("days until birthday wraps to next year", () => {
  assert.equal(daysUntilBirthday(1, 1, new Date(2026, 11, 20)), 12);
});

test("win-back flags a customer quiet for 30 days", () => {
  assert.equal(isWinback("2026-10-06", "2026-11-20"), true);
  assert.equal(isWinback("2026-11-15", "2026-11-20"), false);
  assert.equal(isWinback("2026-10-21", "2026-11-20"), true);
});

test("lapsed list holds only quiet customers", () => {
  const lapsed = lapsedCustomers(customers, "2026-11-20");
  assert.deepEqual(lapsed.map((c) => c.name), ["Priya"]);
});

test("birthday list holds only this month birthdays", () => {
  const list = birthdayCustomers(customers, new Date(2026, 10, 20));
  assert.deepEqual(list.map((c) => c.name), ["Maya"]);
});
