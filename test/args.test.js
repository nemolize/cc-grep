import { expect, test } from "vitest";

import { parseArgs } from "../src/args.js";

const HOME = "/home/u";
const ENV = {};
const NOW = Date.parse("2026-07-14T00:00:00Z");

function parse(argv, env = ENV) {
  return parseArgs(argv, env, HOME, NOW);
}

test("pattern is the first non-flag argument", () => {
  const r = parse(["hello"]);
  expect(r.kind).toBe("options");
  if (r.kind === "options") expect(r.options.pattern).toBe("hello");
});

test("missing pattern errors", () => {
  const r = parse([]);
  expect(r.kind).toBe("error");
});

test("help and version", () => {
  expect(parse(["-h"]).kind).toBe("help");
  expect(parse(["--help"]).kind).toBe("help");
  expect(parse(["-V"]).kind).toBe("version");
});

test("boolean flags", () => {
  const r = parse(["p", "--regex", "-i", "--include-meta", "--json"]);
  expect(r.kind).toBe("options");
  if (r.kind === "options") {
    expect(r.options.regex).toBe(true);
    expect(r.options.ignoreCase).toBe(true);
    expect(r.options.includeMeta).toBe(true);
    expect(r.options.json).toBe(true);
  }
});

test.each([
  "--help",
  "--version",
  "--regex",
  "--fixed",
  "--ignore-case",
  "--include-meta",
  "--resume",
  "--print-resume",
  "--json",
])("%s rejects an inline value", (flag) => {
  expect(parse(["p", `${flag}=false`])).toEqual({
    kind: "error",
    message: `option ${flag} does not take a value`,
  });
});

test("--key=value form", () => {
  const r = parse(["p", "--role=assistant", "--context=5"]);
  expect(r.kind).toBe("options");
  if (r.kind === "options") {
    expect(r.options.role).toBe("assistant");
    expect(r.options.context).toBe(5);
  }
});

test("--role validation", () => {
  expect(parse(["p", "--role", "bogus"]).kind).toBe("error");
  const r = parse(["p", "--role", "user"]);
  if (r.kind === "options") expect(r.options.role).toBe("user");
});

test("--since relative duration", () => {
  const r = parse(["p", "--since", "7d"]);
  if (r.kind === "options")
    expect(r.options.sinceMs).toBe(NOW - 7 * 86_400_000);
});

test("--since after --until errors", () => {
  expect(parse(["p", "--since", "1d", "--until", "2d"])).toEqual({
    kind: "error",
    message: "--since must not be after --until",
  });
});

test("--context must be an integer in [0, 10000]", () => {
  expect(parse(["p", "--context", "-1"])).toEqual({
    kind: "error",
    message: '--context must be an integer in [0, 10000] (got "-1")',
  });
  expect(parse(["p", "--context", "x"]).kind).toBe("error");
  expect(parse(["p", "--context", "10001"]).kind).toBe("error");
  expect(parse(["p", "-C", "0"]).kind).toBe("options");
  expect(parse(["p", "-C", "10000"]).kind).toBe("options");
});

test("--color validation", () => {
  expect(parse(["p", "--color", "bogus"]).kind).toBe("error");
  const r = parse(["p", "--color", "never"]);
  if (r.kind === "options") expect(r.options.color).toBe("never");
});

test("unknown option errors", () => {
  expect(parse(["p", "--nope"]).kind).toBe("error");
});

test("-- stops flag parsing so a dash-leading pattern works", () => {
  const r = parse(["--", "--looks-like-flag"]);
  expect(r.kind).toBe("options");
  if (r.kind === "options") expect(r.options.pattern).toBe("--looks-like-flag");
});

test("missing value for a value-taking option errors", () => {
  expect(parse(["p", "--root"]).kind).toBe("error");
});

test.each([
  "--root",
  "--role",
  "--since",
  "--until",
  "--cwd",
  "--branch",
  "-C",
  "--context",
  "--color",
])("%s does not consume the next flag as its value", (option) => {
  expect(parse(["p", option, "--json"])).toEqual({
    kind: "error",
    message: `option ${option} requires a value`,
  });
});

test.each([
  ["--root", "-"],
  ["--cwd", "-generated"],
  ["--branch", "-wip"],
])("%s accepts a separated dash-prefixed value", (option, value) => {
  const result = parse(["p", option, value]);
  expect(result.kind).toBe("options");
  if (result.kind === "options") {
    expect(result.options[option.slice(2)]).toBe(value);
  }
});

test("extra positional argument errors", () => {
  expect(parse(["a", "b"]).kind).toBe("error");
});

test("CC_GREP_ROOT overrides default root", () => {
  const r = parse(["p"], { CC_GREP_ROOT: "/custom" });
  if (r.kind === "options") expect(r.options.root).toBe("/custom");
});

test("default root falls back to ~/.claude/projects", () => {
  const r = parse(["p"]);
  if (r.kind === "options")
    expect(r.options.root).toBe("/home/u/.claude/projects");
});

test("--root explicit beats env", () => {
  const r = parse(["p", "--root", "/explicit"], { CC_GREP_ROOT: "/env" });
  if (r.kind === "options") expect(r.options.root).toBe("/explicit");
});
