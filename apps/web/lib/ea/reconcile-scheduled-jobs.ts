// apps/web/lib/ea/reconcile-scheduled-jobs.ts
//
// Reconcile the canonical scheduling map into the Scheduling SysML projection
// (Parity Engine, living-graph — EP-SCHEDULING-SURFACE). The source is the static
// in-code map (apps/web/lib/operate/scheduled-jobs/scheduling-map.ts), so this
// re-derives the whole projection every run and cannot drift. Thin IO shell: the
// pure extractor builds the desired model, the shared idempotent seeder applies
// it. db is injectable for tests.

import { prisma } from "@dpf/db";
import { buildSchedulingModel } from "./scheduled-job-extract";
import { applySysmlModel, type SysmlSeedResult } from "./sysml-model-seed";

export async function reconcileScheduledJobs(
  opts: { db?: typeof prisma } = {},
): Promise<SysmlSeedResult> {
  const result = await applySysmlModel(buildSchedulingModel(), { db: opts.db });
  console.info(
    `[scheduling] reconcile ${result.status}: created=${result.created} updated=${result.updated} removed=${result.removed}`,
  );
  return result;
}
