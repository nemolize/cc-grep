import { expect, test } from "vitest";

import {
  formatDumpBanner,
  formatDumpTurn,
  formatHit,
  formatHitJson,
  formatSessionLine,
  formatTimestamp,
  resumeCommand,
  shortenPath,
  shouldColor,
  SUBAGENT_MARK,
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

function hit(over) {
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
      isSidechain: false,
      textLines: ["line0", "match here", "line2"],
      toolCalls: [],
      ...over,
    },
    matchedLineIndices: [1],
  };
}

/** A pattern search — the shape that populates `matchedLines`. */
const jsonOpts = { pattern: "x" };

test("formatHitJson round-trips through JSON.parse", () => {
  const line = formatHitJson(hit(), jsonOpts, "/home/u");
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

test("formatHitJson carries the turn's tool calls", () => {
  const h = hit();
  h.turn.toolCalls = [{ name: "Edit", paths: ["/a.ts"] }];
  expect(JSON.parse(formatHitJson(h, jsonOpts, "/home/u")).toolCalls).toEqual([
    { name: "Edit", paths: ["/a.ts"] },
  ]);
});

test("a patternless search sends no matchedLines, only the attribution", () => {
  const h = hit();
  h.turn.toolCalls = [{ name: "Edit", paths: ["/a.ts"] }];
  h.matchedLineIndices = [0, 1, 2];
  const obj = JSON.parse(
    formatHitJson(h, { pattern: undefined, tools: ["Edit"] }, "/home/u"),
  );
  expect(obj.matchedLines).toEqual([]);
  expect(obj.toolCalls).toEqual([{ name: "Edit", paths: ["/a.ts"] }]);
});

test("a patternless dump still sends the turn's lines", () => {
  const h = hit();
  h.matchedLineIndices = [0, 1, 2];
  const obj = JSON.parse(
    formatHitJson(h, { pattern: undefined, session: "abcdef12" }, "/home/u"),
  );
  expect(obj.matchedLines).toEqual(["line0", "match here", "line2"]);
});

test("formatHitJson omits toolCalls when the turn called nothing", () => {
  expect(
    JSON.parse(formatHitJson(hit(), jsonOpts, "/home/u")),
  ).not.toHaveProperty("toolCalls");
});

const opts = { context: 2, pattern: "x", regex: false, fixed: true };

test("a --tool run names the tool and its path on the header", () => {
  const h = hit();
  h.turn.toolCalls = [{ name: "Edit", paths: ["/home/u/proj/src/a.ts"] }];
  const header = formatHit(
    h,
    { ...opts, tools: ["Edit"] },
    "/home/u",
    false,
  ).split("\n")[0];
  expect(header).toContain("[Edit ~/proj/src/a.ts]");
});

test("the header names only the calls the filters selected", () => {
  const h = hit();
  h.turn.toolCalls = [
    { name: "Read", paths: ["/home/u/proj/a.ts"] },
    { name: "Edit", paths: ["/home/u/proj/b.ts"] },
  ];
  const header = formatHit(
    h,
    { ...opts, tools: ["Edit"] },
    "/home/u",
    false,
  ).split("\n")[0];
  expect(header).toContain("[Edit ~/proj/b.ts]");
  expect(header).not.toContain("Read");
});

test("a pathless tool call still names the tool", () => {
  const h = hit();
  h.turn.toolCalls = [{ name: "Bash", paths: [] }];
  const header = formatHit(
    h,
    { ...opts, tools: ["Bash"] },
    "/home/u",
    false,
  ).split("\n")[0];
  expect(header).toContain("[Bash]");
});

test("--file narrows a multi-path call to the paths it asked about", () => {
  const h = hit();
  h.turn.toolCalls = [
    { name: "Edit", paths: ["/home/u/proj/a.ts", "/home/u/proj/b.ts"] },
  ];
  const header = formatHit(
    h,
    { ...opts, file: "b.ts" },
    "/home/u",
    false,
  ).split("\n")[0];
  expect(header).toContain("[Edit ~/proj/b.ts]");
  expect(header).not.toContain("a.ts");
});

test("without --file every path on the call is named", () => {
  const h = hit();
  h.turn.toolCalls = [
    { name: "Edit", paths: ["/home/u/proj/a.ts", "/home/u/proj/b.ts"] },
  ];
  const header = formatHit(
    h,
    { ...opts, tools: ["Edit"] },
    "/home/u",
    false,
  ).split("\n")[0];
  expect(header).toContain("[Edit ~/proj/a.ts]");
  expect(header).toContain("[Edit ~/proj/b.ts]");
});

test("no tool summary without --tool / --file", () => {
  const h = hit();
  h.turn.toolCalls = [{ name: "Edit", paths: ["/a.ts"] }];
  expect(formatHit(h, opts, "/home/u", false).split("\n")[0]).not.toContain(
    "[Edit",
  );
});

test("a patternless run prints the header alone, not every line", () => {
  const h = hit();
  h.turn.toolCalls = [{ name: "Edit", paths: ["/home/u/proj/a.ts"] }];
  h.matchedLineIndices = [0, 1, 2];
  const out = formatHit(
    h,
    { ...opts, pattern: undefined, tools: ["Edit"] },
    "/home/u",
    false,
  );
  expect(out.split("\n")).toHaveLength(1);
  expect(out).toContain("[Edit ~/proj/a.ts]");
});

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
  expect(out.split("\n")[0]).toMatch(/ {2}\[Bash\]$/);
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

// The mark is asserted as a literal, not via SUBAGENT_MARK: routing both sides
// through the constant lets a wrong value pass every assertion.
test("the exported mark is the literal the output contract promises", () => {
  expect(SUBAGENT_MARK).toBe("▸sub");
});

test("a subagent hit is marked on the header, a main-thread one is not", () => {
  const main = formatHit(hit(), opts, "/home/u", false).split("\n")[0];
  expect(main).toContain("abcdef12  user");
  expect(main).not.toContain("▸sub");

  const sub = formatHit(
    hit({ isSidechain: true }),
    opts,
    "/home/u",
    false,
  ).split("\n")[0];
  expect(sub).toContain("abcdef12 ▸sub  user");
});

test("the mark never joins the session id, which is copied back into --session", () => {
  const header = formatHit(
    hit({ isSidechain: true }),
    opts,
    "/home/u",
    false,
  ).split("\n")[0];
  // Whitespace-splitting the header — `awk '{print $N}'` — must still yield a
  // usable id rather than one with the marker glued on.
  expect(header.split(/\s+/)).toContain("abcdef12");
});

test("a subagent dump turn carries the mark and its agent id", () => {
  const h = hit({ isSidechain: true, agentId: "a0d4d2d0b4abed822" });
  const header = formatDumpTurn(h, opts, false).split("\n")[0];
  expect(header).toContain("▸sub a0d4d2d0b4abed822");
});

test("a subagent dump turn without an agent id still marks", () => {
  const header = formatDumpTurn(hit({ isSidechain: true }), opts, false).split(
    "\n",
  )[0];
  expect(header).toMatch(/▸sub$/);
});

test("formatHitJson names the subagent relation instead of leaving it to the path", () => {
  const obj = JSON.parse(
    formatHitJson(
      hit({ isSidechain: true, agentId: "a0d4d2d0b4abed822" }),
      jsonOpts,
      "/home/u",
    ),
  );
  expect(obj.isSubagent).toBe(true);
  expect(obj.agentId).toBe("a0d4d2d0b4abed822");
  expect(obj.parentSessionId).toBe("abcdef12-3456");
});

test("formatHitJson omits the subagent fields on a main-thread hit", () => {
  const obj = JSON.parse(formatHitJson(hit(), jsonOpts, "/home/u"));
  expect(obj.isSubagent).toBe(false);
  expect("agentId" in obj).toBe(false);
  expect("parentSessionId" in obj).toBe(false);
});

test("a dump renders tool calls the same way, keeping the marker inline", () => {
  const h = hit();
  h.turn.textLines = ["⚙ Edit", "old_string: before", "new_string: after"];
  h.matchedLineIndices = [2];
  const out = formatDumpTurn(h, { ...opts, pattern: "after" }, false);
  expect(out.split("\n").slice(1)).toEqual([
    "  │ [Edit]",
    "  │ - before",
    "  │ >> + after",
  ]);
});

test("a dump keeps a suppressed field, since it never elides", () => {
  const h = hit();
  h.turn.textLines = ["⚙ Edit", "replace_all: false", "file_path: /tmp/x"];
  h.matchedLineIndices = [2];
  const out = formatDumpTurn(h, { ...opts, pattern: "/tmp/x" }, false);
  expect(out).toContain("replace_all: false");
});

test("a tool hit names its tool on the header instead of in the body", () => {
  const h = hit();
  h.turn.textLines = ["⚙ Edit", "file_path: /tmp/x", "old_string: needle"];
  h.matchedLineIndices = [2];
  const out = formatHit(h, { ...opts, pattern: "needle" }, "/home/u", false);
  expect(out.split("\n")[0]).toMatch(/ {2}\[Edit\]$/);
  expect(out).not.toContain("⚙");
});

test("a matched tool header renders as the tag, not the raw mark", () => {
  const h = hit();
  h.turn.textLines = ["⚙ Edit", "file_path: /tmp/x"];
  h.matchedLineIndices = [0];
  const out = formatHit(h, { ...opts, pattern: "Edit" }, "/home/u", false);
  expect(out).not.toContain("⚙");
  expect(out.split("\n")[1]).toBe("  │ >> [Edit]");
});

test("edit strings render as diff sides rather than field labels", () => {
  const h = hit();
  h.turn.textLines = ["⚙ Edit", "old_string: before", "new_string: after"];
  h.matchedLineIndices = [2];
  const out = formatHit(h, { ...opts, pattern: "after" }, "/home/u", false);
  expect(out.split("\n").slice(1)).toEqual(["  │ - before", "  │ >> + after"]);
});

test("a noise field is hidden from context but still shows when it matched", () => {
  const h = hit();
  h.turn.textLines = ["⚙ Edit", "replace_all: false", "file_path: /tmp/x"];
  h.matchedLineIndices = [2];
  expect(
    formatHit(h, { ...opts, pattern: "/tmp/x" }, "/home/u", false),
  ).not.toContain("replace_all");

  h.matchedLineIndices = [1];
  expect(
    formatHit(h, { ...opts, pattern: "replace_all" }, "/home/u", false),
  ).toContain("replace_all");
});

test("highlight ranges follow the decorated text, not the extracted line", () => {
  const h = hit();
  h.turn.textLines = ["⚙ Edit", "new_string: needle"];
  h.matchedLineIndices = [1];
  const out = formatHit(h, { ...opts, pattern: "needle" }, "/home/u", true);
  // A raw-offset range would have shifted the highlight past the marker.
  expect(out).toContain("+ \x1b[1;31mneedle\x1b[0m");
});

test("prose is never reinterpreted as tool fields", () => {
  const h = hit();
  h.turn.textLines = ["old_string: this is prose", "tail"];
  h.matchedLineIndices = [0];
  const out = formatHit(h, { ...opts, pattern: "prose" }, "/home/u", false);
  expect(out).toContain("old_string: this is prose");
});

// The pre-decoration renderer printed `⚙ Bash` here; dropping it silently would
// leave the block's own lines unattributed.
test("a header pulled in only as context stays inline, keeping attribution", () => {
  const h = hit();
  h.turn.textLines = ["⚙ Bash", "command: ls", "", "prose match"];
  h.matchedLineIndices = [3];
  const out = formatHit(
    h,
    { ...opts, context: 3, pattern: "prose match" },
    "/home/u",
    false,
  );
  expect(out.split("\n")[0]).not.toContain("[Bash]");
  expect(out).toContain("  │ [Bash]");
});

// Keyed by name, a neighbouring block of the same tool lost its header and its
// diff lines read as part of the matched call's.
test("a neighbouring block of the same tool keeps its own header", () => {
  const h = hit();
  h.turn.textLines = [
    "⚙ Edit",
    "old_string: aaa",
    "⚙ Edit",
    "old_string: MATCHME",
  ];
  h.matchedLineIndices = [3];
  const out = formatHit(
    h,
    { ...opts, context: 4, pattern: "MATCHME" },
    "/home/u",
    false,
  );
  const body = out.split("\n").slice(1);
  expect(body.filter((l) => l.includes("[Edit]"))).toHaveLength(1);
  expect(body[0]).toBe("  │ [Edit]");
});

// The filter names why the turn was selected; the body may be showing a
// different call, and labelling that one with the filter's name is a lie.
test("a filtered run still names the call the body is showing", () => {
  const h = hit();
  h.turn.textLines = ["⚙ Edit", "old_string: MATCHME"];
  h.turn.toolCalls = [
    { name: "Bash", paths: [] },
    { name: "Edit", paths: ["/x"] },
  ];
  h.matchedLineIndices = [1];
  const header = formatHit(
    h,
    { ...opts, pattern: "MATCHME", tools: ["Bash"] },
    "/home/u",
    false,
  ).split("\n")[0];
  expect(header).toContain("[Bash]");
  expect(header).toContain("[Edit]");
});

test("the filter's own name is not repeated as a body tag", () => {
  const h = hit();
  h.turn.textLines = ["⚙ Edit", "old_string: MATCHME"];
  h.turn.toolCalls = [{ name: "Edit", paths: ["/home/u/proj/x"] }];
  h.matchedLineIndices = [1];
  const header = formatHit(
    h,
    { ...opts, pattern: "MATCHME", tools: ["Edit"] },
    "/home/u",
    false,
  ).split("\n")[0];
  expect(header).toContain("[Edit ~/proj/x]");
  expect(header.match(/\[Edit/g)).toHaveLength(1);
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
  expect(out.split("\n")[0]).not.toContain("[Bash]");
});

test("formatSessionLine prints the full id so it pastes into --session", () => {
  const t = hit().turn;
  const out = formatSessionLine(t.sessionId, t.cwd, 3, "/home/u", false);
  expect(out).toContain(t.sessionId);
  expect(out).toContain("~/proj");
  expect(out).toContain("3 hits");
});

test("formatSessionLine singularises a lone hit", () => {
  const t = hit().turn;
  expect(formatSessionLine(t.sessionId, t.cwd, 1, "/home/u", false)).toContain(
    "1 hit ",
  );
});

test("formatSessionLine tolerates a missing session id and cwd", () => {
  const out = formatSessionLine(undefined, undefined, 2, "/home/u", false);
  expect(out).toContain("?");
});
