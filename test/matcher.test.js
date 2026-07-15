import { expect, test } from "vitest";

import { buildMatcher } from "../src/matcher.js";

function opts(over) {
  return {
    pattern: "",
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

test("substring match by default", () => {
  const m = buildMatcher(opts({ pattern: "cat" }));
  expect(m.test("concatenate")).toBe(true);
  expect(m.test("dog")).toBe(false);
});

test("regex-special chars are literal by default", () => {
  const m = buildMatcher(opts({ pattern: "a.b" }));
  expect(m.test("a.b")).toBe(true);
  expect(m.test("axb")).toBe(false);
});

test("--regex enables regex semantics", () => {
  const m = buildMatcher(opts({ pattern: "a.b", regex: true }));
  expect(m.test("axb")).toBe(true);
});

test("--fixed overrides --regex", () => {
  const m = buildMatcher(opts({ pattern: "a.b", regex: true, fixed: true }));
  expect(m.test("axb")).toBe(false);
  expect(m.test("a.b")).toBe(true);
});

test("--ignore-case", () => {
  const m = buildMatcher(opts({ pattern: "Hello", ignoreCase: true }));
  expect(m.test("say hello there")).toBe(true);
});

test("ranges returns match spans for highlighting", () => {
  const m = buildMatcher(opts({ pattern: "ab" }));
  expect(m.ranges("ab_ab")).toEqual([
    [0, 2],
    [3, 5],
  ]);
});

test("invalid regex throws a clear error", () => {
  expect(() => buildMatcher(opts({ pattern: "(", regex: true }))).toThrow(
    /invalid regular expression/,
  );
});

test("test() is stateless across calls (global flag lastIndex reset)", () => {
  const m = buildMatcher(opts({ pattern: "x", regex: true }));
  expect(m.test("x")).toBe(true);
  expect(m.test("x")).toBe(true);
  expect(m.test("x")).toBe(true);
});

test("zero-width regex match does not loop forever", () => {
  const m = buildMatcher(opts({ pattern: "a*", regex: true }));
  const ranges = m.ranges("bab");
  expect(ranges.length > 0).toBeTruthy();
});
