import { expect, test } from "vitest";

import { buildPrefilter, longestRawSafeRun } from "../src/prefilter.js";

function opts(overrides) {
  return {
    regex: false,
    fixed: false,
    root: "/root",
    role: "any",
    includeMeta: false,
    context: 2,
    resume: false,
    printResume: false,
    json: false,
    color: "auto",
    ignoreCase: false,
    ...overrides,
  };
}

test("longestRawSafeRun keeps only characters that survive JSON encoding", () => {
  expect(longestRawSafeRun("ratatui")).toBe("ratatui");
  expect(longestRawSafeRun('say "hello" now')).toBe("hello");
  expect(longestRawSafeRun("src/loader.ts")).toBe("loader.ts");
  expect(longestRawSafeRun("a\\nb")).toBe("nb");
});

test("longestRawSafeRun drops separators textExtract synthesises", () => {
  expect(longestRawSafeRun("file_path: /a")).toBe("file_path");
  expect(longestRawSafeRun("{name: x}")).toBe("name");
  expect(longestRawSafeRun("alpha, beta")).toBe("alpha");
  expect(longestRawSafeRun("[one]")).toBe("one");
});

test("longestRawSafeRun drops non-ascii, which JSON may \\u-escape", () => {
  expect(longestRawSafeRun("ワークツリー")).toBe("");
  expect(longestRawSafeRun("worktree の branch")).toBe("worktree");
});

test("a literal pattern prefilters on the pattern itself", () => {
  const pf = buildPrefilter(opts({ pattern: "ratatui" }));
  expect(pf.test('{"text":"uses ratatui here"}')).toBe(true);
  expect(pf.test('{"text":"nothing to see"}')).toBe(false);
});

test("case-insensitive prefilter folds case without missing a hit", () => {
  const pf = buildPrefilter(opts({ pattern: "RataTui", ignoreCase: true }));
  expect(pf.test('{"text":"RATATUI"}')).toBe(true);
  expect(pf.test('{"text":"ratatui"}')).toBe(true);
  expect(pf.test('{"text":"other"}')).toBe(false);
});

test("case-sensitive prefilter does not fold case", () => {
  const pf = buildPrefilter(opts({ pattern: "Ratatui" }));
  expect(pf.test('{"text":"Ratatui"}')).toBe(true);
  expect(pf.test('{"text":"ratatui"}')).toBe(false);
});

test("no pattern accepts every line", () => {
  const pf = buildPrefilter(opts({ session: "abc" }));
  expect(pf.test("{}")).toBe(true);
  expect(pf.test('{"anything":1}')).toBe(true);
});

test("a pattern with no usable literal accepts every line", () => {
  const pf = buildPrefilter(
    opts({ pattern: "ワークツリー", ignoreCase: true }),
  );
  expect(pf.test('{"text":"unrelated"}')).toBe(true);
});

test("a pattern shorter than the minimum accepts every line", () => {
  const pf = buildPrefilter(opts({ pattern: "ab" }));
  expect(pf.test('{"text":"unrelated"}')).toBe(true);
});

test("a regex with metacharacters accepts every line", () => {
  const pf = buildPrefilter(opts({ pattern: "rata.ui", regex: true }));
  expect(pf.test('{"text":"unrelated"}')).toBe(true);
});

test("--fixed makes a metacharacter pattern prefilterable again", () => {
  const pf = buildPrefilter(
    opts({ pattern: "rata.ui", regex: true, fixed: true }),
  );
  expect(pf.test('{"text":"rata.ui"}')).toBe(true);
  expect(pf.test('{"text":"ratatui"}')).toBe(false);
});

test("a metacharacter-free regex still prefilters", () => {
  const pf = buildPrefilter(opts({ pattern: "ratatui", regex: true }));
  expect(pf.test('{"text":"ratatui"}')).toBe(true);
  expect(pf.test('{"text":"unrelated"}')).toBe(false);
});

test("the literal is matched literally, not as a regex", () => {
  const pf = buildPrefilter(
    opts({ pattern: "rata.ui", fixed: true, ignoreCase: true }),
  );
  expect(pf.test('{"text":"ratatui"}')).toBe(false);
  expect(pf.test('{"text":"RATA.UI"}')).toBe(true);
});

test("a pattern spanning an escape prefilters on its longest safe run", () => {
  const pf = buildPrefilter(opts({ pattern: 'the "quoted" word' }));
  expect(pf.test('{"text":"the \\"quoted\\" word"}')).toBe(true);
  expect(pf.test('{"text":"the word"}')).toBe(false);
});

// An HTML-escaping serialiser writes ">" as >, so a raw scan for ">"
// misses a line the matcher matches. Real corpora carry this form.
test("a line carrying a unicode escape is never rejected", () => {
  const BS = String.fromCharCode(92);
  const escaped = `{"text":"version ${BS}u003e=8.0.15 required"}`;
  expect(JSON.parse(escaped).text).toBe("version >=8.0.15 required");

  for (const over of [{}, { ignoreCase: true }]) {
    const pf = buildPrefilter(opts({ pattern: ">=8.0.15", ...over }));
    expect(pf.test(escaped)).toBe(true);
  }
});

test("the unicode-escape fallback does not accept every line", () => {
  const pf = buildPrefilter(opts({ pattern: "ratatui" }));
  expect(pf.test('{"text":"no escapes and no match"}')).toBe(false);
});
