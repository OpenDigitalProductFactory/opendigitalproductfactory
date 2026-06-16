// apps/web/lib/ea/reconcile-operational-bridge.ts
//
// Reconcile the live runtime into the Operational Graph SysML projection (Parity
// Engine, living-graph Phase C). Thin IO shell: read the RuntimeTarget coordination
// registry, build the desired model (pure extractor), and apply it via the shared
// idempotent seeder. Re-derives every run, so it cannot drift. Skips cleanly when no
// runtime targets are registered (mirrors value-streams skipping). db is injectable.

import { prisma } from "@dpf/db";
import { buildOperationalGraphModel, type RuntimeTargetFact } from "./operational-bridge-extract";
import { applySysmlModel, type SysmlSeedResult } from "./sysml-model-seed";

export async function reconcileOperationalGraph(opts: { db?: typeof prisma } = {}): Promise<SysmlSeedResult> {
  const db = opts.db ?? prisma;
  const rows = await db.runtimeTarget.findMany({
    select: {
      targetId: true,
      kind: true,
      status: true,
      serviceName: true,
      containerName: true,
      hostUrl: true,
      serviceVersion: true,
      port: true,
      lastHeartbeatAt: true,
    },
  });

  if (rows.length === 0) {
    console.warn("[operational-graph] no RuntimeTarget rows — skipping");
    return { status: "skipped", created: 0, updated: 0, removed: 0 };
  }

  const facts: RuntimeTargetFact[] = rows.map((r) => ({
    targetId: r.targetId,
    kind: r.kind,
    status: r.status,
    serviceName: r.serviceName,
    containerName: r.containerName,
    hostUrl: r.hostUrl,
    serviceVersion: r.serviceVersion,
    port: r.port,
    lastHeartbeatAt: r.lastHeartbeatAt ? r.lastHeartbeatAt.toISOString() : null,
  }));

  const result = await applySysmlModel(buildOperationalGraphModel(facts), { db: opts.db });
  console.info(
    `[operational-graph] reconcile ${result.status}: created=${result.created} updated=${result.updated} removed=${result.removed} (targets=${facts.length})`,
  );
  return result;
}
