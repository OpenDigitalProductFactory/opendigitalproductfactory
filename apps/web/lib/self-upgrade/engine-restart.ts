// BI-75ECED42: tell "the container engine restarted under the upgrade" apart
// from "the swap went wrong". Live 2026-10-02, SUR-8782FCBD: Docker Desktop
// installed an update of its own and restarted at 14:28:41Z, every container
// (Postgres included) came back at 14:29:10, and the boot reconciler recorded
// "orchestrator did not complete the swap" with no usable cause.
//
// The database runs in the same engine, so its server start time is a cheap
// signal: if it started after the run began, the whole stack restarted.

/** True when the database server started after the run began: the engine (or host) restarted under it. */
export function engineRestartedDuringRun(runStartedAt: Date | null, databaseStartedAt: Date | null): boolean {
  if (!runStartedAt || !databaseStartedAt) return false;
  return databaseStartedAt.getTime() > runStartedAt.getTime();
}

/** The database server's start time, or null when it cannot be read. */
export async function readDatabaseStartedAt(): Promise<Date | null> {
  try {
    const { prisma } = await import("@dpf/db");
    const rows = await prisma.$queryRaw<Array<{ started: Date }>>`SELECT pg_postmaster_start_time() AS started`;
    const started = rows[0]?.started;
    return started instanceof Date ? started : started ? new Date(started) : null;
  } catch {
    return null;
  }
}

export const ENGINE_RESTARTED_REASON = "engine-restarted";

export function engineRestartFailureLog(input: { runStartedAt: Date; databaseStartedAt: Date; deployedSha: string | null; targetSha: string | null }): string {
  return `Reconciled on boot: the container engine restarted during this upgrade (the database server started at ${input.databaseStartedAt.toISOString()}, after the run began at ${input.runStartedAt.toISOString()}), for example Docker Desktop installing an update of its own. Nothing was installed; the platform is on ${input.deployedSha ?? "its previous version"}. Run the upgrade again. target=${input.targetSha ?? "unknown"}`;
}
