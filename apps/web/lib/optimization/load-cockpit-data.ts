// Optimization cockpit loader — BI-D9B58004 (EP-8DC217EB BET-0a).
//
// Projects the consolidation-bet registry onto live architecture surfaces:
// code-graph blast radius (traceCodeSurface per model/tool selector +
// summarizeCodeGraphCoverage per file set), live BacklogItem status, and the
// code-graph freshness/trust banner. Composed by the /ea/capabilities page.
//
// Degrades gracefully: when the code graph is unavailable (fresh install,
// Neo4j down, index never built) every projection is null and the freshness
// warnings explain why — the cockpit renders the registry + live BI status
// and labels the blast-radius columns as unavailable.

import { prisma } from "@dpf/db";

import {
  getCodeGraphFreshness,
  summarizeCodeGraphCoverage,
  type CodeGraphCoverageSummary,
  type CodeGraphFreshness,
} from "@/lib/build/code-graph-access";
import { traceCodeSurface, type CodeSurfaceTraceResult } from "@/lib/build/code-graph";
import { CONSOLIDATION_BETS, type ConsolidationBet } from "./consolidation-bets";

export type BetBacklogStatus = {
  itemId: string;
  status: string | null;
  title: string | null;
};

export type BetBlastRadius = {
  /** Distinct implementation files across all traced model/tool selectors. */
  implementationFileCount: number;
  /** Distinct linked test files across traced selectors. */
  relatedTestCount: number;
  /** Selectors that resolved to a surface node in the graph. */
  tracedSelectorCount: number;
  /** Selectors the graph could not resolve (rename/drift signal). */
  unresolvedSelectors: string[];
};

export type BetFileCoverage = {
  indexedCount: number;
  unindexedCount: number;
};

export type BetProjection = {
  bet: ConsolidationBet;
  backlogItems: BetBacklogStatus[];
  /** null when the code graph is unavailable. */
  blastRadius: BetBlastRadius | null;
  /** null when the code graph is unavailable or the bet lists no files. */
  fileCoverage: BetFileCoverage | null;
};

export type OptimizationCockpitData = {
  freshness: Pick<
    CodeGraphFreshness,
    "available" | "indexStatus" | "lastIndexedAt" | "indexedFileCount" | "warnings" | "summary"
  >;
  bets: BetProjection[];
  totals: {
    betCount: number;
    backlogDone: number;
    backlogInProgress: number;
    backlogOpen: number;
    implementationFileCount: number;
    relatedTestCount: number;
  };
};

export type CockpitLoaderDeps = {
  getFreshness: typeof getCodeGraphFreshness;
  trace: typeof traceCodeSurface;
  coverage: typeof summarizeCodeGraphCoverage;
  findBacklogItems: (
    itemIds: string[],
  ) => Promise<Array<{ itemId: string; status: string; title: string }>>;
};

const defaultDeps: CockpitLoaderDeps = {
  getFreshness: getCodeGraphFreshness,
  trace: traceCodeSurface,
  coverage: summarizeCodeGraphCoverage,
  findBacklogItems: async (itemIds) =>
    prisma.backlogItem.findMany({
      where: { itemId: { in: itemIds } },
      select: { itemId: true, status: true, title: true },
    }),
};

function selectorLabel(kind: "model" | "tool", value: string): string {
  return `${kind}:${value}`;
}

function aggregateTraces(
  traces: Array<{ kind: "model" | "tool"; value: string; result: CodeSurfaceTraceResult | null }>,
): BetBlastRadius {
  const files = new Set<string>();
  const tests = new Set<string>();
  let traced = 0;
  const unresolved: string[] = [];

  for (const { kind, value, result } of traces) {
    if (result?.surface) {
      traced += 1;
      for (const file of result.implementationFiles) files.add(file.path);
      for (const test of result.relatedTests) tests.add(test.path);
    } else {
      unresolved.push(selectorLabel(kind, value));
    }
  }

  return {
    implementationFileCount: files.size,
    relatedTestCount: tests.size,
    tracedSelectorCount: traced,
    unresolvedSelectors: unresolved,
  };
}

function toFileCoverage(summary: CodeGraphCoverageSummary): BetFileCoverage {
  return {
    indexedCount: summary.indexedFiles.length,
    unindexedCount: summary.unindexedFiles.length,
  };
}

async function projectBet(
  bet: ConsolidationBet,
  graphAvailable: boolean,
  statusByItemId: Map<string, BetBacklogStatus>,
  deps: CockpitLoaderDeps,
): Promise<BetProjection> {
  const backlogItems = bet.backlogItemIds.map(
    (itemId) => statusByItemId.get(itemId) ?? { itemId, status: null, title: null },
  );

  if (!graphAvailable) {
    return { bet, backlogItems, blastRadius: null, fileCoverage: null };
  }

  const selectorInputs: Array<{ kind: "model" | "tool"; value: string }> = [
    ...bet.selectors.models.map((value) => ({ kind: "model" as const, value })),
    ...bet.selectors.tools.map((value) => ({ kind: "tool" as const, value })),
  ];

  // A graph-store error mid-page (e.g. Neo4j restarting) degrades that
  // selector to "unresolved" instead of failing the whole capabilities page.
  const traces: Array<{ kind: "model" | "tool"; value: string; result: CodeSurfaceTraceResult | null }> =
    await Promise.all(
      selectorInputs.map(async ({ kind, value }) => {
        try {
          return {
            kind,
            value,
            result: await deps.trace(kind === "model" ? { model: value } : { tool: value }),
          };
        } catch {
          return { kind, value, result: null };
        }
      }),
    );

  let fileCoverage: BetFileCoverage | null = null;
  if (bet.selectors.files.length > 0) {
    try {
      fileCoverage = toFileCoverage(await deps.coverage(bet.selectors.files));
    } catch {
      fileCoverage = null;
    }
  }

  return {
    bet,
    backlogItems,
    blastRadius: aggregateTraces(traces),
    fileCoverage,
  };
}

export async function loadOptimizationCockpitData(
  deps: CockpitLoaderDeps = defaultDeps,
): Promise<OptimizationCockpitData> {
  const freshness = await deps.getFreshness();

  const allItemIds = CONSOLIDATION_BETS.flatMap((bet) => bet.backlogItemIds);
  const rows = await deps.findBacklogItems(allItemIds);
  const statusByItemId = new Map<string, BetBacklogStatus>(
    rows.map((row) => [row.itemId, { itemId: row.itemId, status: row.status, title: row.title }]),
  );

  const bets: BetProjection[] = [];
  for (const bet of CONSOLIDATION_BETS) {
    // Sequential on purpose: each bet already fans out its selectors in
    // parallel, and the graph store is a shared singleton.
    bets.push(await projectBet(bet, freshness.available, statusByItemId, deps));
  }

  const statuses = bets.flatMap((projection) => projection.backlogItems);
  const totals = {
    betCount: bets.length,
    backlogDone: statuses.filter((item) => item.status === "done").length,
    backlogInProgress: statuses.filter((item) => item.status === "in-progress").length,
    backlogOpen: statuses.filter((item) => item.status === "open").length,
    implementationFileCount: bets.reduce(
      (sum, projection) => sum + (projection.blastRadius?.implementationFileCount ?? 0),
      0,
    ),
    relatedTestCount: bets.reduce(
      (sum, projection) => sum + (projection.blastRadius?.relatedTestCount ?? 0),
      0,
    ),
  };

  return {
    freshness: {
      available: freshness.available,
      indexStatus: freshness.indexStatus,
      lastIndexedAt: freshness.lastIndexedAt,
      indexedFileCount: freshness.indexedFileCount,
      warnings: freshness.warnings,
      summary: freshness.summary,
    },
    bets,
    totals,
  };
}
