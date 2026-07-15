const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

const DURATION_RE = /^(\d+)\s*([smhdw])$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const END_OF_DAY_MS = 86_400_000 - 1;

/**
 * Resolve a `--since` / `--until` value to epoch millis. Accepts a relative
 * duration (`7d`, `2h`, `30m`) interpreted as "ago" from `now`, or an absolute
 * date/datetime string parsed by `Date`. A date-only value (`2026-07-15`) is
 * anchored to a UTC day boundary picked by `boundary`: `since` uses 00:00:00Z
 * (include the whole day forward), `until` uses 23:59:59.999Z (include the
 * whole day back). Throws on an unparseable value.
 */
export function parseSinceUntil(
  value: string,
  boundary: "since" | "until",
  now: number = Date.now(),
): number {
  const trimmed = value.trim();
  const rel = DURATION_RE.exec(trimmed);
  if (rel) {
    const amount = Number(rel[1]);
    const unit = rel[2] === undefined ? undefined : UNIT_MS[rel[2]];
    if (unit !== undefined) return now - amount * unit;
  }
  if (DATE_ONLY_RE.test(trimmed)) {
    const startOfDay = Date.parse(`${trimmed}T00:00:00Z`);
    if (!Number.isNaN(startOfDay)) {
      return boundary === "since" ? startOfDay : startOfDay + END_OF_DAY_MS;
    }
  }
  const abs = Date.parse(trimmed);
  if (!Number.isNaN(abs)) return abs;
  throw new Error(
    `invalid time value: "${value}" (use a duration like "7d"/"2h"/"30m" or a date like "2026-06-01")`,
  );
}
