import { prisma } from "@dpf/db";
import type { CodeGraphEdgeKind } from "./code-graph/types";
import { CODE_GRAPH_GRAPH_KEY } from "./code-graph/constants";
import type { TrustAssessment } from "@/lib/trust-vector";
import {
  buildCodeGraphCoverageTrust,
  buildCodeGraphFreshnessTrust,
} from "@/lib/trust-vector/adapters/code-graph";

const BENCHMARK_REQUIRED_RELATIONSHIPS = [
  "DEFINES",
  "IMPORTS",
  "IMPLEMENTS_ROUTE",
  "EXPOSES_TOOL",
  "TESTED_BY",
] as const satisfies readonly CodeGraphEdgeKind[];

type BenchmarkRelationship = (typeof BENCHMARK_REQUIRED_RELATIONSHIPS)[number];

export type CodeGraphFreshness = {
  graphKey: string;
  available: boolean;
  indexStatus: string;
  lastIndexedAt: Date | null;
  lastIndexedBranch: string | null;
  lastIndexedHeadSha: string | null;
  workspaceDirty: boolean;
  indexedFileCount: number;
  lastError: string | null;
  relationshipCounts?: Record<BenchmarkRelationship, number>;
  /** Rows actually present in the graph for this key (BI-86EF5900). null = uninspected/unreadable. */
  nodeCount?: number | null;
  edgeCount?: number | null;
  warnings: string[];
  summary: string;
  trust?: TrustAssessment;
};

export type CodeGraphCoverageSummary = {
  graphKey: string;
  available: boolean;
  indexStatus: string;
  indexedFiles: string[];
  unindexedFiles: string[];
  warnings: string[];
  summary: string;
  trust?: TrustAssessment;
};

function buildFreshnessWarnings(input: {
  available: boolean;
  indexStatus: string;
  workspaceDirty: boolean;
  lastError: string | null;
}): string[] {
  const warnings: string[] = [];

  if (!input.available) {
    warnings.push("The code graph has not been built yet.");
    return warnings;
  }

  if (input.indexStatus !== "ready") {
    warnings.push(`The code graph is currently ${input.indexStatus}. Results may be incomplete.`);
  }

  if (input.workspaceDirty) {
    warnings.push("Uncommitted local changes may not be reflected in graph-backed analysis.");
  }

  if (input.lastError) {
    warnings.push(`Last code-graph error: ${input.lastError}`);
  }

  return warnings;
}

function toCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    value &&
    typeof value === "object" &&
    "toNumber" in value &&
    typeof (value as { toNumber: unknown }).toNumber === "function"
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return 0;
}

async function inspectStructuralRelationshipHealth(graphKey: string): Promise<{
  counts: Record<BenchmarkRelationship, number>;
  /**
   * Rows actually present in the graph (BI-86EF5900). `indexedFileCount` reads
   * CodeGraphFileHash — a DIFFERENT table — so it cannot fall when the graph
   * empties. Measured live 2026-08-23: 4406 file hashes, 0 nodes, 0 edges,
   * status "ready". These are the counts that can.
   */
  nodeCount: number | null;
  edgeCount: number | null;
  warnings: string[];
}> {
  const counts = Object.fromEntries(
    BENCHMARK_REQUIRED_RELATIONSHIPS.map((relationship) => [relationship, 0]),
  ) as Record<BenchmarkRelationship, number>;

  let nodeCount: number | null = null;
  let edgeCount: number | null = null;

  try {
    // ONE raw call: benchmark relationship counts AND total population, so the
    // file keeps a single raw-SQL site and one round trip.
    const rows = (await prisma.$queryRawUnsafe(
      [
        "SELECT 'rel' AS kind, rel_type AS label, count(*)::int AS count",
        "  FROM graph_edge",
        " WHERE props->>'graphKey' = $1 AND rel_type = ANY($2::text[])",
        " GROUP BY rel_type",
        " UNION ALL",
        "SELECT 'pop', 'nodes', (SELECT count(*)::int FROM graph_node WHERE props->>'graphKey' = $1)",
        " UNION ALL",
        "SELECT 'pop', 'edges', (SELECT count(*)::int FROM graph_edge WHERE props->>'graphKey' = $1)",
      ].join("\n"),
      graphKey,
      [...BENCHMARK_REQUIRED_RELATIONSHIPS],
    )) as Array<{ kind?: unknown; label?: unknown; count?: unknown }>;

    for (const row of rows) {
      const label = row.label;
      if (typeof label !== "string") continue;
      if (row.kind === "pop") {
        if (label === "nodes") nodeCount = toCount(row.count);
        if (label === "edges") edgeCount = toCount(row.count);
        continue;
      }
      if (BENCHMARK_REQUIRED_RELATIONSHIPS.includes(label as BenchmarkRelationship)) {
        counts[label as BenchmarkRelationship] = toCount(row.count);
      }
    }
  } catch (error) {
    return {
      counts,
      nodeCount: null,
      edgeCount: null,
      warnings: [
        `Could not inspect code graph relationship health: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      ],
    };
  }

  const missing = BENCHMARK_REQUIRED_RELATIONSHIPS.filter((relationship) => counts[relationship] === 0);
  const warnings: string[] = [];
  if (nodeCount === 0) {
    warnings.push(
      "Code graph holds ZERO nodes for this graphKey — the projection is empty, not merely " +
        "stale. Every query returns nothing regardless of what exists in the tree; an empty " +
        "result is NO EVIDENCE of absence.",
    );
  } else if (edgeCount === 0) {
    warnings.push(
      "Code graph holds nodes but ZERO edges — a file index, not a graph. It cannot answer " +
        "what-uses-this questions.",
    );
  }
  if (missing.length > 0) {
    warnings.push(`Code graph structural relationships are missing: ${missing.join(", ")}.`);
  }
  return { counts, nodeCount, edgeCount, warnings };
}

export async function getCodeGraphFreshness(
  graphKey = CODE_GRAPH_GRAPH_KEY,
  options: { inspectStructuralHealth?: boolean; now?: Date } = {},
): Promise<CodeGraphFreshness> {
  const state = await prisma.codeGraphIndexState.findUnique({
    where: { graphKey },
  });

  if (!state) {
    const trust = buildCodeGraphFreshnessTrust({
      graphKey,
      available: false,
      indexStatus: "missing",
      lastIndexedAt: null,
      workspaceDirty: false,
      indexedFileCount: 0,
      lastError: null,
      asOf: options.now,
    });

    return {
      graphKey,
      available: false,
      indexStatus: "missing",
      lastIndexedAt: null,
      lastIndexedBranch: null,
      lastIndexedHeadSha: null,
      workspaceDirty: false,
      indexedFileCount: 0,
      lastError: null,
      warnings: ["The code graph has not been built yet."],
      summary: "Code graph has not been built yet for this workspace.",
      trust,
    };
  }

  const relationshipHealth = options.inspectStructuralHealth
    ? await inspectStructuralRelationshipHealth(graphKey)
    : null;

  const warnings = [
    ...buildFreshnessWarnings({
    available: true,
    indexStatus: state.indexStatus,
    workspaceDirty: state.workspaceDirty,
    lastError: state.lastError,
    }),
    ...(relationshipHealth?.warnings ?? []),
  ];

  const summary = [
    `Code graph is ${state.indexStatus} for ${state.indexedFileCount} indexed files.`,
    state.lastIndexedHeadSha
      ? `Current snapshot: ${state.lastIndexedHeadSha}${state.lastIndexedBranch ? ` on ${state.lastIndexedBranch}` : ""}.`
      : "No indexed commit recorded yet.",
    ...warnings,
  ].join(" ");
  const trust = buildCodeGraphFreshnessTrust({
    graphKey,
    available: true,
    indexStatus: state.indexStatus,
    lastIndexedAt: state.lastIndexedAt,
    workspaceDirty: state.workspaceDirty,
    indexedFileCount: state.indexedFileCount,
    lastError: state.lastError,
    // BI-6CFC5429: let freshness see WHICH ref was indexed, not just when.
    lastIndexedBranch: state.lastIndexedBranch,
    ...(relationshipHealth ? { relationshipCounts: relationshipHealth.counts } : {}),
    ...(relationshipHealth ? { nodeCount: relationshipHealth.nodeCount, edgeCount: relationshipHealth.edgeCount } : {}),
    asOf: options.now,
  });

  return {
    graphKey,
    available: true,
    indexStatus: state.indexStatus,
    lastIndexedAt: state.lastIndexedAt,
    lastIndexedBranch: state.lastIndexedBranch,
    lastIndexedHeadSha: state.lastIndexedHeadSha,
    workspaceDirty: state.workspaceDirty,
    indexedFileCount: state.indexedFileCount,
    lastError: state.lastError,
    ...(relationshipHealth ? { relationshipCounts: relationshipHealth.counts } : {}),
    ...(relationshipHealth ? { nodeCount: relationshipHealth.nodeCount, edgeCount: relationshipHealth.edgeCount } : {}),
    warnings,
    summary,
    trust,
  };
}

export async function summarizeCodeGraphCoverage(
  filePaths: string[],
  graphKey = CODE_GRAPH_GRAPH_KEY,
  options: { now?: Date } = {},
): Promise<CodeGraphCoverageSummary> {
  const freshness = await getCodeGraphFreshness(graphKey, { now: options.now });
  const uniquePaths = [...new Set(filePaths.filter(Boolean))];

  if (!freshness.available || uniquePaths.length === 0) {
    const trust = buildCodeGraphCoverageTrust({
      graphKey,
      available: freshness.available,
      indexStatus: freshness.indexStatus,
      indexedFileCount: 0,
      totalFileCount: uniquePaths.length,
      warnings: freshness.warnings,
      asOf: options.now,
    });

    return {
      graphKey,
      available: freshness.available,
      indexStatus: freshness.indexStatus,
      indexedFiles: [],
      unindexedFiles: uniquePaths,
      warnings: freshness.warnings,
      summary: uniquePaths.length === 0
        ? "No changed files were available for code-graph coverage analysis."
        : freshness.summary,
      trust,
    };
  }

  const rows = await prisma.codeGraphFileHash.findMany({
    where: {
      graphKey,
      filePath: { in: uniquePaths },
    },
    select: {
      filePath: true,
    },
  });

  const indexedFiles = rows.map((row) => row.filePath).sort();
  const indexedSet = new Set(indexedFiles);
  const unindexedFiles = uniquePaths.filter((filePath) => !indexedSet.has(filePath)).sort();

  return {
    graphKey,
    available: true,
    indexStatus: freshness.indexStatus,
    indexedFiles,
    unindexedFiles,
    warnings: freshness.warnings,
    summary: `Code graph covers ${indexedFiles.length}/${uniquePaths.length} changed files at the current indexed commit.`,
    trust: buildCodeGraphCoverageTrust({
      graphKey,
      available: true,
      indexStatus: freshness.indexStatus,
      indexedFileCount: indexedFiles.length,
      totalFileCount: uniquePaths.length,
      warnings: freshness.warnings,
      asOf: options.now,
    }),
  };
}
