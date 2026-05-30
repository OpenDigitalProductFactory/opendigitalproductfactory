/**
 * Shared date/time formatting for the portal UI.
 *
 * Portal timestamps are stored and transported as UTC instants (ISO strings or
 * `Date`s). They MUST be displayed in the viewer's local timezone — never UTC —
 * because portal operators are rarely on UTC and a bare UTC time is useless to
 * them. See {@link ./../components/ui/LocalTime} for the SSR-safe component that
 * renders these; server components cannot know the viewer's timezone, so any
 * user-visible timestamp rendered on the server has to go through `LocalTime`.
 */

export type DateTimeMode = "datetime" | "date" | "time";

const PRESETS: Record<DateTimeMode, Intl.DateTimeFormatOptions> = {
  datetime: {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  },
  date: { year: "numeric", month: "short", day: "numeric" },
  time: { hour: "numeric", minute: "2-digit" },
};

export type FormatInstantOptions = {
  mode?: DateTimeMode;
  /** Override the preset format options entirely. */
  options?: Intl.DateTimeFormatOptions;
  /**
   * Force a specific IANA timezone. Defaults to the runtime's zone (the
   * viewer's browser on the client). Pass "UTC" for a deterministic render.
   */
  timeZone?: string;
  /**
   * Append the timezone abbreviation (e.g. "CDT") so a local time is never
   * ambiguous. Defaults to true for datetime/time, false for date-only.
   */
  withZone?: boolean;
};

/**
 * Format a UTC instant for display. With no `timeZone` it uses the runtime's
 * timezone — the viewer's browser when called on the client.
 */
export function formatInstant(
  value: string | number | Date,
  opts: FormatInstantOptions = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const mode = opts.mode ?? "datetime";
  const base = opts.options ?? PRESETS[mode];
  const withZone = opts.withZone ?? mode !== "date";

  const formatOptions: Intl.DateTimeFormatOptions = { ...base };
  if (opts.timeZone) formatOptions.timeZone = opts.timeZone;
  if (withZone && formatOptions.timeZoneName === undefined) {
    formatOptions.timeZoneName = "short";
  }

  return new Intl.DateTimeFormat(undefined, formatOptions).format(date);
}
