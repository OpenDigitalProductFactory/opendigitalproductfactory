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
//   - drift — a canonical ("golden") decision whose winner flipped, or whose
//     margin collapsed toward a coin-flip, under the current corpus (spec §4.3)
//   - weight-proposal — an inferred WeightAdjustmentProposal (BI-D88DFEEA):
//     the org's recorded decisions systematically separate from the kernel's
//     recommendation on one axis. Never auto-applied; a human accepts (→
//     ruled) or rejects it here.

export type FindingClass = "conflict" | "gap" | "staleness" | "drift" | "weight-proposal";

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
  /**
   * When set, the finding is a weight-adjustment proposal (BI-D88DFEEA):
   * rule on it inline via ruleWeightProposal (accept → ruled, reject →
   * rejected) instead of navigating to actionHref.
   */
  weightProposal?: {
    proposalId: string;
    axis: string;
    direction: string;
    consistency: number;
    meanSeparation: number;
    sampleSize: number;
  };
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

/**
 * A canonical decision that has drifted under the current corpus — mapped by the
 * page from `evaluateGoldenDrift`, so this module stays free of the decision
 * engine and remains a pure findings builder.
 */
export type DriftRow = {
  scenarioId: string;
  rationale: string;
  expectedWinner: string;
  actualWinner: string;
  margin: number;
  marginFloor: number;
  driftKind: "flip" | "thin-margin";
};

/** An open (status="proposed") WeightAdjustmentProposal row (BI-D88DFEEA). */
export type WeightProposalRow = {
  proposalId: string;
  domainClass: string;
  axis: string;
  direction: string;
  consistency: number;
  meanSeparation: number;
  sampleSize: number;
};

function humanAxis(axis: string): string {
  return axis.split("_").filter(Boolean).join(" ");
}

export function buildWeightProposalFindings(rows: WeightProposalRow[]): ReviewFinding[] {
  return rows.map((row) => ({
    id: `weight-proposal:${row.proposalId}`,
    findingClass: "weight-proposal" as const,
    title: `${humanDomain(row.domainClass)} decisions consistently ${row.direction} ${humanAxis(row.axis)}`,
    detail:
      `Across ${row.sampleSize} recorded decisions, the chosen option separated from the kernel's `
      + `recommendation on this axis ${Math.round(row.consistency * 100)}% of the time it separated at all `
      + `(mean separation ${row.meanSeparation.toFixed(2)}). Never auto-applied — rule on it to promote or reject.`,
    postureLabel: `${row.sampleSize} decisions`,
    count: row.sampleSize,
    href: null,
    actionLabel: "Rule on this",
    actionHref: "",
    weightProposal: {
      proposalId: row.proposalId,
      axis: row.axis,
      direction: row.direction,
      consistency: row.consistency,
      meanSeparation: row.meanSeparation,
      sampleSize: row.sampleSize,
    },
  }));
}

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

function humanOption(optionId: string): string {
  return optionId.split("-").filter(Boolean).join(" ");
}

export function buildDriftFindings(rows: DriftRow[]): ReviewFinding[] {
  return rows.map((row) => {
    const flip = row.driftKind === "flip";
    const detail = flip
      ? `${row.rationale} It used to land on "${humanOption(row.expectedWinner)}"; the current doctrine now favors "${humanOption(row.actualWinner)}".`
      : `${row.rationale} "${humanOption(row.expectedWinner)}" still wins, but the call is now near-tied (margin ${row.margin.toFixed(2)}, floor ${row.marginFloor.toFixed(2)}).`;
    return {
      id: `drift:${row.scenarioId}`,
      findingClass: "drift",
      title: flip
        ? "A doctrine change flipped a canonical decision"
        : "A canonical decision is down to a coin-flip",
      detail: truncate(detail, 200),
      postureLabel: `margin ${row.margin.toFixed(2)}`,
      count: 1,
      href: null,
      // The fix is to revisit a dimension or the principle aggregate, not to
      // hand-edit one decision — send the operator to the criteria (matrix).
      actionLabel: "Review the criteria",
      actionHref: "/coworker-decisions/matrix",
    };
  });
}

/**
 * Assemble the ordered findings list. Conflicts first (they actively misfire),
 * then drift (a canonical call has silently changed), then gaps by descending
 * cluster size (the biggest coverage holes first), then staleness (housekeeping).
 */
export function buildReviewFindings(input: {
  conflicts: ConflictRow[];
  drift?: DriftRow[];
  gapClusters: GapCluster[];
  staleMaterial?: StaleMaterialSummary;
  weightProposals?: WeightProposalRow[];
}): ReviewFinding[] {
  const conflicts = buildConflictFindings(input.conflicts);
  const drift = input.drift ? buildDriftFindings(input.drift) : [];
  const gaps = buildGapFindings(input.gapClusters).sort(
    (a, b) => b.count - a.count,
  );
  const staleness = input.staleMaterial
    ? buildStalenessFindings(input.staleMaterial)
    : [];
  const weightProposals = input.weightProposals
    ? buildWeightProposalFindings(input.weightProposals)
    : [];
  return [...conflicts, ...drift, ...gaps, ...weightProposals, ...staleness];
}
