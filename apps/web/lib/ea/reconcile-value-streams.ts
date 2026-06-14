// apps/web/lib/ea/reconcile-value-streams.ts
//
// Reconcile the IT4IT value-stream taxonomy into a live SysML projection (Parity
// Engine). Runtime-safe: reads EaReferenceModelElement (Postgres), resolves the
// stage→stream hierarchy, and applies via the shared idempotent seeder. Re-derives
// every run, so it cannot drift. db injected for tests.

import { prisma } from "@dpf/db";
import { buildValueStreamModel, type ValueStreamRow } from "./value-stream-extract";
import { applySysmlModel, type SysmlSeedResult } from "./sysml-model-seed";

const IT4IT_MODEL_SLUG = "it4it_v3_0_1";

export async function reconcileValueStreams(opts: { db?: typeof prisma } = {}): Promise<SysmlSeedResult> {
  const db = opts.db ?? prisma;

  const model = await db.eaReferenceModel.findUnique({ where: { slug: IT4IT_MODEL_SLUG }, select: { id: true } });
  if (!model) {
    console.warn(`[value-streams] IT4IT reference model "${IT4IT_MODEL_SLUG}" not seeded — skipping`);
    return { status: "skipped", created: 0, updated: 0, removed: 0 };
  }

  const elements: Array<{ id: string; kind: string; slug: string; name: string; parentId: string | null }> =
    await db.eaReferenceModelElement.findMany({
      where: { modelId: model.id, kind: { in: ["value_stream", "value_stream_stage"] } },
      select: { id: true, kind: true, slug: true, name: true, parentId: true },
    });

  const idToSlug = new Map(elements.map((e) => [e.id, e.slug]));
  const rows: ValueStreamRow[] = elements.map((e) => ({
    kind: e.kind,
    slug: e.slug,
    name: e.name,
    parentSlug: e.parentId ? idToSlug.get(e.parentId) ?? null : null,
  }));

  const result = await applySysmlModel(buildValueStreamModel(rows), { db });
  console.info(`[value-streams] reconcile ${result.status}: created=${result.created} updated=${result.updated} removed=${result.removed}`);
  return result;
}
