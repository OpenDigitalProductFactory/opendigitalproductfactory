import { prisma } from "@dpf/db";
import { CODE_GRAPH_GRAPH_KEY } from "./code-graph-refresh";

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
  warnings: string[];
  summary: string;
};

export type CodeGraphCoverageSummary = {
  graphKey: string;
  available: boolean;
  indexStatus: string;
  indexedFiles: string[];
  unindexedFiles: string[];
  warnings: string[];
  summary: string;
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

export async function getCodeGraphFreshness(
  graphKey = CODE_GRAPH_GRAPH_KEY,
): Promise<CodeGraphFreshness> {
  const state = await prisma.codeGraphIndexState.findUnique({
    where: { graphKey },
  });

  if (!state) {
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
    };
  }

  const warnings = buildFreshnessWarnings({
    available: true,
    indexStatus: state.indexStatus,
    workspaceDirty: state.workspaceDirty,
    lastError: state.lastError,
  });

  const summary = [
    `Code graph is ${state.indexStatus} for ${state.indexedFileCount} indexed files.`,
    state.lastIndexedHeadSha
      ? `Current snapshot: ${state.lastIndexedHeadSha}${state.lastIndexedBranch ? ` on ${state.lastIndexedBranch}` : ""}.`
      : "No indexed commit recorded yet.",
    ...warnings,
  ].join(" ");

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
    warnings,
    summary,
  };
}

export async function summarizeCodeGraphCoverage(
  filePaths: string[],
  graphKey = CODE_GRAPH_GRAPH_KEY,
): Promise<CodeGraphCoverageSummary> {
  const freshness = await getCodeGraphFreshness(graphKey);
  const uniquePaths = [...new Set(filePaths.filter(Boolean))];

  if (!freshness.available || uniquePaths.length === 0) {
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
  };
}
