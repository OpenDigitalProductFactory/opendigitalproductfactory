// apps/web/lib/ea/reconcile-integration-bridge.ts
//
// Reconcile connected external applications into the Integrations SysML projection
// (Parity Engine, living-graph Phase E). Thin IO shell: read the configured
// IntegrationCredential connections, build the desired model (pure extractor), apply
// via the shared idempotent seeder. Re-derives every run, so it cannot drift. Skips
// cleanly when no integrations are configured. db is injectable for tests.

import { prisma } from "@dpf/db";
import { buildIntegrationModel, type IntegrationFact } from "./integration-bridge-extract";
import { applySysmlModel, type SysmlSeedResult } from "./sysml-model-seed";

export async function reconcileIntegrations(opts: { db?: typeof prisma } = {}): Promise<SysmlSeedResult> {
  const db = opts.db ?? prisma;
  const rows = await db.integrationCredential.findMany({
    select: { integrationId: true, provider: true, status: true, lastTestedAt: true, certExpiresAt: true },
  });

  if (rows.length === 0) {
    console.warn("[integrations] no IntegrationCredential rows — skipping");
    return { status: "skipped", created: 0, updated: 0, removed: 0 };
  }

  const facts: IntegrationFact[] = rows.map((r) => ({
    integrationId: r.integrationId,
    provider: r.provider,
    status: r.status,
    lastTestedAt: r.lastTestedAt ? r.lastTestedAt.toISOString() : null,
    certExpiresAt: r.certExpiresAt ? r.certExpiresAt.toISOString() : null,
  }));

  const result = await applySysmlModel(buildIntegrationModel(facts), { db: opts.db });
  console.info(
    `[integrations] reconcile ${result.status}: created=${result.created} updated=${result.updated} removed=${result.removed} (integrations=${facts.length})`,
  );
  return result;
}
