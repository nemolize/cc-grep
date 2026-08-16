import { expect, test } from "vitest";

import { HELP, parseArgs } from "../src/args.js";

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
  expect(parse(["--help", "--nope"]).kind).toBe("help");
  expect(parse(["--version", "--help"]).kind).toBe("version");
  expect(parse(["-hV"]).kind).toBe("help");
  expect(parse(["-Vh"]).kind).toBe("version");
  expect(parse(["-eV", "--nope"]).kind).toBe("version");
  expect(parse(["-hC"]).kind).toBe("help");
  expect(parse(["p", "-Ch"])).toEqual({
    kind: "error",
    message: '--context must be an integer in [0, 10000] (got "h")',
  });
});

test("help documents dash-prefixed option values", () => {
  expect(HELP).toContain("--option=value");
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
  const result = parse(["p", `${flag}=false`]);
  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    expect(result.message).toContain("does not take an argument");
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

test("--since after --until errors", () => {
  expect(parse(["p", "--since", "1d", "--until", "2d"])).toEqual({
    kind: "error",
    message: "--since must not be after --until",
  });
});

test("--context must be an integer in [0, 10000]", () => {
  expect(parse(["p", "--context="])).toEqual({
    kind: "error",
    message: '--context must be an integer in [0, 10000] (got "")',
  });
  expect(parse(["p", "--context=-1"])).toEqual({
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
  const result = parse(["p", option, "--json"]);
  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    expect(result.message).toContain("argument is ambiguous");
  }
});

test.each([
  ["--root", "-"],
  ["--cwd", "-generated"],
  ["--branch", "-wip"],
])("%s accepts an inline dash-prefixed value", (option, value) => {
  const result = parse(["p", `${option}=${value}`]);
  expect(result.kind).toBe("options");
  if (result.kind === "options") {
    expect(result.options[option.slice(2)]).toBe(value);
  }
});

test("grouped short boolean flags are supported", () => {
  const result = parse(["p", "-eFi"]);
  expect(result.kind).toBe("options");
  if (result.kind === "options") {
    expect(result.options.regex).toBe(true);
    expect(result.options.fixed).toBe(true);
    expect(result.options.ignoreCase).toBe(true);
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

test("--session makes the pattern optional", () => {
  const r = parse(["--session", "abc123"]);
  expect(r.kind).toBe("options");
  if (r.kind === "options") {
    expect(r.options.session).toBe("abc123");
    expect(r.options.pattern).toBe(undefined);
  }
});

test("--subagents is unset by default, leaving each surface its own default", () => {
  const r = parse(["--session", "abc123"]);
  if (r.kind === "options") expect(r.options.subagents).toBe(undefined);
});

test("--subagents accepts each scope", () => {
  for (const scope of ["include", "exclude", "only"]) {
    const r = parse(["needle", "--subagents", scope]);
    expect(r.kind).toBe("options");
    if (r.kind === "options") expect(r.options.subagents).toBe(scope);
  }
});

test("--subagents rejects an unknown scope", () => {
  const r = parse(["needle", "--subagents", "both"]);
  expect(r.kind).toBe("error");
  if (r.kind === "error") expect(r.message).toMatch(/include\|exclude\|only/);
});

test("--include-subagents still maps to the include scope", () => {
  const r = parse(["--session", "abc123", "--include-subagents"]);
  if (r.kind === "options") expect(r.options.subagents).toBe("include");
});

test("--subagents and --include-subagents cannot be combined", () => {
  const r = parse(["needle", "--subagents", "only", "--include-subagents"]);
  expect(r.kind).toBe("error");
});

test("help documents --subagents", () => {
  expect(HELP).toMatch(/--subagents <include\|exclude\|only>/);
});

test("--session accepts a pattern alongside it", () => {
  const r = parse(["--session", "abc123", "needle"]);
  if (r.kind === "options") {
    expect(r.options.session).toBe("abc123");
    expect(r.options.pattern).toBe("needle");
  }
});

test("--session with an empty value errors", () => {
  expect(parse(["--session="]).kind).toBe("error");
});

test("session is undefined without --session", () => {
  const r = parse(["p"]);
  if (r.kind === "options") expect(r.options.session).toBe(undefined);
});

test("help documents --session", () => {
  expect(HELP).toMatch(/--session <id>/);
});
