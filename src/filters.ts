import type { Options, ToolCall, Turn } from "./types.js";

/**
 * True if a turn passes every metadata filter (session / role / time window /
 * cwd / branch / meta). Turns missing a field the filter targets are excluded
 * when a filter for that field is active — a `--cwd` filter can't match an
 * unknown cwd, and a turn without a parseable timestamp can't be placed inside
 * a requested `--since`/`--until` window.
 */
export function passesFilters(turn: Turn, opts: Options): boolean {
  // Prefix, not equality: search output prints an 8-char id, and that is the
  // form a user copies back into `--session`.
  if (opts.session !== undefined) {
    if (turn.sessionId?.startsWith(opts.session) !== true) return false;
  }

  if (!passesSubagentScope(turn, opts)) return false;

  if (opts.role !== "any" && turn.role !== opts.role) return false;

  if (!opts.includeMeta && turn.isMeta) return false;

  if (opts.sinceMs !== undefined || opts.untilMs !== undefined) {
    if (turn.timestampMs === undefined) return false;
    if (opts.sinceMs !== undefined && turn.timestampMs < opts.sinceMs)
      return false;
    if (opts.untilMs !== undefined && turn.timestampMs > opts.untilMs)
      return false;
  }

  if (opts.cwd !== undefined) {
    if (turn.cwd?.includes(opts.cwd) !== true) return false;
  }
  if (opts.branch !== undefined) {
    if (turn.gitBranch?.includes(opts.branch) !== true) return false;
  }

  if (opts.tools !== undefined || opts.file !== undefined) {
    if (!turn.toolCalls.some((call) => matchesToolCall(call, opts))) {
      return false;
    }
  }

  return true;
}

/**
 * Both conditions must hold on the *same* call: `--tool Edit --file x` asks
 * which session edited x, not one that read x and edited something else.
 */
export function matchesToolCall(call: ToolCall, opts: Options): boolean {
  if (
    opts.tools !== undefined &&
    !opts.tools.some((name) => name.toLowerCase() === call.name.toLowerCase())
  ) {
    return false;
  }
  return opts.file === undefined || matchingPaths(call, opts.file).length > 0;
}

/**
 * Substring, mirroring `--cwd` / `--branch`: the caller has a repo-relative
 * path in hand, while the transcript records an absolute one.
 */
export function matchingPaths(call: ToolCall, file: string): string[] {
  return call.paths.filter((path) => path.includes(file));
}

/**
 * The default differs per surface because an unfiltered dump would splice every
 * agent a session spawned into the conversation.
 */
function passesSubagentScope(turn: Turn, opts: Options): boolean {
  const scope =
    opts.subagents ?? (opts.session === undefined ? "include" : "exclude");
  if (scope === "include") return true;
  return scope === "only" ? turn.isSidechain : !turn.isSidechain;
}
