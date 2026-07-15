import { expect, test } from "vitest";

import { passesFilters } from "../src/filters.js";

function turn(over) {
  return {
    file: "/x.jsonl",
    lineIndex: 0,
    role: "user",
    isMeta: false,
    textLines: ["hi"],
    ...over,
  };
}

function opts(over) {
  return {
    pattern: "x",
    regex: false,
    fixed: false,
    ignoreCase: false,
    root: "/tmp",
    role: "any",
    includeMeta: false,
    context: 2,
    resume: false,
    printResume: false,
    json: false,
    color: "never",
    ...over,
  };
}

test("role filter", () => {
  expect(passesFilters(turn({ role: "user" }), opts({ role: "user" }))).toBe(
    true,
  );
  expect(
    passesFilters(turn({ role: "assistant" }), opts({ role: "user" })),
  ).toBe(false);
  expect(
    passesFilters(turn({ role: "assistant" }), opts({ role: "any" })),
  ).toBe(true);
});

test("meta excluded by default, included with flag", () => {
  expect(passesFilters(turn({ isMeta: true }), opts({}))).toBe(false);
  expect(
    passesFilters(turn({ isMeta: true }), opts({ includeMeta: true })),
  ).toBe(true);
});

test("since/until time window", () => {
  const t = turn({ timestampMs: Date.parse("2026-07-10T00:00:00Z") });
  expect(
    passesFilters(t, opts({ sinceMs: Date.parse("2026-07-01T00:00:00Z") })),
  ).toBe(true);
  expect(
    passesFilters(t, opts({ sinceMs: Date.parse("2026-07-12T00:00:00Z") })),
  ).toBe(false);
  expect(
    passesFilters(t, opts({ untilMs: Date.parse("2026-07-12T00:00:00Z") })),
  ).toBe(true);
  expect(
    passesFilters(t, opts({ untilMs: Date.parse("2026-07-01T00:00:00Z") })),
  ).toBe(false);
});

test("turns without a timestamp are excluded when a time filter is active", () => {
  const t = turn({ timestampMs: undefined });
  expect(passesFilters(t, opts({ sinceMs: Date.now() }))).toBe(false);
  expect(passesFilters(t, opts({ untilMs: Date.now() }))).toBe(false);
  expect(passesFilters(t, opts({}))).toBe(true);
});

test("cwd substring; unknown cwd excluded when filter active", () => {
  expect(
    passesFilters(turn({ cwd: "/home/proj-a" }), opts({ cwd: "proj-a" })),
  ).toBe(true);
  expect(
    passesFilters(turn({ cwd: "/home/proj-b" }), opts({ cwd: "proj-a" })),
  ).toBe(false);
  expect(passesFilters(turn({ cwd: undefined }), opts({ cwd: "proj-a" }))).toBe(
    false,
  );
});

test("branch substring; unknown branch excluded when filter active", () => {
  expect(
    passesFilters(turn({ gitBranch: "feat/x" }), opts({ branch: "feat" })),
  ).toBe(true);
  expect(
    passesFilters(turn({ gitBranch: undefined }), opts({ branch: "feat" })),
  ).toBe(false);
});
