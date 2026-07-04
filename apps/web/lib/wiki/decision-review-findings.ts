// EP-0AF96937 Phase 2: derive Decision Review findings from the accumulating
// decision ledger.
//
// A findings surface, not a log firehose (spec §4.3). This module is pure —
// the page queries the `DecisionInteraction` ledger and passes already-shaped
// rows/clusters in, so the builders are unit testable and do no DB work.
//
// v1 surfaces the two finding classes that are directly computable from
// recorded fields today:
//   - conflict — a decision the gate flagged as `principleConflict` (two
//     principles/materials pulling opposite ways)
//   - gap — a cluster of `defer`/`escalate` outcomes in one decision domain,
//     i.e. the doctrine has no settled answer there yet
// Drift (golden-decision flips) and staleness (stale-but-cited material) are
// tracked as later sub-slices; see the spec.

export type FindingClass = "conflict" | "gap";

export type ReviewFinding = {
  id: string;
  findingClass: FindingClass;
  title: string;
  detail: string;
  /** Plain-language posture/risk context for the decision(s), when known. */
  postureLabel: string | null;
  /** How many decisions this finding rolls up (gap clusters); 1 for a single conflict. */
  count: number;
  /** Deep-link to the Decision Canvas for a single decision, when applicable. */
  href: string | null;
  /** The plain-language action this finding invites. */
  actionLabel: string;
  /** Where the action goes (e.g. the review queue, the stance editor). */
  actionHref: string;
};

/** A single gate decision the ledger flagged as a principle conflict. */
export type ConflictRow = {
  interactionId: string;
  question: string;
  riskTier: string | null;
  createdAt: Date;
};

/** A rolled-up cluster of unresolved (defer/escalate) decisions in one domain. */
export type GapCluster = {
  domainClass: string;
  count: number;
  /** A representative question from the cluster, for human context. */
  sampleQuestion: string;
};

function riskPosture(riskTier: string | null): string | null {
  if (!riskTier) return null;
  return `risk: ${riskTier}`;
}

function truncate(text: string, max = 120): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function humanDomain(domainClass: string): string {
  return domainClass
    .split("-")
    .filter(Boolean)
    .join(" ");
}

export function buildConflictFindings(rows: ConflictRow[]): ReviewFinding[] {
  return rows.map((row) => ({
    id: `conflict:${row.interactionId}`,
    findingClass: "conflict",
    title: "Two principles pull opposite ways",
    detail: truncate(row.question),
    postureLabel: riskPosture(row.riskTier),
    count: 1,
    href: `/platform/ai/decisions/${encodeURIComponent(row.interactionId)}`,
    actionLabel: "De-conflict",
    actionHref: `/platform/ai/decisions/${encodeURIComponent(row.interactionId)}`,
  }));
}

export function buildGapFindings(clusters: GapCluster[]): ReviewFinding[] {
  return clusters
    .filter((c) => c.count > 0)
    .map((cluster) => ({
      id: `gap:${cluster.domainClass}`,
      findingClass: "gap",
      title: `No settled answer for ${humanDomain(cluster.domainClass)}`,
      detail: truncate(cluster.sampleQuestion),
      postureLabel:
        cluster.count === 1 ? "1 unresolved" : `${cluster.count} unresolved`,
      count: cluster.count,
      href: null,
      actionLabel: "Add a stance",
      actionHref: "/wiki/perspectives",
    }));
}

/**
 * Assemble the ordered findings list. Conflicts first (they actively misfire),
 * then gaps by descending cluster size (the biggest coverage holes first).
 */
export function buildReviewFindings(input: {
  conflicts: ConflictRow[];
  gapClusters: GapCluster[];
}): ReviewFinding[] {
  const conflicts = buildConflictFindings(input.conflicts);
  const gaps = buildGapFindings(input.gapClusters).sort(
    (a, b) => b.count - a.count,
  );
  return [...conflicts, ...gaps];
}
