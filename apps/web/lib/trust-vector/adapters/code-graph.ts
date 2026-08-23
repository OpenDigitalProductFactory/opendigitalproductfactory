import { scoreTrustVector } from "@/lib/trust-vector/score";
import type { TrustAssessment, TrustDimensionInput } from "@/lib/trust-vector/types";
import { OFF_DEFAULT_BRANCH_FRESHNESS_CAP, isOffDefaultBranch } from "@/lib/trust-vector/default-branch";

type CodeGraphFreshnessTrustInput = {
  graphKey: string;
  available: boolean;
  indexStatus: string;
  lastIndexedAt: Date | string | null;
  workspaceDirty: boolean;
  indexedFileCount: number;
  lastError: string | null;
  relationshipCounts?: Record<string, number>;
  /**
   * Rows actually present in the graph (BI-86EF5900). `indexedFileCount` reads
   * CodeGraphFileHash, a different table, so it stays high while the graph is
   * empty — measured live: 4406 "indexed files", 0 nodes, 0 edges, status
   * "ready". These are the counts that can actually fall to zero.
   */
  nodeCount?: number | null;
  edgeCount?: number | null;
  /**
   * Branch the index was built from (BI-6CFC5429). Freshness previously scored
   * only how recently the INDEXER RAN, not how old the CONTENT it indexed was —
   * so re-indexing a 10-week-old branch every hour scored a permanent 1.0/high.
   * Observed live 2026-08-19: `my-changes` @ 2026-06-08 reporting "high".
   */
  lastIndexedBranch?: string | null;
  asOf?: Date | string;
};

/**
 * Off-default-branch vocabulary now lives in ../default-branch so the
 * committed-source adapter scores a side branch identically (SSoT).
 */
const indexedOffDefaultBranch = isOffDefaultBranch;

type CodeGraphCoverageTrustInput = {
  graphKey: string;
  available: boolean;
  indexStatus: string;
  indexedFileCount: number;
  totalFileCount: number;
  warnings: string[];
  asOf?: Date | string;
};

export function buildCodeGraphFreshnessTrust(
  input: CodeGraphFreshnessTrustInput,
): TrustAssessment {
  const asOf = toDate(input.asOf) ?? new Date();
  const dimensions: TrustDimensionInput[] = [
    buildFreshnessDimension(input, asOf),
    buildRuntimeDimension(input),
    {
      key: "sourceAuthority",
      label: "Source authority",
      score: input.available && input.indexedFileCount > 0 ? 0.9 : 0.6,
      rationale: input.available
        ? "CodeGraphIndexState is the authoritative source for graph index freshness."
        : "No CodeGraphIndexState row exists for this graph.",
      evidenceRefs: [{
        kind: "prisma-row",
        label: "CodeGraphIndexState",
        ref: input.graphKey,
        sourceTable: "CodeGraphIndexState",
      }],
    },
  ];

  if (input.relationshipCounts) {
    dimensions.push(buildStructuralHealthDimension(input.relationshipCounts));
  }
  if (input.nodeCount !== undefined) {
    dimensions.push(buildPopulationDimension(input.nodeCount, input.edgeCount ?? null));
  }

  return scoreTrustVector({
    subject: {
      type: "code-graph",
      id: input.graphKey,
      label: "Code graph",
    },
    asOf: asOf.toISOString(),
    dimensions,
    riskLevel: input.available ? "medium" : "high",
    sourceSummary: "Code graph trust is derived from index state, runtime health, and optional relationship coverage.",
  });
}

export function buildCodeGraphCoverageTrust(
  input: CodeGraphCoverageTrustInput,
): TrustAssessment {
  const asOf = toDate(input.asOf) ?? new Date();
  const coverageScore = input.totalFileCount === 0
    ? null
    : input.indexedFileCount / input.totalFileCount;
  const dimensions: TrustDimensionInput[] = [
    {
      key: "coverageCompleteness",
      label: "Changed-file coverage",
      score: coverageScore,
      weight: 2,
      rationale: input.totalFileCount === 0
        ? "No changed files were available for code-graph coverage analysis."
        : `Code graph covers ${input.indexedFileCount}/${input.totalFileCount} changed files.`,
      evidenceRefs: [{
        kind: "prisma-row",
        label: "CodeGraphFileHash",
        ref: input.graphKey,
        sourceTable: "CodeGraphFileHash",
      }],
    },
    {
      key: "runtimeAvailability",
      label: "Runtime availability",
      score: input.available && input.indexStatus === "ready" ? 1 : 0.3,
      rationale: input.available
        ? `Code graph index status is ${input.indexStatus}.`
        : "The code graph has not been built yet.",
      evidenceRefs: [],
    },
    {
      key: "sourceAuthority",
      label: "Source authority",
      score: input.available ? 0.85 : 0.4,
      rationale: "CodeGraphFileHash is the committed-file coverage source for changed files.",
      evidenceRefs: [],
    },
  ];

  return scoreTrustVector({
    subject: {
      type: "code-graph-coverage",
      id: input.graphKey,
      label: "Code graph coverage",
    },
    asOf: asOf.toISOString(),
    dimensions,
    sourceSummary: "Coverage trust is derived from changed files present in CodeGraphFileHash.",
  });
}

function buildFreshnessDimension(
  input: CodeGraphFreshnessTrustInput,
  asOf: Date,
): TrustDimensionInput {
  if (!input.available) {
    return {
      key: "freshness",
      label: "Freshness",
      score: 0.1,
      weight: 2,
      rationale: "The code graph has not been built yet.",
      evidenceRefs: [],
    };
  }

  if (input.workspaceDirty) {
    return {
      key: "freshness",
      label: "Freshness",
      score: 0.2,
      weight: 2,
      rationale: "Uncommitted local changes may not be reflected in graph-backed analysis.",
      evidenceRefs: [],
    };
  }

  const indexedAt = toDate(input.lastIndexedAt);
  if (!indexedAt) {
    return {
      key: "freshness",
      label: "Freshness",
      score: 0.2,
      weight: 2,
      rationale: "No indexed commit timestamp is recorded for the code graph.",
      evidenceRefs: [],
    };
  }

  const ageMs = Math.max(0, asOf.getTime() - indexedAt.getTime());
  const ageHours = ageMs / (1000 * 60 * 60);
  const ageDays = Math.floor(ageHours / 24);

  // BI-6CFC5429: a recent index of the WRONG tree is not fresh. Recency is only
  // evidence of freshness when the indexed ref is the one everyone builds
  // against — otherwise the score describes the indexer's cron, not the code.
  if (indexedOffDefaultBranch(input.lastIndexedBranch)) {
    return {
      key: "freshness",
      label: "Freshness",
      score: Math.min(OFF_DEFAULT_BRANCH_FRESHNESS_CAP, ageHours <= 24 ? 0.4 : 0.2),
      weight: 2,
      rationale:
        `Code graph was indexed from branch "${input.lastIndexedBranch}", not the default branch — `
        + "recency does not establish that its content matches the tree builds edit.",
      measuredAt: indexedAt.toISOString(),
      evidenceRefs: [],
    };
  }

  if (ageHours <= 24) {
    return {
      key: "freshness",
      label: "Freshness",
      score: 1,
      weight: 2,
      rationale: "Code graph was indexed within the last 24 hours.",
      measuredAt: indexedAt.toISOString(),
      evidenceRefs: [],
    };
  }

  if (ageDays <= 7) {
    return {
      key: "freshness",
      label: "Freshness",
      score: 0.7,
      weight: 2,
      rationale: `Code graph index is ${ageDays} ${ageDays === 1 ? "day" : "days"} old.`,
      measuredAt: indexedAt.toISOString(),
      evidenceRefs: [],
    };
  }

  return {
    key: "freshness",
    label: "Freshness",
    score: 0.2,
    weight: 2,
    rationale: `Code graph index is ${ageDays} ${ageDays === 1 ? "day" : "days"} old.`,
    measuredAt: indexedAt.toISOString(),
    evidenceRefs: [],
  };
}

function buildRuntimeDimension(input: CodeGraphFreshnessTrustInput): TrustDimensionInput {
  if (!input.available) {
    return {
      key: "runtimeAvailability",
      label: "Runtime availability",
      score: 0.7,
      rationale: "Code graph runtime responded, but no index state exists yet.",
      evidenceRefs: [],
    };
  }

  if (input.lastError) {
    return {
      key: "runtimeAvailability",
      label: "Runtime availability",
      score: 0.3,
      rationale: `Last code-graph error: ${input.lastError}`,
      evidenceRefs: [],
    };
  }

  if (input.indexStatus !== "ready") {
    return {
      key: "runtimeAvailability",
      label: "Runtime availability",
      score: 0.3,
      rationale: `The code graph is currently ${input.indexStatus}.`,
      evidenceRefs: [],
    };
  }

  return {
    key: "runtimeAvailability",
    label: "Runtime availability",
    score: 1,
    rationale: "The code graph index is ready.",
    evidenceRefs: [],
  };
}

function buildStructuralHealthDimension(
  relationshipCounts: Record<string, number>,
): TrustDimensionInput {
  const values = Object.values(relationshipCounts);
  const presentCount = values.filter((count) => count > 0).length;
  const totalCount = values.length;
  const score = totalCount === 0 ? null : presentCount / totalCount;

  return {
    key: "toolReliability",
    label: "Structural relationship health",
    score,
    rationale: totalCount === 0
      ? "No structural relationship benchmark was available."
      : `Code graph has ${presentCount}/${totalCount} benchmark relationship types populated.`,
    evidenceRefs: [],
  };
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Coverage scored from what the graph actually HOLDS, not from how many files a
 * bookkeeping table remembers. An empty projection scores 0 here, which drags
 * the composite down and flips the action to `qualify` — so a graph that is
 * "ready" for 4406 files but holds nothing can no longer present as healthy.
 */
function buildPopulationDimension(
  nodeCount: number | null,
  edgeCount: number | null,
): TrustDimensionInput {
  if (nodeCount === null) {
    return {
      key: "coverageCompleteness",
      label: "Graph population",
      score: null,
      weight: 2,
      rationale: "Graph population could not be inspected, so coverage is unknown.",
      evidenceRefs: [],
    };
  }
  if (nodeCount === 0) {
    return {
      key: "coverageCompleteness",
      label: "Graph population",
      score: 0,
      weight: 2,
      rationale:
        "Graph holds 0 nodes for this key — the projection is EMPTY, not stale. " +
        "Any empty result is no evidence of absence.",
      evidenceRefs: [
        { kind: "prisma-row", label: "graph_node", ref: "graph_node", sourceTable: "graph_node" },
      ],
    };
  }
  if (edgeCount === 0) {
    return {
      key: "coverageCompleteness",
      label: "Graph population",
      score: 0.35,
      weight: 2,
      rationale:
        `Graph holds ${nodeCount} node(s) but 0 edges — a file index, not a graph. ` +
        "Relationship questions cannot be answered.",
      evidenceRefs: [
        { kind: "prisma-row", label: "graph_edge", ref: "graph_edge", sourceTable: "graph_edge" },
      ],
    };
  }
  return {
    key: "coverageCompleteness",
    label: "Graph population",
    score: 1,
    weight: 2,
    rationale: `Graph holds ${nodeCount} node(s) and ${edgeCount} edge(s).`,
    evidenceRefs: [],
  };
}
