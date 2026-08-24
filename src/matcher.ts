import type { Options } from "./types.js";

export interface Matcher {
  /** True if the line contains at least one match. */
  test(line: string): boolean;
  /** All [start, end) match ranges in the line, for highlighting. */
  ranges(line: string): [number, number][];
}

// JS has no regex execution timeout, so a catastrophic-backtracking pattern on
// a long line can wedge the whole scan. Skip lines above this length rather
// than evaluate them — a transcript line over 1 MB is already pathological.
const MAX_MATCH_LINE_BYTES = 1_000_000;

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `s` matches only itself, i.e. escaping it would be a no-op. */
export function isRegexLiteral(s: string): boolean {
  return escapeRegex(s) === s;
}

/**
 * `--fixed` wins over `--regex`, so the pattern is a RegExp source only here.
 * The prefilter reads the same predicate: were the two to disagree, it could
 * narrow below the matcher and silently drop hits.
 */
export function patternIsRegexSource(opts: Options): boolean {
  return opts.regex && !opts.fixed;
}

/**
 * Build a matcher from the parsed options. With no pattern at all, every line
 * matches and none reports ranges. Otherwise precedence: `--fixed` forces
 * literal substring even if the pattern looks like a regex; `--regex` compiles
 * the pattern as a RegExp; the default is literal substring. `--ignore-case`
 * applies to all three. A malformed regex throws so the CLI can report it.
 */
export function buildMatcher(opts: Options): Matcher {
  const pattern = opts.pattern;
  if (pattern === undefined) {
    return {
      test: () => true,
      ranges: () => [],
    };
  }

  const flags = opts.ignoreCase ? "gi" : "g";
  const source = patternIsRegexSource(opts) ? pattern : escapeRegex(pattern);
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
    ranges(line: string): [number, number][] {
      if (line.length > MAX_MATCH_LINE_BYTES) return [];
      const out: [number, number][] = [];
      re.lastIndex = 0;
      for (const m of line.matchAll(re)) {
        const start = m.index;
        // Guard against zero-width matches (e.g. `--regex ''`) looping forever.
        const end = start + (m[0].length || 1);
        out.push([start, end]);
      }
      return out;
    },
  };
}
