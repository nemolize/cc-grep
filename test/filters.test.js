import { expect, test } from "vitest";

import { passesFilters } from "../src/filters.js";

function turn(over) {
  return {
    file: "/x.jsonl",
    lineIndex: 0,
    role: "user",
    isMeta: false,
    isSidechain: false,
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

test("session matches on a prefix, not a substring", () => {
  const t = turn({ sessionId: "abcdef12-3456" });
  expect(passesFilters(t, opts({ session: "abcdef12" }))).toBe(true);
  expect(passesFilters(t, opts({ session: "abcdef12-3456" }))).toBe(true);
  expect(passesFilters(t, opts({ session: "def12" }))).toBe(false);
  expect(passesFilters(t, opts({ session: "abcdef13" }))).toBe(false);
});

test("unknown session id excluded when --session is active", () => {
  expect(
    passesFilters(turn({ sessionId: undefined }), opts({ session: "abc" })),
  ).toBe(false);
});

test("a dump excludes sidechain turns, --subagents=include keeps them", () => {
  const sub = turn({ sessionId: "abc", isSidechain: true });
  expect(passesFilters(sub, opts({ session: "abc" }))).toBe(false);
  expect(
    passesFilters(sub, opts({ session: "abc", subagents: "include" })),
  ).toBe(true);
});

test("--subagents=exclude drops sidechain turns from a search", () => {
  const sub = turn({ isSidechain: true });
  const main = turn({ isSidechain: false });
  expect(passesFilters(sub, opts({ subagents: "exclude" }))).toBe(false);
  expect(passesFilters(main, opts({ subagents: "exclude" }))).toBe(true);
});

test("--subagents=only keeps just sidechain turns", () => {
  const sub = turn({ isSidechain: true });
  const main = turn({ isSidechain: false });
  expect(passesFilters(sub, opts({ subagents: "only" }))).toBe(true);
  expect(passesFilters(main, opts({ subagents: "only" }))).toBe(false);
});

test("--subagents=only overrides the dump's exclude default", () => {
  const sub = turn({ sessionId: "abc", isSidechain: true });
  const main = turn({ sessionId: "abc", isSidechain: false });
  expect(passesFilters(sub, opts({ session: "abc", subagents: "only" }))).toBe(
    true,
  );
  expect(passesFilters(main, opts({ session: "abc", subagents: "only" }))).toBe(
    false,
  );
});

test("plain search keeps sidechain turns (only a dump excludes them)", () => {
  const sub = turn({ sessionId: "abc", isSidechain: true });
  expect(passesFilters(sub, opts({}))).toBe(true);
});
