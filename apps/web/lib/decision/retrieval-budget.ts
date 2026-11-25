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

/** The reason a retrieval leg cannot attest complete evidence. */
export type RetrievalDisposition = "complete" | "failed" | "late" | "lexical-only";

export type DecisionRetrievalEvidence = {
  scope: "complete" | "failed" | "late";
  commandments: "complete" | "failed" | "late" | "overflow" | "not-run";
  core: RetrievalDisposition | "not-run";
  contextual: RetrievalDisposition | "not-run";
  hydration: "complete" | "failed" | "late" | "stale" | "missing";
  inference: "complete" | "failed" | "late";
};

export type RetrievalBudget = {
  /** Wait only until the original request deadline. DB work may continue in its driver. */
  run<T>(work: Promise<T> | (() => Promise<T>), whenLate: T): Promise<T>;
  /** True once any leg reached the request deadline. */
  exceeded(): boolean;
};

export function createRetrievalBudget(budgetMs: number): RetrievalBudget {
  const deadline = Date.now() + budgetMs;
  let tripped = false;
  return {
    async run<T>(work: Promise<T> | (() => Promise<T>), whenLate: T): Promise<T> {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        tripped = true;
        if (typeof work !== "function") void work.catch(() => {});
        return whenLate;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          typeof work === "function" ? work() : work,
          new Promise<T>((resolve) => {
            timer = setTimeout(() => {
              tripped = true;
              resolve(whenLate);
            }, remainingMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    exceeded: () => tripped,
  };
}

type Lookup<T> =
  | { status: "complete"; value: T }
  | { status: "late" | "failed" };

export async function readDecisionEvidence<T>(
  budget: RetrievalBudget,
  read: () => Promise<T>,
  label: string,
): Promise<Lookup<T>> {
  try {
    return await budget.run<Lookup<T>>(
      async () => ({ status: "complete", value: await read() }),
      { status: "late" },
    );
  } catch (err) {
    console.warn(`[principle_decide] ${label} lookup failed:`, err);
    return { status: "failed" };
  }
}

type TierSearch = (input: Record<string, unknown>) => Promise<unknown>;

/** Preserve healthy empty evidence, failure, and fallback as separate outcomes. */
export async function retrievePrincipleTiers(input: {
  search: TierSearch;
  budget: RetrievalBudget;
  query: string;
  organizationId: string | null;
  callingPopulation: string;
  ringScope: string[] | undefined;
  contextualThreshold: number;
}) {
  const base = {
    query: input.query,
    organizationId: input.organizationId,
    pageKind: "principle",
    principleAppliesTo: input.callingPopulation,
    principleRingScope: input.ringScope,
    limit: 5,
  };
  const tier = async (principleTier: "core" | "contextual", scoreThreshold?: number) => {
    let disposition: RetrievalDisposition = "complete";
    const read = await readDecisionEvidence(input.budget, () => input.search({
      ...base,
      principleTier,
      ...(scoreThreshold === undefined ? {} : { scoreThreshold }),
      onRetrievalDisposition: (next: "lexical-only") => { disposition = next; },
    }), principleTier);
    if (read.status !== "complete") return { status: read.status, hits: [] };
    if (!Array.isArray(read.value)) return { status: "failed" as const, hits: [] };
    return { status: disposition as RetrievalDisposition, hits: read.value as Array<Record<string, unknown>> };
  };
  const [core, contextual] = await Promise.all([
    tier("core"), tier("contextual", input.contextualThreshold),
  ]);
  return { core: core.hits, contextual: contextual.hits, status: { core: core.status, contextual: contextual.status } };
}
