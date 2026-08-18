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
    toolCalls: [],
    ...over,
  };
}

function call(name, ...paths) {
  return { name, paths };
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

test("--tool keeps turns calling any of the named tools", () => {
  const edited = turn({ toolCalls: [call("Edit", "/a.ts")] });
  const read = turn({ toolCalls: [call("Read", "/a.ts")] });
  expect(passesFilters(edited, opts({ tools: ["Edit", "Write"] }))).toBe(true);
  expect(passesFilters(read, opts({ tools: ["Edit", "Write"] }))).toBe(false);
});

test("--tool matches regardless of casing", () => {
  const edited = turn({ toolCalls: [call("Edit", "/a.ts")] });
  expect(passesFilters(edited, opts({ tools: ["edit"] }))).toBe(true);
  expect(passesFilters(edited, opts({ tools: ["EDIT"] }))).toBe(true);
});

test("a turn with no tool calls fails an active --tool", () => {
  expect(passesFilters(turn({}), opts({ tools: ["Edit"] }))).toBe(false);
});

test("--file matches a path substring on a tool call", () => {
  const t = turn({ toolCalls: [call("Edit", "/home/u/proj/src/format.ts")] });
  expect(passesFilters(t, opts({ file: "src/format.ts" }))).toBe(true);
  expect(passesFilters(t, opts({ file: "src/loader.ts" }))).toBe(false);
});

test("--file ignores a path that is only mentioned in prose", () => {
  const t = turn({
    textLines: ["let's edit src/format.ts next"],
    toolCalls: [],
  });
  expect(passesFilters(t, opts({ file: "src/format.ts" }))).toBe(false);
});

test("--file ignores a non-path field carrying the same substring", () => {
  const t = turn({ toolCalls: [call("Grep")] });
  expect(passesFilters(t, opts({ file: "src/format.ts" }))).toBe(false);
});

test("--tool and --file must hold on the same call", () => {
  // Read the target, edit something else — not "the session that edited it".
  const split = turn({
    toolCalls: [call("Read", "/a/target.ts"), call("Edit", "/a/other.ts")],
  });
  expect(
    passesFilters(split, opts({ tools: ["Edit"], file: "target.ts" })),
  ).toBe(false);

  const edited = turn({
    toolCalls: [call("Read", "/a/other.ts"), call("Edit", "/a/target.ts")],
  });
  expect(
    passesFilters(edited, opts({ tools: ["Edit"], file: "target.ts" })),
  ).toBe(true);
});
