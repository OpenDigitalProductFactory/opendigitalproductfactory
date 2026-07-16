// ─── Issue-Report Promotion Gate ────────────────────────────────────────────
// BI-51F6A428 — reach-threshold + staging lane before a log signature becomes a
// backlog item.
//
// The PIR treadmill: the log-signature scanner files ONE PlatformIssueReport per
// novel error signature, and (pre-this-change) that first occurrence immediately
// minted a BI-PIR-* backlog item. A single transient blip — a one-cycle Loki
// hiccup, a benign restart line that slipped the filters — therefore became a
// permanent backlog item that a human had to triage and close. This module is
// the safety contract that stops that: a low/medium automated signal must reach
// a recurrence bar (seen enough times, across enough scan windows, and still
// recurring) before it is allowed to project. High/critical signals are never
// held — they project on first occurrence.
//
// Pure + dependency-free so every branch is exhaustively unit-testable without
// Prisma/Inngest, and so the same decision is used identically by the front-door
// writer (createPlatformIssueReport) and the triage projection path.

/** The scanner cadence (log-signature-scanner runs every 15 minutes). A staged
 *  signal must recur across at least this much wall-clock — i.e. two distinct
 *  scan windows — before it can promote. */
export const SCAN_WINDOW_MS = 15 * 60 * 1000;

/** Reach bar: a low/medium signal must be seen in at least this many scan
 *  cycles (occurrenceCount accrues +1 per cycle the signature recurs). */
export const REACH_OCCURRENCE_THRESHOLD = 3;

/** Minimum wall-clock span between the first and last sighting. Guards against a
 *  single-window burst inflating occurrenceCount past the reach bar without the
 *  signal actually persisting across windows. */
export const MIN_SPAN_MS = SCAN_WINDOW_MS;

/** Recency bar: only promote a signal still actively recurring — its last
 *  sighting must be within this window. A signal that crossed the reach bar and
 *  then went quiet is aged out, not promoted. */
export const RECENCY_MS = 60 * 60 * 1000;

/** Aging-out: a staged signal not seen within this window has stopped. It is
 *  expired (no BI) rather than held staged forever. */
export const STAGING_STALE_MS = 60 * 60 * 1000;

/** Per-scan-window cap on NEW signals promoted, so a runaway producer cannot
 *  flood the backlog in a single cycle. High/critical bypass the cap. */
export const MAX_NEW_PROMOTIONS_PER_WINDOW = 25;

/** Severities that always promote on first occurrence — never held (safety). */
const ALWAYS_PROMOTE_SEVERITIES = new Set(["high", "critical"]);

export interface PromotionDecisionInput {
  /** How many scan cycles this signal has been seen (>= 1). */
  occurrenceCount: number;
  /** First sighting of this signal, or null when accrual data is missing. */
  firstSeenAt: Date | null;
  /** Most recent sighting of this signal, or null when accrual data is missing. */
  lastSeenAt: Date | null;
  /** The report's severity (case-insensitive; low | medium | high | critical). */
  severity: string;
  /** The evaluation instant (injected for deterministic tests). */
  now: Date;
}

/**
 * Decide whether a reach-gated issue report may be projected into a backlog item.
 *
 * Policy (CONSERVATIVE — this is the safety contract):
 *  - high/critical severity → ALWAYS promote (return true) on first occurrence.
 *  - low/medium severity → require the reach + recency bar:
 *      • occurrenceCount >= REACH_OCCURRENCE_THRESHOLD, AND
 *      • the first→last span >= MIN_SPAN_MS (spans >= 2 distinct scan windows), AND
 *      • lastSeenAt within RECENCY_MS of now (still actively recurring).
 *    Below the bar → false: the caller holds the report staged so it accrues.
 *
 * Missing accrual timestamps (firstSeenAt/lastSeenAt null) fail closed for
 * low/medium — the report is held, never minted on incomplete data.
 */
export function shouldPromoteIssueReport(input: PromotionDecisionInput): boolean {
  const severity = (input.severity ?? "").toLowerCase();

  // Safety: a serious signal is never held.
  if (ALWAYS_PROMOTE_SEVERITIES.has(severity)) return true;

  // Reach: enough scan cycles.
  if (input.occurrenceCount < REACH_OCCURRENCE_THRESHOLD) return false;

  const first = input.firstSeenAt?.getTime();
  const last = input.lastSeenAt?.getTime();
  if (first == null || last == null) return false;

  // Span: persisted across >= 2 distinct scan windows (not a single-window burst).
  if (last - first < MIN_SPAN_MS) return false;

  // Recency: still recurring.
  if (input.now.getTime() - last > RECENCY_MS) return false;

  return true;
}

/**
 * Decide whether a staged report has stopped recurring and should be aged out
 * (expired with no BI). True when its most recent sighting is older than
 * STAGING_STALE_MS. A report with no sighting timestamps at all is NOT expired
 * (fail-safe: never silently drop a report we cannot reason about).
 */
export function shouldExpireStagedReport(input: {
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  now: Date;
}): boolean {
  const last = input.lastSeenAt?.getTime() ?? input.firstSeenAt?.getTime();
  if (last == null) return false;
  return input.now.getTime() - last > STAGING_STALE_MS;
}
