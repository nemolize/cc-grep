import {
  escapeRegex,
  isRegexLiteral,
  patternIsRegexSource,
} from "./matcher.js";
import type { Options } from "./types.js";

export interface Prefilter {
  /**
   * A rejected raw line cannot contain the pattern, so its `JSON.parse` is
   * skipped; an accepted one is still decided by the real matcher.
   */
  test(rawLine: string): boolean;
}

const ACCEPT_ALL: Prefilter = { test: () => true };

/**
 * Characters that survive verbatim from a JSON string into the text the matcher
 * sees, and that `textExtract` never synthesises. Excluded: `"` `\` `/` and
 * anything outside printable ASCII, because JSON must or may encode those as an
 * escape (`\"`, `\\`, `\/`, `\uXXXX`) so the raw bytes differ from the decoded
 * text; and `:` `,` `[` `]` `{` `}` and space, because `textExtract` synthesises
 * those when it renders `key: value`, `[a, b]` and `{k: v}`, so a decoded match
 * could span text that was never contiguous in the raw line.
 *
 * This set alone is NOT sufficient: JSON may `\u`-escape *any* character, so
 * even a character listed here can hide from a raw scan. {@link hasUnicodeEscape}
 * is what closes that hole.
 */
function isRawSafe(ch: string): boolean {
  const code = ch.codePointAt(0);
  if (code === undefined || code < 0x21 || code > 0x7e) return false;
  return !`"\\/:,[]{}`.includes(ch);
}

/**
 * A `\uXXXX` escape can encode any character, including one `isRawSafe` admits,
 * so such a line must be parsed rather than rejected — an HTML-escaping
 * serialiser writes `>` as `>`, which a raw scan for `>` would miss. Such
 * lines are rare enough in practice that the forced parse costs almost nothing.
 */
function hasUnicodeEscape(rawLine: string): boolean {
  return rawLine.includes("\\u");
}

/**
 * Any substring of the pattern must appear wherever the pattern does, so the
 * longest safe run is a valid required literal — and being the longest, it
 * rejects the most lines.
 */
export function longestRawSafeRun(s: string): string {
  let best = "";
  let run = "";
  for (const ch of s) {
    if (isRawSafe(ch)) {
      run += ch;
      if (run.length > best.length) best = run;
    } else {
      run = "";
    }
  }
  return best;
}

// Shorter than this the literal is too common to reject anything, so the extra
// scan of every raw line stops paying for itself.
const MIN_LITERAL_LENGTH = 3;

/**
 * `textExtract` renders a non-string JSON value through `JSON.stringify`, whose
 * output need not appear in the raw line: `1e2` arrives as `100`, and `1e400`
 * overflows to `Infinity` and arrives as `null`. A literal that could sit inside
 * one of those renderings is unscannable, so the caller must stop prefiltering.
 *
 * The renderings are numbers plus the fixed tokens below; an object or array
 * stringifies with `"` `{` `}` `[` `]` `:` `,`, which `isRawSafe` already
 * excludes, so a run can only land on a key or string inside one — and those do
 * appear in the raw line.
 */
function couldSitInsideARenderedNonString(literal: string): boolean {
  if (/^[0-9.eE+-]+$/.test(literal)) return true;
  return ["null", "true", "false"].some((token) => token.includes(literal));
}

/**
 * Correctness depends on the returned filter being a superset of the matcher:
 * it must accept every line the matcher would accept, so it falls back to
 * accept-all whenever the literal cannot be scanned for reliably — no pattern at
 * all, a regex whose matches are not pinned to one string, a pattern with no
 * usable safe run, or one that could sit inside a rendered non-string value.
 * The filters it does return admit any `\u`-escaping line outright, because a
 * literal cannot be scanned for reliably there either.
 */
export function buildPrefilter(opts: Options): Prefilter {
  const pattern = opts.pattern;
  if (pattern === undefined) return ACCEPT_ALL;
  if (patternIsRegexSource(opts) && !isRegexLiteral(pattern)) {
    return ACCEPT_ALL;
  }

  const literal = longestRawSafeRun(pattern);
  if (literal.length < MIN_LITERAL_LENGTH) return ACCEPT_ALL;
  if (couldSitInsideARenderedNonString(literal)) return ACCEPT_ALL;

  if (!opts.ignoreCase) {
    return {
      test: (rawLine) => rawLine.includes(literal) || hasUnicodeEscape(rawLine),
    };
  }
  // `toLowerCase().includes` would allocate a copy of every line, measured
  // slower than the parsing it saves, so fold with a compiled regex instead.
  const re = new RegExp(escapeRegex(literal), "i");
  return {
    test: (rawLine) => re.test(rawLine) || hasUnicodeEscape(rawLine),
  };
}
