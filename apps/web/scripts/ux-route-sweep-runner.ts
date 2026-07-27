import { performance } from "node:perf_hooks";

/**
 * Pure coordination for the UX route sweep.
 *
 * The browser driver owns navigation and measurement; this module owns bounded
 * scheduling, deterministic result ordering, and exact inventory accounting. Keeping
 * those concerns browser-free makes the failure contract cheap to test and prevents
 * the CLI from growing another ad-hoc worker loop.
 */

export const SUPPORTED_SWEEP_WORKER_COUNTS = [1, 2, 4] as const;
export type SweepWorkerCount = (typeof SUPPORTED_SWEEP_WORKER_COUNTS)[number];

type RouteRow = { routePath: string };

export type SemanticStructureNode = {
  role: string | null;
  attributes?: string[];
  children?: SemanticStructureNode[];
};

/**
 * Serialise the browser-resolved semantic DOM projection the ratchet consumes.
 *
 * Null-role wrappers are flattened. That mirrors the accessibility tree's treatment
 * of generic layout divs while keeping semantic descendants and their nesting.
 */
export function serialiseSemanticStructure(
  nodes: readonly SemanticStructureNode[],
): string {
  if (nodes.length === 0) throw new Error("empty semantic structure");
  const lines: string[] = [];

  const visit = (node: SemanticStructureNode, depth: number): void => {
    const childDepth = node.role ? depth + 1 : depth;
    if (node.role) {
      const attrs = (node.attributes ?? []).join(" ");
      lines.push(
        `${"  ".repeat(depth)}- ${node.role}${attrs ? ` ${attrs}` : ""}`,
      );
    }
    for (const child of node.children ?? []) visit(child, childDepth);
  };

  for (const node of nodes) visit(node, 0);
  if (lines.length === 0) throw new Error("semantic structure has no projected nodes");
  return lines.join("\n");
}

export type MeasuredRouteOutcome<T> = {
  routePath: string;
  status: "measured";
  value: T;
  durationMs: number;
};

export type FailedRouteOutcome = {
  routePath: string;
  status: "failed";
  reason: string;
  durationMs: number;
};

export type RouteOutcome<T> = MeasuredRouteOutcome<T> | FailedRouteOutcome;

export type RouteAccounting = {
  complete: boolean;
  expectedRouteCount: number;
  measuredRouteCount: number;
  failedRoutes: string[];
  missingRoutes: string[];
  duplicateRoutes: string[];
  unexpectedRoutes: string[];
};

export type RouteWorkResult<T> = {
  workerCount: SweepWorkerCount;
  durationMs: number;
  outcomes: RouteOutcome<T>[];
  accounting: RouteAccounting;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.split(/\r?\n/)[0] || error.name;
  return String(error);
}

export function parseSweepWorkerCount(value: string | undefined): SweepWorkerCount {
  const parsed = Number(value ?? "2");
  if (
    !Number.isInteger(parsed) ||
    !SUPPORTED_SWEEP_WORKER_COUNTS.includes(parsed as SweepWorkerCount)
  ) {
    throw new Error(
      `Unsupported UX sweep worker count ${JSON.stringify(value)}; supported values are 1, 2, or 4.`,
    );
  }
  return parsed as SweepWorkerCount;
}

function duplicates(values: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();
}

/**
 * Reconcile terminal outcomes against the route inventory.
 *
 * This is deliberately independent of the worker implementation: a future scheduler
 * or shard combiner still has to prove the same no-missing/no-duplicate contract.
 */
export function reconcileRouteAccounting(
  expectedRoutes: readonly string[],
  outcomes: readonly Pick<RouteOutcome<unknown>, "routePath" | "status">[],
): RouteAccounting {
  const expectedSet = new Set(expectedRoutes);
  const outcomeRoutes = outcomes.map((outcome) => outcome.routePath);
  const outcomeSet = new Set(outcomeRoutes);
  const failedRoutes = outcomes
    .filter((outcome) => outcome.status === "failed")
    .map((outcome) => outcome.routePath)
    .sort();
  const missingRoutes = expectedRoutes.filter((routePath) => !outcomeSet.has(routePath)).sort();
  const duplicateRoutes = duplicates(outcomeRoutes);
  const unexpectedRoutes = [...outcomeSet]
    .filter((routePath) => !expectedSet.has(routePath))
    .sort();
  const measuredRouteCount = outcomes.filter((outcome) => outcome.status === "measured").length;

  return {
    complete:
      expectedRoutes.length > 0 &&
      duplicates(expectedRoutes).length === 0 &&
      failedRoutes.length === 0 &&
      missingRoutes.length === 0 &&
      duplicateRoutes.length === 0 &&
      unexpectedRoutes.length === 0 &&
      measuredRouteCount === expectedRoutes.length,
    expectedRouteCount: expectedRoutes.length,
    measuredRouteCount,
    failedRoutes,
    missingRoutes,
    duplicateRoutes,
    unexpectedRoutes,
  };
}

/**
 * Run one operation per route with bounded concurrency.
 *
 * Work completion order is intentionally discarded: outcomes retain the canonical
 * inventory order so JSON artifacts are byte-stable apart from measured values and
 * durations. An operation failure is one route outcome, not a worker crash; remaining
 * routes still run so the failure artifact is complete.
 */
export async function runBoundedRouteWork<TRow extends RouteRow, TValue>(
  rows: readonly TRow[],
  workerCount: SweepWorkerCount,
  operation: (row: TRow, workerIndex: number) => Promise<TValue>,
): Promise<RouteWorkResult<TValue>> {
  const routePaths = rows.map((row) => row.routePath);
  const duplicateInputs = duplicates(routePaths);
  if (duplicateInputs.length > 0) {
    throw new Error(`Duplicate eligible UX routes: ${duplicateInputs.join(", ")}`);
  }

  const startedAt = performance.now();
  const outcomes = new Array<RouteOutcome<TValue>>(rows.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(workerCount, Math.max(rows.length, 1)) },
    async (_, workerIndex) => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= rows.length) return;

        const row = rows[index];
        const routeStartedAt = performance.now();
        try {
          outcomes[index] = {
            routePath: row.routePath,
            status: "measured",
            value: await operation(row, workerIndex),
            durationMs: Math.round(performance.now() - routeStartedAt),
          };
        } catch (error) {
          outcomes[index] = {
            routePath: row.routePath,
            status: "failed",
            reason: errorMessage(error),
            durationMs: Math.round(performance.now() - routeStartedAt),
          };
        }
      }
    },
  );

  await Promise.all(workers);
  const accounting = reconcileRouteAccounting(routePaths, outcomes);
  return {
    workerCount,
    durationMs: Math.round(performance.now() - startedAt),
    outcomes,
    accounting,
  };
}
