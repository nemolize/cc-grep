import { expect, test } from "vitest";

import { parseSinceUntil } from "../src/duration.js";

const NOW = Date.parse("2026-07-14T00:00:00Z");

test("relative durations subtract from now (boundary ignored)", () => {
  expect(parseSinceUntil("7d", "since", NOW)).toBe(NOW - 7 * 86_400_000);
  expect(parseSinceUntil("7d", "until", NOW)).toBe(NOW - 7 * 86_400_000);
  expect(parseSinceUntil("2h", "since", NOW)).toBe(NOW - 2 * 3_600_000);
  expect(parseSinceUntil("30m", "since", NOW)).toBe(NOW - 30 * 60_000);
  expect(parseSinceUntil("1w", "since", NOW)).toBe(NOW - 7 * 86_400_000);
});

test("whitespace tolerated in relative durations", () => {
  expect(parseSinceUntil(" 7d ", "since", NOW)).toBe(NOW - 7 * 86_400_000);
});

test("date-only values anchor to a UTC day boundary per side", () => {
  const startOfDay = Date.parse("2026-06-01T00:00:00Z");
  expect(parseSinceUntil("2026-06-01", "since", NOW)).toBe(startOfDay);
  expect(parseSinceUntil("2026-06-01", "until", NOW)).toBe(
    startOfDay + 86_400_000 - 1,
  );
});

test("full datetime values pass through unchanged for both sides", () => {
  const ts = Date.parse("2026-06-01T12:34:56Z");
  expect(parseSinceUntil("2026-06-01T12:34:56Z", "since", NOW)).toBe(ts);
  expect(parseSinceUntil("2026-06-01T12:34:56Z", "until", NOW)).toBe(ts);
});

test("invalid values throw with a helpful message", () => {
  expect(() => parseSinceUntil("nope", "since", NOW)).toThrow(
    /invalid time value/,
  );
  expect(() => parseSinceUntil("7x", "since", NOW)).toThrow(
    /invalid time value/,
  );
});
