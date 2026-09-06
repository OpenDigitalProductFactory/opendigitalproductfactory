// Bounded retrieval for the decision engine (BI-D8D1371B).
//
// principle_decide is deterministic MCDA and its scoring was never the problem.
// Its RETRIEVAL depends on an embedding provider, and each attempt carries a 30s
// abort (inference/embedding.ts). One decide call issues several: two wiki
// searches that embed internally, one embedding per candidate principle lacking
// a dimensionVector (a Promise.all over ~49 rows on a sparse call), and one per
// option. Nothing bounded the total, so a provider that STALLS rather than fails
// fast turned a graceful degradation into a 60-120s hang past any client
// timeout — and the burst of concurrent requests contributed to the contention
// it was waiting on.
//
// Two governed architecture decisions timed out that way on 2026-09-03 and were
// recorded as unratified judgment. A steering engine that goes quiet is strictly
// worse than one that says it is impaired.

/** Default wait before the caller stops waiting on retrieval and degrades. */
export const DEFAULT_RETRIEVAL_BUDGET_MS = 8000;

export function resolveRetrievalBudgetMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number(env["PRINCIPLE_DECIDE_RETRIEVAL_BUDGET_MS"]);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RETRIEVAL_BUDGET_MS;
}

export type RetrievalBudget = {
  /**
   * Await `work`, or resolve `whenLate` once the budget expires.
   *
   * The race does NOT cancel the in-flight request — it aborts on its own
   * schedule. What this bounds is how long the CALLER waits, which is the thing
   * that was unbounded.
   */
  run<T>(work: Promise<T>, whenLate: T): Promise<T>;
  /** True once any leg exceeded the budget. Drives `retrievalDegraded`. */
  exceeded(): boolean;
};

export function createRetrievalBudget(budgetMs: number): RetrievalBudget {
  let tripped = false;
  return {
    async run<T>(work: Promise<T>, whenLate: T): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          work,
          new Promise<T>((resolve) => {
            timer = setTimeout(() => {
              tripped = true;
              resolve(whenLate);
            }, budgetMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    exceeded: () => tripped,
  };
}

type TierSearch = (input: Record<string, unknown>) => Promise<unknown>;

/**
 * Retrieve the core and contextual principle tiers under one shared budget.
 *
 * Both legs are bounded and both fail soft: a lookup error or a late provider
 * yields an empty tier rather than an exception, and `budget.exceeded()` tells
 * the caller whether the result is complete. Commandments are unaffected — they
 * come from Postgres and are always consulted.
 */
export async function retrievePrincipleTiers(input: {
  search: TierSearch;
  budget: RetrievalBudget;
  query: string;
  organizationId: string | null | undefined;
  callingPopulation: string;
  ringScope: string[] | undefined;
  contextualThreshold: number;
}): Promise<{ core: Array<Record<string, unknown>>; contextual: Array<Record<string, unknown>> }> {
  const base = {
    query: input.query,
    organizationId: input.organizationId,
    pageKind: "principle",
    principleAppliesTo: input.callingPopulation,
    principleRingScope: input.ringScope,
    limit: 5,
  };
  const tier = async (
    extra: Record<string, unknown>,
    label: string,
  ): Promise<Array<Record<string, unknown>>> => {
    try {
      return (await input.budget.run(
        input.search({ ...base, ...extra }) as Promise<Array<Record<string, unknown>>>,
        [],
      )) as Array<Record<string, unknown>>;
    } catch (err) {
      console.warn(`[principle_decide] ${label} Qdrant lookup failed:`, err);
      return [];
    }
  };
  return {
    core: await tier({ principleTier: "core" }, "core"),
    contextual: await tier(
      { principleTier: "contextual", scoreThreshold: input.contextualThreshold },
      "contextual",
    ),
  };
}
