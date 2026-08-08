const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const ABSOLUTE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600_000],
  ['month', 30 * 24 * 3600_000],
  ['week', 7 * 24 * 3600_000],
  ['day', 24 * 3600_000],
  ['hour', 3600_000],
  ['minute', 60_000],
];

/** "3 days ago" for timestamps, falling back to the raw string when unparseable. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  const delta = at - now;
  const magnitude = Math.abs(delta);
  if (magnitude < 45_000) return 'just now';
  for (const [unit, ms] of UNITS) {
    if (magnitude < ms) continue;
    return RELATIVE.format(Math.round(delta / ms), unit);
  }
  return RELATIVE.format(Math.round(delta / 60_000), 'minute');
}

export function absoluteTime(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  return ABSOLUTE.format(at);
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
