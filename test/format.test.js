import { expect, test } from "vitest";

import {
  formatDumpBanner,
  formatDumpTurn,
  formatHit,
  formatHitJson,
  formatTimestamp,
  resumeCommand,
  shortenPath,
  shouldColor,
} from "../src/format.js";

test("shortenPath collapses home to ~", () => {
  expect(shortenPath("/home/u/proj", "/home/u")).toBe("~/proj");
  expect(shortenPath("/home/u", "/home/u")).toBe("~");
  expect(shortenPath("/other/path", "/home/u")).toBe("/other/path");
  expect(shortenPath(undefined, "/home/u")).toBe("?");
});

test("shortenPath does not collapse a home-prefix that is not a boundary", () => {
  expect(shortenPath("/home/username", "/home/u")).toBe("/home/username");
});

test("shouldColor honors mode then TTY", () => {
  expect(shouldColor("always", false)).toBe(true);
  expect(shouldColor("never", true)).toBe(false);
  expect(shouldColor("auto", true)).toBe(true);
  expect(shouldColor("auto", false)).toBe(false);
});

test("formatTimestamp handles missing value", () => {
  expect(formatTimestamp(undefined)).toBe("?");
});

function hit() {
  return {
    turn: {
      file: "/x.jsonl",
      lineIndex: 3,
      role: "user",
      sessionId: "abcdef12-3456",
      timestamp: "2026-07-10T21:34:00Z",
      timestampMs: Date.parse("2026-07-10T21:34:00Z"),
      cwd: "/home/u/proj",
      gitBranch: "main",
      isMeta: false,
      textLines: ["line0", "match here", "line2"],
    },
    matchedLineIndices: [1],
  };
}

test("formatHitJson round-trips through JSON.parse", () => {
  const line = formatHitJson(hit(), "/home/u");
  const obj = JSON.parse(line);
  expect(obj.role).toBe("user");
  expect(obj.cwdShort).toBe("~/proj");
  expect(obj.sessionId).toBe("abcdef12-3456");
  expect(obj.matchedLines).toEqual(["match here"]);
});

test("resumeCommand builds the claude --resume line", () => {
  expect(resumeCommand(hit())).toBe("claude --resume abcdef12-3456");
});

test("resumeCommand is undefined without a session id", () => {
  const h = hit();
  h.turn.sessionId = undefined;
  expect(resumeCommand(h)).toBe(undefined);
});

const opts = { context: 2, pattern: "x", regex: false, fixed: true };

test("a tool header out of context range is pulled in", () => {
  const h = hit();
  h.turn.textLines = [
    "⚙ Bash",
    "command: line a",
    "b",
    "c",
    "d",
    "deep match",
    "e",
  ];
  h.matchedLineIndices = [5];
  const out = formatHit(
    h,
    { ...opts, pattern: "deep match" },
    "/home/u",
    false,
  );
  expect(out).toMatch(/⚙ Bash/);
});

test("dump banner carries session, cwd and branch once", () => {
  const out = formatDumpBanner(hit().turn, "/home/u", false);
  expect(out).toBe("session abcdef12-3456  ~/proj  (main)");
});

test("dump banner omits the branch when unknown", () => {
  const t = hit().turn;
  t.gitBranch = undefined;
  expect(formatDumpBanner(t, "/home/u", false)).toBe(
    "session abcdef12-3456  ~/proj",
  );
});

test("dump turn prints every line, not just the matched window", () => {
  const h = hit();
  h.turn.textLines = ["a", "b", "c", "d", "e", "f", "g"];
  h.matchedLineIndices = [3];
  const out = formatDumpTurn(h, { ...opts, context: 0, pattern: "d" }, false);
  const lines = out.split("\n");
  // Header timestamp renders in local time, so assert its shape, not a literal.
  expect(lines[0]).toMatch(/^user {2}\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  expect(lines.slice(1)).toEqual([
    "  │ a",
    "  │ b",
    "  │ c",
    "  │ >> d",
    "  │ e",
    "  │ f",
    "  │ g",
  ]);
});

test("dump turn highlights only the matched line, by index", () => {
  const h = hit();
  h.turn.textLines = ["dup", "dup"];
  h.matchedLineIndices = [1];
  const out = formatDumpTurn(h, { ...opts, pattern: "dup" }, true);
  const lines = out.split("\n");
  expect(lines[1]).toBe("  │ dup");
  expect(lines[2]).toContain("\x1b[1;31m");
});

test("a patternless dump highlights nothing and marks nothing", () => {
  const h = hit();
  h.turn.textLines = ["a", "b"];
  h.matchedLineIndices = [0, 1];
  const out = formatDumpTurn(h, { ...opts, pattern: undefined }, true);
  expect(out).not.toContain("\x1b[1;31m");
  expect(out).not.toContain(">>");
});

test("a dump marks matched lines with >> so color-never keeps the signal", () => {
  const h = hit();
  h.turn.textLines = ["a", "match", "b"];
  h.matchedLineIndices = [1];
  const out = formatDumpTurn(h, { ...opts, pattern: "match" }, false);
  expect(out.split("\n").slice(1)).toEqual(["  │ a", "  │ >> match", "  │ b"]);
});

test("prose does not borrow an earlier call's tool header", () => {
  const h = hit();
  h.turn.textLines = ["⚙ Bash", "command: ls", "", "prose match", "tail"];
  h.matchedLineIndices = [3];
  const out = formatHit(
    h,
    { ...opts, pattern: "prose match" },
    "/home/u",
    false,
  );
  expect(out).not.toMatch(/⚙ Bash/);
});
