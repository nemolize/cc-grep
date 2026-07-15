import { buildMatcher } from "./matcher.js";
import type { ColorMode, Hit, Options } from "./types.js";

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
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  );
}

function shortSession(id: string | undefined): string {
  if (id === undefined || id === "") return "?";
  return id.slice(0, 8);
}

function highlight(
  line: string,
  ranges: Array<[number, number]>,
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
  const header =
    (color ? CYAN : "") +
    `${shortenPath(turn.cwd, home)}  ${formatTimestamp(turn.timestampMs)}  ` +
    `${shortSession(turn.sessionId)}  ${turn.role}` +
    (color ? RESET : "");

  const matcher = buildMatcher(opts);
  const matched = new Set(hit.matchedLineIndices);

  // Collect the line indices to show: each match ± context, merged.
  const show = new Set<number>();
  for (const idx of hit.matchedLineIndices) {
    for (let i = idx - opts.context; i <= idx + opts.context; i++) {
      if (i >= 0 && i < turn.textLines.length) show.add(i);
    }
  }
  const ordered = [...show].sort((a, b) => a - b);

  const body = ordered.map((i) => {
    const raw = turn.textLines[i] ?? "";
    if (matched.has(i)) {
      const shown = highlight(raw, matcher.ranges(raw), color);
      return `  │ >> ${shown}`;
    }
    const dim = color ? DIM + raw + RESET : raw;
    return `  │ ${dim}`;
  });

  return [header, ...body].join("\n");
}

/** One JSON object per hit for `--json` (pipeline-friendly, one line each). */
export function formatHitJson(hit: Hit, home: string): string {
  const { turn } = hit;
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
    matchedLines: hit.matchedLineIndices.map((i) => turn.textLines[i]),
  });
}

/** The `claude --resume <id>` affordance line for a hit, if it has a session id. */
export function resumeCommand(hit: Hit): string | undefined {
  const id = hit.turn.sessionId;
  if (id === undefined || id === "") return undefined;
  return `claude --resume ${id}`;
}
