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

test("--context must be a non-negative integer", () => {
  expect(parse(["p", "--context", "-1"]).kind).toBe("error");
  expect(parse(["p", "--context", "x"]).kind).toBe("error");
  expect(parse(["p", "-C", "0"]).kind).toBe("options");
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
