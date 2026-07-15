// EP-0AF96937 Phase 2: derive Decision Review findings from the accumulating
// decision ledger.
//
// A findings surface, not a log firehose (spec §4.3). This module is pure —
// the page queries the `DecisionInteraction` ledger and passes already-shaped
// rows/clusters in, so the builders are unit testable and do no DB work.
//
// Finding classes computable from recorded fields today:
//   - conflict — a decision the gate flagged as `principleConflict` (two
//     principles/materials pulling opposite ways)
//   - gap — a cluster of `defer`/`escalate` outcomes in one decision domain,
//     i.e. the doctrine has no settled answer there yet
//   - staleness — decision material that has aged out of its freshness window
//     (down-weighted in decisions) yet still governs, so it wants re-validation
// Drift (golden-decision flips) is tracked as a later sub-slice; see the spec.

export type FindingClass = "conflict" | "gap" | "staleness";

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
  /**
   * When set, the finding is answerable inline: the operator answers the
   * representative question once on /coworker-decisions/review and it flows through the qa
   * enricher (the record_org_business_answer path) into the org's WWWD corpus
   * as draft — closing the ask-when-silent loop instead of dead-ending at the
   * manual stance editor. Only org-business gaps (the org's own profile) are
   * answerable; kernel/WWMD gaps keep the stance-editor action.
   */
  answer?: { domainClass: string; question: string };
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
  /**
   * "org" when the deferrals were recorded against the organization's own WWWD
   * profile (the org was silent on a business call) — answerable inline. "kernel"
   * for platform/WWMD deferrals, which route to the stance editor as before.
   */
  scope: "org" | "kernel";
};

/** How much decision material has aged out of its freshness window but still governs. */
export type StaleMaterialSummary = {
  count: number;
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
    .map((cluster) => {
      const base = {
        id: `gap:${cluster.domainClass}`,
        findingClass: "gap" as const,
        detail: truncate(cluster.sampleQuestion),
        postureLabel:
          cluster.count === 1 ? "1 unresolved" : `${cluster.count} unresolved`,
        count: cluster.count,
        href: null,
      };
      if (cluster.scope === "org") {
        // The org itself is silent here — invite a one-time answer that feeds
        // the qa enricher, rather than sending the operator to hand-author a
        // whole stance. This is the ask-when-silent loop closing (BI-3AAB96E9).
        return {
          ...base,
          title: `Your business hasn't weighed in on ${humanDomain(cluster.domainClass)}`,
          actionLabel: "Answer this once",
          actionHref: "",
          answer: {
            domainClass: cluster.domainClass,
            question: cluster.sampleQuestion,
          },
        };
      }
      return {
        ...base,
        title: `No settled answer for ${humanDomain(cluster.domainClass)}`,
        actionLabel: "Add a stance",
        actionHref: "/coworker-decisions/stance",
      };
    });
}

export function buildStalenessFindings(
  summary: StaleMaterialSummary,
): ReviewFinding[] {
  if (summary.count <= 0) return [];
  return [
    {
      id: "staleness:material",
      findingClass: "staleness",
      title:
        summary.count === 1
          ? "1 piece of decision material has gone stale"
          : `${summary.count} pieces of decision material have gone stale`,
      detail:
        "Aged past its freshness window and down-weighted, but still cited when your AI decides. Re-validate or retire it.",
      postureLabel: null,
      count: summary.count,
      href: null,
      actionLabel: "Review material",
      actionHref: "/coworker-decisions/perspectives",
    },
  ];
}

/**
 * Assemble the ordered findings list. Conflicts first (they actively misfire),
 * then gaps by descending cluster size (the biggest coverage holes first),
 * then staleness (housekeeping the doctrine).
 */
export function buildReviewFindings(input: {
  conflicts: ConflictRow[];
  gapClusters: GapCluster[];
  staleMaterial?: StaleMaterialSummary;
}): ReviewFinding[] {
  const conflicts = buildConflictFindings(input.conflicts);
  const gaps = buildGapFindings(input.gapClusters).sort(
    (a, b) => b.count - a.count,
  );
  const staleness = input.staleMaterial
    ? buildStalenessFindings(input.staleMaterial)
    : [];
  return [...conflicts, ...gaps, ...staleness];
}
