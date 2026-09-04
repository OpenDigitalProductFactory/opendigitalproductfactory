// BI-DA37A602 (EP-ASSURANCE-HONESTY): a compliance surface must state the AGE and
// basis of what it shows. ScanStatus coloured on run status alone, so a 36-day-old
// "completed" scan read as a healthy green. This pure helper derives freshness from
// the scan's age so a stale-but-completed scan is surfaced as stale, not passing.

// A regulatory scan older than this is stale — its "completed" result no longer
// reflects the current regulatory picture.
export const SCAN_STALE_AFTER_DAYS = 30;

export type ScanTone = "ok" | "stale" | "failed" | "pending";

export interface ScanFreshness {
  ageDays: number;
  isStale: boolean;
  tone: ScanTone;
  /** Short chip label — the status, qualified by age when stale. */
  chipLabel: string;
  /** Human age, e.g. "today", "1 day ago", "36 days ago". */
  ageLabel: string;
}

export function describeScanFreshness(input: {
  status: string;
  startedAt: Date | string | number;
  now?: Date | number;
}): ScanFreshness {
  const started = new Date(input.startedAt).getTime();
  const now = input.now instanceof Date ? input.now.getTime() : input.now ?? Date.now();
  const ageDays = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 86_400_000)) : 0;
  const ageLabel = ageDays === 0 ? "today" : ageDays === 1 ? "1 day ago" : `${ageDays} days ago`;

  const status = input.status.trim().toLowerCase();
  if (status === "failed") {
    return { ageDays, isStale: false, tone: "failed", chipLabel: "failed", ageLabel };
  }
  if (status !== "completed") {
    return { ageDays, isStale: false, tone: "pending", chipLabel: status || "pending", ageLabel };
  }
  // Completed — but a completed result that is old is not evidence the picture is current.
  const isStale = ageDays > SCAN_STALE_AFTER_DAYS;
  return {
    ageDays,
    isStale,
    tone: isStale ? "stale" : "ok",
    chipLabel: isStale ? `stale · ${ageDays}d` : "completed",
    ageLabel,
  };
}
