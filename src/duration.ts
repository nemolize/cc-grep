const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

const DURATION_RE = /^(\d+)\s*([smhdw])$/;

/**
 * Resolve a `--since` / `--until` value to epoch millis. Accepts a relative
 * duration (`7d`, `2h`, `30m`) interpreted as "ago" from `now`, or an absolute
 * date/datetime string parsed by `Date`. Throws on an unparseable value so the
 * CLI can report a clear error instead of silently ignoring the filter.
 */
export function parseSinceUntil(
  value: string,
  now: number = Date.now(),
): number {
  const trimmed = value.trim();
  const rel = DURATION_RE.exec(trimmed);
  if (rel) {
    const amount = Number(rel[1]);
    const unit = rel[2] === undefined ? undefined : UNIT_MS[rel[2]];
    if (unit !== undefined) return now - amount * unit;
  }
  const abs = Date.parse(trimmed);
  if (!Number.isNaN(abs)) return abs;
  throw new Error(
    `invalid time value: "${value}" (use a duration like "7d"/"2h"/"30m" or a date like "2026-06-01")`,
  );
}
