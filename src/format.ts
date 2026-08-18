import { matchesToolCall, matchingPaths } from "./filters.js";
import { buildMatcher } from "./matcher.js";
import { TOOL_MARK } from "./textExtract.js";
import { decorateToolLines } from "./toolRender.js";
import type { ColorMode, Hit, Options, Turn } from "./types.js";

const RESET = "\x1b[0m";
const BOLD_RED = "\x1b[1;31m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";

export function shouldColor(mode: ColorMode, isTTY: boolean): boolean {
  if (mode === "always") return true;
  if (mode === "never") return false;
  return isTTY;
}

/** Shorten a home-prefixed absolute path to `~/...` for display. */
export function shortenPath(path: string | undefined, home: string): string {
  if (path === undefined || path === "") return "?";
  if (home !== "" && (path === home || path.startsWith(home + "/"))) {
    return "~" + path.slice(home.length);
  }
  return path;
}

/** `2026-07-10 21:34` from epoch millis, in local time. */
export function formatTimestamp(ms: number | undefined): string {
  if (ms === undefined) return "?";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  );
}

function shortSession(id: string | undefined): string {
  if (id === undefined || id === "") return "?";
  return id.slice(0, 8);
}

/**
 * Unmarked, a subagent hit's header reads as something the human typed: the
 * turn carries its parent's session id and a bare `user` role.
 */
export const SUBAGENT_MARK = "▸sub";

/**
 * Space-separated, never glued to the id: the printed id is what a user copies
 * back into `--session`, and a marker inside that token matches no session.
 */
function sessionField(turn: Turn): string {
  const id = shortSession(turn.sessionId);
  return turn.isSidechain ? `${id} ${SUBAGENT_MARK}` : id;
}

function cyan(text: string, color: boolean): string {
  return color ? CYAN + text + RESET : text;
}

function highlight(
  line: string,
  ranges: [number, number][],
  color: boolean,
): string {
  if (!color || ranges.length === 0) return line;
  // Ranges from `matchAll` are already left-to-right and non-overlapping.
  let out = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue;
    out +=
      line.slice(cursor, start) + BOLD_RED + line.slice(start, end) + RESET;
    cursor = end;
  }
  out += line.slice(cursor);
  return out;
}

/**
 * Index of the `⚙ <tool>` header owning `idx` — a match deep inside a long
 * argument would otherwise show with no sign of which tool ran.
 */
function toolHeaderIndex(lines: string[], idx: number): number | undefined {
  for (let i = idx; i >= 0; i--) {
    const line = lines[i] ?? "";
    if (line.startsWith(TOOL_MARK)) return i;
    // A blank line ends the argument block, so prose can't borrow a header.
    if (i < idx && line === "") return undefined;
  }
  return undefined;
}

/**
 * The tool calls a `--tool` / `--file` run selected the turn for, so a hit
 * reads as "session S edited F at T" without a follow-up `--json | jq`.
 */
function toolSummary(turn: Turn, opts: Options, home: string): string {
  if (opts.tools === undefined && opts.file === undefined) return "";

  const file = opts.file;
  const parts: string[] = [];
  for (const call of turn.toolCalls) {
    if (!matchesToolCall(call, opts)) continue;
    const paths = file === undefined ? call.paths : matchingPaths(call, file);
    parts.push(
      paths.length === 0
        ? `[${call.name}]`
        : paths
            .map((path) => `[${call.name} ${shortenPath(path, home)}]`)
            .join(" "),
    );
  }
  return parts.length === 0 ? "" : "  " + parts.join(" ");
}

/**
 * Render one hit as a human-readable block: a header line (cwd / timestamp /
 * session / role) followed by the matched lines with ±context, matches
 * highlighted and prefixed with `>>`.
 */
export function formatHit(
  hit: Hit,
  opts: Options,
  home: string,
  color: boolean,
): string {
  const { turn } = hit;
  const summary = toolSummary(turn, opts, home);

  // Without a pattern every line "matched", so a body would dump whole Edits;
  // the header already carries what the filters selected the turn for.
  if (opts.pattern === undefined) {
    return cyan(
      `${shortenPath(turn.cwd, home)}  ${formatTimestamp(turn.timestampMs)}  ` +
        `${sessionField(turn)}  ${turn.role}${summary}`,
      color,
    );
  }

  const matcher = buildMatcher(opts);
  const matched = new Set(hit.matchedLineIndices);
  const decorations = decorateToolLines(turn.textLines);

  const show = new Set<number>();
  const tools: string[] = [];
  const hoisted = new Set<number>();
  for (const idx of hit.matchedLineIndices) {
    for (let i = idx - opts.context; i <= idx + opts.context; i++) {
      if (i >= 0 && i < turn.textLines.length) show.add(i);
    }
    const at = toolHeaderIndex(turn.textLines, idx);
    if (at === undefined) continue;
    show.add(at);
    hoisted.add(at);
    const name = decorations[at]?.toolName;
    if (name !== undefined && name !== "" && !tools.includes(name)) {
      tools.push(name);
    }
  }
  const ordered = [...show].sort((a, b) => a - b);

  // The filters name the calls they selected the turn for; these name the call
  // the body is showing. They differ whenever a turn made more than one.
  const shown = tools.filter((name) => !summary.includes(`[${name}`));
  const header = cyan(
    `${shortenPath(turn.cwd, home)}  ${formatTimestamp(turn.timestampMs)}  ` +
      `${sessionField(turn)}  ${turn.role}${summary}` +
      (shown.length > 0 ? `  [${shown.join(", ")}]` : ""),
    color,
  );

  const body: string[] = [];
  for (const i of ordered) {
    const raw = turn.textLines[i] ?? "";
    const dec = decorations[i];
    // Keyed by index, not name: a neighbouring block of the same tool needs its
    // own header, or its `-`/`+` lines read as part of the matched call's diff.
    const orphanHeader = dec?.toolName !== undefined && !hoisted.has(i);
    // A suppressed line that matched still prints — hiding it would drop the
    // very hit the user searched for.
    if (dec?.suppressed === true && !matched.has(i) && !orphanHeader) continue;
    // Ranges are recomputed on the shown text: a decorated line is not the
    // extracted one, so the raw line's offsets would highlight the wrong span.
    const text = dec?.text ?? raw;
    if (matched.has(i)) {
      body.push(`  │ >> ${highlight(text, matcher.ranges(text), color)}`);
      continue;
    }
    body.push(`  │ ${color ? DIM + text + RESET : text}`);
  }

  return [header, ...body].join("\n");
}

/**
 * One `-l` line per matching session. The full id is printed, not the 8-char
 * form headers use, so the line pastes straight into `--session`.
 */
export function formatSessionLine(
  sessionId: string | undefined,
  cwd: string | undefined,
  hits: number,
  home: string,
  color: boolean,
): string {
  const id = sessionId === undefined || sessionId === "" ? "?" : sessionId;
  const unit = hits === 1 ? "hit " : "hits";
  return (
    cyan(id, color) +
    `  ${String(hits).padStart(4)} ${unit}  ${shortenPath(cwd, home)}`
  );
}

/**
 * Banner printed once above a `--session` dump, carrying the per-session
 * metadata that `formatHit` repeats on every hit.
 */
export function formatDumpBanner(
  turn: Turn,
  home: string,
  color: boolean,
): string {
  return cyan(
    `session ${turn.sessionId ?? "?"}  ${shortenPath(turn.cwd, home)}` +
      (turn.gitBranch === undefined ? "" : `  (${turn.gitBranch})`),
    color,
  );
}

/**
 * Render one turn of a `--session` dump: a `role  timestamp` header over the
 * turn's full text. Unlike `formatHit` this never elides — reading a past
 * conversation is the point, so context windows do not apply — but a pattern
 * given alongside `--session` still highlights.
 */
export function formatDumpTurn(
  hit: Hit,
  opts: Options,
  color: boolean,
): string {
  const { turn } = hit;
  const header = cyan(
    `${turn.role}  ${formatTimestamp(turn.timestampMs)}` +
      (turn.isSidechain
        ? `  ${SUBAGENT_MARK}${turn.agentId === undefined ? "" : " " + turn.agentId}`
        : ""),
    color,
  );

  const matcher = buildMatcher(opts);
  const matched = new Set(hit.matchedLineIndices);
  // With no pattern every line is "matched"; highlighting all of them is noise.
  const highlighting = opts.pattern !== undefined;
  const decorations = decorateToolLines(turn.textLines);

  // The marker stays inline rather than moving to the header: one turn can hold
  // several calls, and a hoisted list would not say which block each name owns.
  const body = turn.textLines.map((raw, i) => {
    const text = decorations[i]?.text ?? raw;
    // `>>` keeps the match visible under `--color never` and through a pipe.
    return highlighting && matched.has(i)
      ? `  │ >> ${highlight(text, matcher.ranges(text), color)}`
      : `  │ ${text}`;
  });

  return [header, ...body].join("\n");
}

/** One JSON object per hit for `--json` (pipeline-friendly, one line each). */
export function formatHitJson(hit: Hit, opts: Options, home: string): string {
  const { turn } = hit;
  // A patternless search matches every line, so `matchedLines` would ship whole
  // `Edit` payloads while saying nothing; a dump still carries the turn in full.
  const everyLineMatched =
    opts.pattern === undefined && opts.session === undefined;
  return JSON.stringify({
    file: turn.file,
    lineIndex: turn.lineIndex,
    cwd: turn.cwd,
    cwdShort: shortenPath(turn.cwd, home),
    timestamp: turn.timestamp,
    sessionId: turn.sessionId,
    role: turn.role,
    gitBranch: turn.gitBranch,
    isMeta: turn.isMeta,
    isSubagent: turn.isSidechain,
    // Naming the parent again spares a consumer the "is this the parent or the
    // agent?" question about `sessionId`.
    ...(turn.isSidechain
      ? { agentId: turn.agentId, parentSessionId: turn.sessionId }
      : {}),
    ...(turn.toolCalls.length > 0 ? { toolCalls: turn.toolCalls } : {}),
    matchedLines: everyLineMatched
      ? []
      : hit.matchedLineIndices.map((i) => turn.textLines[i]),
  });
}

/** The `claude --resume <id>` affordance line for a hit, if it has a session id. */
export function resumeCommand(hit: Hit): string | undefined {
  const id = hit.turn.sessionId;
  if (id === undefined || id === "") return undefined;
  return `claude --resume ${id}`;
}
