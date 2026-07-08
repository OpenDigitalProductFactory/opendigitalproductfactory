// Coworker certification status reader (EP-COWORKER-LIFECYCLE Phase 2).
//
// Light module: derives per-coworker certification state from the latest
// coworker-cert AssuranceRuns. Kept separate from certification-runner so
// read-side consumers (workforce roster) don't import the agentic loop.

export const COWORKER_CERT_ADAPTER_KEY = "coworker-cert";
/** Certifications older than this are "stale" — the coworker needs a re-run. */
export const CERTIFICATION_FRESHNESS_DAYS = 8;

export type CoworkerCertificationStatus = "certified" | "failed" | "stale" | "never";

export type CoworkerCertificationState = {
  status: CoworkerCertificationStatus;
  lastRunAt: Date | null;
};

export type CertificationRunRow = {
  scopeId: string;
  status: string;
  startedAt: Date;
};

type CertificationRunClient = {
  assuranceRun?: { findMany: (args: unknown) => Promise<unknown> };
};

/**
 * Pure derivation from run rows ordered by startedAt desc — first row per
 * agent wins (the latest run).
 */
export function deriveCertificationStates(
  agentIds: string[],
  runsNewestFirst: CertificationRunRow[],
  now: Date,
): Map<string, CoworkerCertificationState> {
  const states = new Map<string, CoworkerCertificationState>();
  for (const agentId of agentIds) states.set(agentId, { status: "never", lastRunAt: null });
  const freshnessMs = CERTIFICATION_FRESHNESS_DAYS * 24 * 60 * 60 * 1000;
  for (const run of runsNewestFirst) {
    const current = states.get(run.scopeId);
    if (!current || current.lastRunAt) continue; // unknown agent or already latest
    const stale = now.getTime() - run.startedAt.getTime() > freshnessMs;
    states.set(run.scopeId, {
      status: run.status === "passed" ? (stale ? "stale" : "certified") : "failed",
      lastRunAt: run.startedAt,
    });
  }
  return states;
}

/** Latest certification state per agent — consumed by the workforce roster. */
export async function loadCertificationStates(
  agentIds: string[],
  db: CertificationRunClient,
  now: Date = new Date(),
): Promise<Map<string, CoworkerCertificationState>> {
  if (agentIds.length === 0 || !db.assuranceRun) {
    return deriveCertificationStates(agentIds, [], now);
  }
  const runs = (await db.assuranceRun.findMany({
    where: {
      scopeType: "agent",
      adapterKey: COWORKER_CERT_ADAPTER_KEY,
      scopeId: { in: agentIds },
    },
    orderBy: { startedAt: "desc" },
    select: { scopeId: true, status: true, startedAt: true },
  })) as CertificationRunRow[];
  return deriveCertificationStates(agentIds, runs, now);
}
