import type { Options, Turn } from "./types.js";

/**
 * True if a turn passes every metadata filter (role / time window / cwd /
 * branch / meta). Turns missing a field the filter targets are excluded when a
 * filter for that field is active — a `--cwd` filter can't match an unknown
 * cwd, and a turn without a parseable timestamp can't be placed inside a
 * requested `--since`/`--until` window.
 */
export function passesFilters(turn: Turn, opts: Options): boolean {
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

  return true;
}
