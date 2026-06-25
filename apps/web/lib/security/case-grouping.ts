// EP-SOVEREIGN-SOC P2 — detection → SecurityCase grouping (pure).
//
// Spec: docs/superpowers/specs/2026-06-24-sovereign-soc-siem-design.md §6.4, §7.1.
//
// Detections group into cases by scope + entity (asset/actor) + family
// (ATT&CK tactic or rule pack). The grouping key is STABLE so a re-run merges
// new detections into the same case rather than spawning duplicates — the same
// idempotency discipline the sweep uses for detections. Pure of Prisma: the
// caller derives the per-detection grouping inputs from the event, then groups.

export type CaseSeverity = "info" | "low" | "medium" | "high" | "critical";

const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** Return the higher-ranked of two severities (unknown ranks as info). */
export function maxSeverity(a: string, b: string): string {
  return (SEVERITY_RANK[a] ?? 0) >= (SEVERITY_RANK[b] ?? 0) ? a : b;
}

/**
 * Stable grouping key. The same (scope, entity, family) always yields the same
 * key, so the case it maps to is deterministic across sweep cycles. `entityKey`
 * is the asset or actor the detection is about (hostname, user, account); when
 * unknown the caller passes "unknown" and detections still group by scope+family.
 */
export function deriveGroupingKey(parts: {
  scopeKey: string;
  entityKey: string;
  family: string;
}): string {
  return `${parts.scopeKey}|${parts.entityKey}|${parts.family}`;
}

export interface DetectionForGrouping {
  detectionKey: string;
  scopeKey: string;
  customerAccountId: string | null;
  customerSiteId: string | null;
  severity: string;
  /** From deriveGroupingKey — computed by the caller from the matched event. */
  groupingKey: string;
  /** Short title for the case (highest-severity detection's title wins). */
  title: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface CaseCandidate {
  caseKey: string;
  scopeKey: string;
  customerAccountId: string | null;
  customerSiteId: string | null;
  title: string;
  severity: string;
  detectionKeys: string[];
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/**
 * Group detections into case candidates by their stable grouping key. Severity
 * is the max across grouped detections; the window spans their first/last seen;
 * the title comes from the highest-severity detection. Deterministic — feeding
 * the same detections (in any order) yields the same candidates.
 */
export function groupDetectionsIntoCases(
  detections: DetectionForGrouping[],
): CaseCandidate[] {
  const byKey = new Map<string, CaseCandidate>();
  // Track the severity that "won" each candidate's title so a later
  // higher-severity detection can override it deterministically.
  const titleRank = new Map<string, number>();

  for (const d of detections) {
    const existing = byKey.get(d.groupingKey);
    const rank = SEVERITY_RANK[d.severity] ?? 0;
    if (!existing) {
      byKey.set(d.groupingKey, {
        caseKey: `case:${d.groupingKey}`,
        scopeKey: d.scopeKey,
        customerAccountId: d.customerAccountId,
        customerSiteId: d.customerSiteId,
        title: d.title,
        severity: d.severity,
        detectionKeys: [d.detectionKey],
        firstSeenAt: d.firstSeenAt,
        lastSeenAt: d.lastSeenAt,
      });
      titleRank.set(d.groupingKey, rank);
      continue;
    }
    existing.detectionKeys.push(d.detectionKey);
    existing.severity = maxSeverity(existing.severity, d.severity);
    if (d.firstSeenAt < existing.firstSeenAt) existing.firstSeenAt = d.firstSeenAt;
    if (d.lastSeenAt > existing.lastSeenAt) existing.lastSeenAt = d.lastSeenAt;
    // A strictly-higher-severity detection takes the title (deterministic:
    // ties keep the earlier title).
    if (rank > (titleRank.get(d.groupingKey) ?? 0)) {
      existing.title = d.title;
      titleRank.set(d.groupingKey, rank);
    }
  }

  // Stable output order: by caseKey.
  return [...byKey.values()].sort((a, b) => a.caseKey.localeCompare(b.caseKey));
}
