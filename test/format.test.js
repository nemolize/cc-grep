import { expect, test } from "vitest";

import {
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
