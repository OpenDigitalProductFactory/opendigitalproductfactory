"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  value: string | number | Date | null | undefined;
  className?: string;
  fallback?: string;
};

function parseInstant(value: Props["value"]): Date | null {
  if (value == null || value === "") return null;
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

function deterministicUtcLabel(instant: Date): string {
  return instant.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function formatRelativeTime(value: string | number | Date, nowMs = Date.now()): string {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return "";

  const minutes = Math.max(0, Math.floor((nowMs - instant.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Hydration-safe relative time for server-rendered client components.
 *
 * The first server and browser renders share one deterministic UTC label. Once
 * hydration completes, the label becomes relative to the viewer's clock. This
 * keeps compact operator copy without letting a minute boundary change the
 * text React is reconciling.
 */
export function RelativeTime({ value, className, fallback = "never" }: Props) {
  const instant = useMemo(() => parseInstant(value), [value]);
  const iso = instant?.toISOString() ?? null;
  const initialText = instant ? deterministicUtcLabel(instant) : fallback;
  const [text, setText] = useState(initialText);

  useEffect(() => {
    setText(instant ? formatRelativeTime(instant) : fallback);
  }, [fallback, instant]);

  if (!instant || !iso) return <span className={className}>{fallback}</span>;

  return (
    <time
      aria-label={text}
      className={className}
      dateTime={iso}
      title={deterministicUtcLabel(instant)}
    >
      {text}
    </time>
  );
}
