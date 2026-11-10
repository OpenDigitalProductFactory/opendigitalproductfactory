// apps/web/lib/routing/cli-limit-reset.ts
//
// Pure readers for the reset instant a CLI subscription limit states. No I/O:
// the CLI adapters run them over a validated terminal envelope and keep only
// the derived instant, never the CLI's text (BI-783EBEE6). cli-pool-status
// re-exports them for its own Retry-After parsing.

/**
 * Absolute reset stated by the ChatGPT/Codex subscription cap, e.g.
 * "try again at Sep 26th, 2026 8:57 AM". Ordinal suffixes are stripped before
 * parsing. Returns the reset instant or null when no dated phrase is present.
 * The CLI prints wall-clock time without a zone; it is read as UTC, which is
 * the sandbox's clock and errs on the early side for western operators.
 */
export function parseAbsoluteResetAt(stderr: string, now: Date = new Date()): Date | null {
  const match = /try again (?:at|on)\s+([A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?:,?\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:[AP]M)?)?)/i.exec(stderr);
  if (!match) return parseClaudeDatedReset(stderr, now);
  const cleaned = match[1]!.replace(/(\d{1,2})(?:st|nd|rd|th)/i, "$1").replace(/\./g, "").replace(/,/g, "");
  const parsed = Date.parse(`${cleaned} UTC`);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Offset (ms) of an IANA zone from UTC at the given instant; null for an unknown zone. */
function zoneOffsetMs(timeZone: string, atMs: number): number | null {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone, numberingSystem: "latn", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
    }).formatToParts(new Date(atMs));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - atMs;
  } catch {
    return null;
  }
}

/** Wall-clock time in a zone → the UTC instant (two passes settle a DST edge). */
function zonedWallClockToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number | null {
  const wall = Date.UTC(year, month, day, hour, minute);
  const first = zoneOffsetMs(timeZone, wall);
  if (first == null) return null;
  const second = zoneOffsetMs(timeZone, wall - first);
  return second == null ? null : wall - second;
}

/**
 * The Claude CLI's dated limit, e.g. "You've hit your weekly limit · resets
 * Oct 20, 4pm (UTC)" (BI-0319EE11) or "resets Nov 3 at 10am (America/Chicago)". The banner names month, day, clock and zone
 * but no year. A clock-only banner
 * ("resets 4pm (UTC)") names no day and stays unknown (BI-EDF1BD54: never invent
 * a day); so does a zone this runtime cannot resolve.
 */
export function parseClaudeDatedReset(text: string, now: Date = new Date()): Date | null {
  // BI-783EBEE6: the CLI also writes "resets Nov 3 at 10am (America/Chicago)",
  // with "at" and sometimes without the parentheses around the zone.
  const match = /resets\s+([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)\b\s*(?:\(([^)\s]+)\)|(UTC|[A-Za-z]+(?:\/[A-Za-z_+-]+)+))?/i.exec(text);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1]!.slice(0, 3).toLowerCase());
  const day = Number(match[2]);
  const hour12 = Number(match[3]);
  const minute = match[4] ? Number(match[4]) : 0;
  if (month < 0 || day < 1 || day > 31 || hour12 < 1 || hour12 > 12 || minute > 59) return null;
  const hour = (hour12 % 12) + (match[5]!.toLowerCase() === "pm" ? 12 : 0);
  const zone = match[6] ?? match[7] ?? "UTC";
  // A limit window is at most a week, so the stated day is the year's
  // occurrence nearest now: Jan 3 read on Dec 30 is next year's, and a reset a
  // minute past stays past (seconds 0) rather than becoming a year away.
  const year = now.getUTCFullYear();
  let nearest: number | null = null;
  for (const candidate of [year - 1, year, year + 1]) {
    const at = zonedWallClockToUtc(candidate, month, day, hour, minute, zone);
    if (at == null) return null;
    if (nearest == null || Math.abs(at - now.getTime()) < Math.abs(nearest - now.getTime())) nearest = at;
  }
  return nearest == null ? null : new Date(nearest);
}
