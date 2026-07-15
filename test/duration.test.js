import { expect, test } from "vitest";

import { parseSinceUntil } from "../src/duration.js";

const NOW = Date.parse("2026-07-14T00:00:00Z");

test("relative durations subtract from now", () => {
  expect(parseSinceUntil("7d", NOW)).toBe(NOW - 7 * 86_400_000);
  expect(parseSinceUntil("2h", NOW)).toBe(NOW - 2 * 3_600_000);
  expect(parseSinceUntil("30m", NOW)).toBe(NOW - 30 * 60_000);
  expect(parseSinceUntil("1w", NOW)).toBe(NOW - 7 * 86_400_000);
});

test("whitespace tolerated in relative durations", () => {
  expect(parseSinceUntil(" 7d ", NOW)).toBe(NOW - 7 * 86_400_000);
});

test("absolute dates parse via Date", () => {
  expect(parseSinceUntil("2026-06-01", NOW)).toBe(Date.parse("2026-06-01"));
});

test("invalid values throw with a helpful message", () => {
  expect(() => parseSinceUntil("nope", NOW)).toThrow(/invalid time value/);
  expect(() => parseSinceUntil("7x", NOW)).toThrow(/invalid time value/);
});
