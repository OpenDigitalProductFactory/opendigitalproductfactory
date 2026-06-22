// ─── Backlog item origin (source lens for the one Operations surface) ───────
// EP-INTAKE-UNIFY: the origin queues (improvements, capability needs, issue
// reports, signals) were consolidated INTO the backlog, so /ops is the single
// place work is seen and worked. This derives the human-facing ORIGIN of an item
// from its semantic id prefix (set by the shared front door's itemIdPrefix) with
// a fall-back to the coarse intake `source`, so the operator can see — and filter
// by — where each piece of work came from without visiting a separate page.
//
// Pure + dependency-free.

export type BacklogOrigin =
  | "improvement"
  | "capability-need"
  | "issue-report"
  | "signal"
  | "requested"
  | "auto-detected"
  | "unknown";

/** Derive the origin from the semantic itemId prefix (front-door itemIdPrefix),
 *  falling back to the coarse intake source. Prefixes are the canonical signal;
 *  assurance/other front-door items with no prefix fall through to `source`. */
export function backlogItemOrigin(item: { itemId?: string | null; source?: string | null }): BacklogOrigin {
  const id = (item.itemId ?? "").toUpperCase();
  if (id.startsWith("BI-IMP-")) return "improvement";
  if (id.startsWith("BI-CAP-")) return "capability-need";
  if (id.startsWith("BI-PIR-")) return "issue-report";
  if (id.startsWith("BI-SIG-")) return "signal";
  if (item.source === "automated-detection") return "auto-detected";
  if (item.source === "user-request") return "requested";
  return "unknown";
}

export const BACKLOG_ORIGIN_LABEL: Record<BacklogOrigin, string> = {
  improvement: "Improvement",
  "capability-need": "Capability need",
  "issue-report": "Issue report",
  signal: "Signal",
  requested: "Requested",
  "auto-detected": "Auto-detected",
  unknown: "—",
};

/** Stable filter options for the /ops origin lens, in display order. */
export const BACKLOG_ORIGIN_FILTERS: ReadonlyArray<{ value: BacklogOrigin; label: string }> = [
  { value: "improvement", label: "Improvement" },
  { value: "capability-need", label: "Capability need" },
  { value: "issue-report", label: "Issue report" },
  { value: "signal", label: "Signal" },
  { value: "requested", label: "Requested" },
  { value: "auto-detected", label: "Auto-detected" },
];
