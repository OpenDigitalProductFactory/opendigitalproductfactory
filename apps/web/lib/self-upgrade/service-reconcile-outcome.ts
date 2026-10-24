/**
 * BI-5ACBAC50 — carry promote.sh step 7d's result into the run's evidence.
 *
 * Step 7d (service-reconcile) creates every required service the install has
 * no container for. It is fail-loud-not-abort, so a service it cannot create
 * leaves the promotion standing. But its warning went only to the promoter's
 * stderr, which dies with the promoter container, and the run had already been
 * marked succeeded by the new portal at boot (reconcileSelfUpgradeRunsOnBoot),
 * before 7d ever ran. So a reconcile that failed on every upgrade for two
 * months recorded nothing anywhere, and Prometheus, Grafana, Loki and Alloy
 * stayed absent behind a row of green runs.
 *
 * promote.sh now writes the outcome to the shared state mount
 * (`service-reconcile-outcome.json`). This module reads it and merges it into
 * the matching run's `completionEvidence.serviceReconcile`, where the Upgrade
 * Center renders a degraded outcome. The run's `status` stays `succeeded`: the
 * portal swap did land, and `getLatestSucceededRun` feeds the upstream
 * freshness gate, which must keep treating the target as carried.
 *
 * Pure apart from the injected I/O, and client-safe for the parse helpers.
 */

/** Where promote.sh writes the outcome, inside the portal's read-only mount. */
export const SERVICE_RECONCILE_OUTCOME_PATH = "/dpf-state/service-reconcile-outcome.json";

export type ServiceReconcileOutcome = {
  targetSha: string;
  /** When promote.sh wrote it (ISO). Also the identity used to avoid rewrites. */
  at: string;
  /** current: nothing was missing. complete: all missing created. degraded: some could not be. */
  outcome: "current" | "complete" | "degraded";
  required: string[];
  created: string[];
  failed: string[];
};

const OUTCOMES: ReadonlySet<string> = new Set(["current", "complete", "degraded"]);

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? (value as string[]) : null;
}

function coerce(value: unknown): ServiceReconcileOutcome | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const required = stringList(v.required);
  const created = stringList(v.created);
  const failed = stringList(v.failed);
  if (
    typeof v.targetSha !== "string" ||
    !v.targetSha ||
    typeof v.at !== "string" ||
    typeof v.outcome !== "string" ||
    !OUTCOMES.has(v.outcome) ||
    !required ||
    !created ||
    !failed
  ) {
    return null;
  }
  return {
    targetSha: v.targetSha,
    at: v.at,
    outcome: v.outcome as ServiceReconcileOutcome["outcome"],
    required,
    created,
    failed,
  };
}

/** Parse the file. A missing, torn or unrecognised file is null, never a throw. */
export function parseServiceReconcileOutcome(contents: string | null): ServiceReconcileOutcome | null {
  if (!contents) return null;
  try {
    return coerce(JSON.parse(contents));
  } catch {
    return null;
  }
}

/** Read the outcome back off a run's `completionEvidence`. */
export function serviceReconcileFromEvidence(completionEvidence: unknown): ServiceReconcileOutcome | null {
  if (!completionEvidence || typeof completionEvidence !== "object" || Array.isArray(completionEvidence)) return null;
  return coerce((completionEvidence as Record<string, unknown>).serviceReconcile);
}

export type ServiceReconcileRun = {
  runId: string;
  completionEvidence: unknown;
};

/**
 * Attach the current outcome file to the run that promoted its target.
 * Idempotent: a run already carrying the same outcome (same `at`) is left alone.
 * Returns what was recorded, or null when there was nothing to do.
 */
export async function attachServiceReconcileOutcome(deps: {
  readOutcome: () => Promise<string | null>;
  /** Newest succeeded run whose target or deployed SHA is this one. */
  findRun: (targetSha: string) => Promise<ServiceReconcileRun | null>;
  record: (runId: string, outcome: ServiceReconcileOutcome) => Promise<unknown>;
}): Promise<{ runId: string; outcome: ServiceReconcileOutcome["outcome"] } | null> {
  const outcome = parseServiceReconcileOutcome(await deps.readOutcome());
  if (!outcome) return null;
  const run = await deps.findRun(outcome.targetSha);
  if (!run) return null;
  if (serviceReconcileFromEvidence(run.completionEvidence)?.at === outcome.at) return null;
  await deps.record(run.runId, outcome);
  return { runId: run.runId, outcome: outcome.outcome };
}
