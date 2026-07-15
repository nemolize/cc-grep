import type { Options } from "./types.js";

export interface Matcher {
  /** True if the line contains at least one match. */
  test(line: string): boolean;
  /** All [start, end) match ranges in the line, for highlighting. */
  ranges(line: string): Array<[number, number]>;
}

// JS has no regex execution timeout, so a catastrophic-backtracking pattern on
// a long line can wedge the whole scan. Skip lines above this length rather
// than evaluate them — a transcript line over 1 MB is already pathological.
const MAX_MATCH_LINE_BYTES = 1_000_000;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a matcher from the parsed options. Precedence: `--fixed` forces literal
 * substring even if the pattern looks like a regex; `--regex` compiles the
 * pattern as a RegExp; the default is literal substring. `--ignore-case`
 * applies to all three. A malformed regex throws so the CLI can report it.
 */
export function buildMatcher(opts: Options): Matcher {
  const flags = opts.ignoreCase ? "gi" : "g";
  const source =
    opts.regex && !opts.fixed ? opts.pattern : escapeRegex(opts.pattern);
  let re: RegExp;
  try {
    re = new RegExp(source, flags);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid regular expression: ${msg}`, { cause: err });
  }

  return {
    test(line: string): boolean {
      if (line.length > MAX_MATCH_LINE_BYTES) return false;
      re.lastIndex = 0;
      return re.test(line);
    },
    ranges(line: string): Array<[number, number]> {
      if (line.length > MAX_MATCH_LINE_BYTES) return [];
      const out: Array<[number, number]> = [];
      re.lastIndex = 0;
      for (const m of line.matchAll(re)) {
        const start = m.index ?? 0;
        // Guard against zero-width matches (e.g. `--regex ''`) looping forever.
        const end = start + (m[0].length || 1);
        out.push([start, end]);
      }
      return out;
    },
  };
}
