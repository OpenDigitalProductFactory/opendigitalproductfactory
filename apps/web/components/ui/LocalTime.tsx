"use client";

import { useEffect, useState } from "react";

import { formatInstant, type DateTimeMode } from "@/lib/datetime";

type Props = {
  /** A UTC instant: ISO string, epoch ms, or Date. */
  value: string | number | Date | null | undefined;
  mode?: DateTimeMode;
  /** Override the preset format options entirely. */
  options?: Intl.DateTimeFormatOptions;
  /** Append the timezone abbreviation. Defaults on for datetime/time. */
  withZone?: boolean;
  /**
   * Pin to UTC and skip localization. Use for pure *calendar dates* (invoice
   * dates, accounting periods) stored as midnight-UTC, where shifting into the
   * viewer's timezone would move the displayed day off-by-one. Implies a
   * date-only render with no zone label.
   */
  utc?: boolean;
  className?: string;
  /** Rendered when `value` is null/empty. */
  fallback?: string;
};

/**
 * Renders a UTC instant in the *viewer's* local timezone.
 *
 * Server components render in the container's timezone (UTC), so a timestamp
 * formatted on the server is stuck at UTC for every viewer. This client
 * component fixes that: it first renders a deterministic UTC string (matching
 * the server markup, so hydration never mismatches) and then, on mount,
 * re-formats in the browser's timezone with a zone label. The brief UTC→local
 * swap happens before paint in practice and keeps a useful `title` tooltip with
 * the UTC value until localized.
 */
export function LocalTime({
  value,
  mode = "datetime",
  options,
  withZone,
  utc = false,
  className,
  fallback = "—",
}: Props) {
  const hasValue = value != null && value !== "";
  const effectiveMode = utc ? "date" : mode;
  const effectiveWithZone = utc ? false : withZone;

  // Initial state is UTC so SSR and the first client paint agree.
  const [text, setText] = useState(() =>
    hasValue
      ? formatInstant(value as string | number | Date, {
          mode: effectiveMode,
          options,
          withZone: effectiveWithZone,
          timeZone: "UTC",
        })
      : "",
  );
  const [localized, setLocalized] = useState(false);

  // Reformat in the viewer's timezone after mount (skipped for pinned UTC dates).
  const optionsKey = options ? JSON.stringify(options) : "";
  useEffect(() => {
    if (!hasValue || utc) return;
    setText(
      formatInstant(value as string | number | Date, {
        mode: effectiveMode,
        options,
        withZone: effectiveWithZone,
      }),
    );
    setLocalized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, effectiveMode, optionsKey, effectiveWithZone, hasValue, utc]);

  if (!hasValue) return <span className={className}>{fallback}</span>;

  const title =
    localized || utc
      ? undefined
      : `${formatInstant(value as string | number | Date, {
          mode: effectiveMode,
          options,
          withZone: effectiveWithZone,
          timeZone: "UTC",
        })} (UTC)`;

  return (
    <span className={className} title={title} suppressHydrationWarning>
      {text}
    </span>
  );
}

export default LocalTime;
