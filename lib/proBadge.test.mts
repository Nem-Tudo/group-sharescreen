// node --import ./lib/ts-resolve.mjs --experimental-strip-types --test lib/proBadge.test.mts
import assert from "node:assert/strict";
import test from "node:test";
import {
  completedMonths,
  PRO_BADGE_MONTHS,
  proBadgeLevel,
  withPlanTheme,
  withProBadgeLevel,
} from "./proBadge";
import type { BadgeDefinition } from "./badges";

const at = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 12);

const badge = (id: string): BadgeDefinition => ({
  id,
  name: id,
  description: "",
  iconUrl: "stale",
  chipClass: "stale",
  createdAt: 0,
});

test("a month is complete on the same day of the next one", () => {
  assert.equal(completedMonths(at(2026, 1, 10), at(2026, 2, 9)), 0);
  assert.equal(completedMonths(at(2026, 1, 10), at(2026, 2, 10)), 1);
  assert.equal(completedMonths(at(2025, 11, 10), at(2026, 1, 10)), 2);
});

test("a start on the 31st reaches a short month on its last day", () => {
  assert.equal(completedMonths(at(2026, 1, 31), at(2026, 2, 27)), 0);
  assert.equal(completedMonths(at(2026, 1, 31), at(2026, 2, 28)), 1);
  assert.equal(completedMonths(at(2026, 1, 31), at(2026, 3, 31)), 2);
});

test("each level starts at its month and lasts until the next", () => {
  const start = at(2024, 1, 15);
  const after = (months: number) => Date.UTC(2024, months, 15, 12);
  assert.equal(proBadgeLevel(start, start), 0);
  assert.equal(proBadgeLevel(start, after(1)), 0);
  PRO_BADGE_MONTHS.forEach((months, level) => {
    assert.equal(proBadgeLevel(start, after(months)), level, `${months} months`);
  });
  assert.equal(proBadgeLevel(start, after(11)), 5);
  assert.equal(proBadgeLevel(start, after(23)), 6);
  assert.equal(proBadgeLevel(start, after(60)), 7);
});

test("no streak on file reads as the first level", () => {
  assert.equal(proBadgeLevel(null, at(2026, 1, 1)), 0);
  assert.equal(proBadgeLevel(undefined, at(2026, 1, 1)), 0);
});

test("every level draws a different mark, and each plan its own colour", () => {
  const icons = PRO_BADGE_MONTHS.map((_, level) => withProBadgeLevel(badge("pro"), level).iconUrl);
  assert.equal(new Set(icons).size, PRO_BADGE_MONTHS.length);
  assert.ok(decodeURIComponent(withPlanTheme(badge("pro")).iconUrl).includes("#3b82f6"));
  assert.ok(decodeURIComponent(withPlanTheme(badge("pro_max")).iconUrl).includes("#f59e0b"));
  assert.ok(decodeURIComponent(withPlanTheme(badge("pro_ultra")).iconUrl).includes("#f43f5e"));
});

test("a stale catalogue row is repainted, and other badges are left alone", () => {
  assert.notEqual(withPlanTheme(badge("pro")).chipClass, "stale");
  assert.equal(withPlanTheme(badge("staff")).iconUrl, "stale");
  assert.equal(withProBadgeLevel(badge("staff"), 3).iconUrl, "stale");
});
