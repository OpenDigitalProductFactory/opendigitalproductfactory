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
  /** Rule name and the raw entity, kept separate from the composed title so a
   *  persist step can resolve an actor entity to a name (BI-7D1EC4B9). */
  ruleName: string;
  entityKey: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface CaseCandidate {
  caseKey: string;
  scopeKey: string;
  customerAccountId: string | null;
  customerSiteId: string | null;
  title: string;
  /** The winning detection's rule name and raw entity, so the persist step can
   *  re-render the title with a resolved actor label (BI-7D1EC4B9). "unknown"
   *  entityKey means the detection carried no asset/actor. */
  ruleName: string;
  entityKey: string;
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
        ruleName: d.ruleName,
        entityKey: d.entityKey,
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
      existing.ruleName = d.ruleName;
      existing.entityKey = d.entityKey;
      titleRank.set(d.groupingKey, rank);
    }
  }

  // Stable output order: by caseKey.
  return [...byKey.values()].sort((a, b) => a.caseKey.localeCompare(b.caseKey));
}

// ── Persisted-detection → grouping input (the sweep's bridge) ────────────────
//
// The correlation sweep stores the matched entity on each Detection's enrichment
// (entityKey) plus the rule's name + ATT&CK techniques. These pure helpers turn a
// persisted Detection row back into a `DetectionForGrouping` so the sweep can
// group OPEN, un-cased detections into cases (the spec's Detection --> Case edge,
// §6.4) without re-joining to the source events.

/** Enrichment fields the grouping bridge reads off a Detection row. */
export interface DetectionEnrichmentForGrouping {
  ruleKey?: string;
  ruleName?: string;
  mitreTechniques?: string[];
  /** The asset/actor the detection is about (hostname, user, account). */
  entityKey?: string;
}

export interface DetectionRowForGrouping {
  detectionKey: string;
  scopeKey: string;
  customerAccountId: string | null;
  customerSiteId: string | null;
  severity: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  enrichment: DetectionEnrichmentForGrouping | null;
}

/**
 * The grouping family — what KIND of activity the case is about. Primary ATT&CK
 * technique when known (so e.g. all credential-access on a host coalesce), else
 * the rule pack/key. Stable: the same rule always yields the same family.
 */
export function detectionFamily(enr: DetectionEnrichmentForGrouping): string {
  const technique = enr.mitreTechniques?.[0];
  if (technique) return `attack:${technique}`;
  return enr.ruleKey ? `rule:${enr.ruleKey}` : "uncategorized";
}

/**
 * Map a persisted Detection row to the pure grouping input. entityKey defaults to
 * "unknown" (detections still group by scope + family); the title prefers the
 * rule name, qualified by the entity when known.
 */
export function detectionRowToGroupingInput(
  row: DetectionRowForGrouping,
): DetectionForGrouping {
  const enr = row.enrichment ?? {};
  const entityKey = enr.entityKey && enr.entityKey.length ? enr.entityKey : "unknown";
  const family = detectionFamily(enr);
  const ruleName = enr.ruleName ?? enr.ruleKey ?? "Security detection";
  const title = entityKey !== "unknown" ? `${ruleName} — ${entityKey}` : ruleName;
  return {
    detectionKey: row.detectionKey,
    scopeKey: row.scopeKey,
    customerAccountId: row.customerAccountId,
    customerSiteId: row.customerSiteId,
    severity: row.severity,
    groupingKey: deriveGroupingKey({ scopeKey: row.scopeKey, entityKey, family }),
    title,
    ruleName,
    entityKey,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
  };
}
