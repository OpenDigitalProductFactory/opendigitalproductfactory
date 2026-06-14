// apps/web/lib/ea/sysml-model-seed.ts
//
// Shared idempotent applier for SysML projections into the EA graph (Parity Engine).
// Generalizes the create/update + soft-remove + relationship + view pattern that the
// per-domain extractors (MCP authority, coworker authority, …) all need — so each
// extractor only builds a desired model and hands it here, instead of re-copying the
// upsert logic. The db client is injected so this is unit-testable WITHOUT a
// file-scoped @dpf/db mock (which can bleed across files under the forks pool).
//
// Re-derive-then-apply means the projection cannot drift from its source: a no-delta
// run makes no writes; elements that disappear from the desired set are SOFT-removed
// (never hard-deleted — never-wipe).
//
// Design: docs/superpowers/specs/2026-06-14-design-implementation-parity-engine-design.md

import { prisma } from "@dpf/db";

export interface SysmlDesiredElement {
  /** Stable source key → EaElement.infraCiKey. */
  sysmlKey: string;
  typeSlug: string;
  name: string;
  description: string;
  properties?: Record<string, unknown>;
}

export interface SysmlDesiredRel {
  fromKey: string;
  toKey: string;
  relSlug: string;
}

export interface SysmlDesiredModel {
  elements: SysmlDesiredElement[];
  relationships: SysmlDesiredRel[];
  /** sysml2 element-type slugs used by `elements` (resolved once). */
  elementTypeSlugs: string[];
  /** sysml2 relationship-type slugs used by `relationships` (resolved once). */
  relTypeSlugs: string[];
  view: { name: string; description: string; viewpointName: string; scopeRef: string };
  /** When set, existing elements with this infraCiKey prefix that are NOT in the
   *  desired set are soft-removed (mirrorRemoved=true, lifecycleStatus=inactive). */
  softRemovePrefix?: string;
}

export interface SysmlSeedResult {
  status: "applied" | "noop" | "skipped";
  created: number;
  updated: number;
  removed: number;
}

export async function applySysmlModel(
  model: SysmlDesiredModel,
  opts: { db?: typeof prisma; notationSlug?: string } = {},
): Promise<SysmlSeedResult> {
  const db = opts.db ?? prisma;
  const notationSlug = opts.notationSlug ?? "sysml2";
  const skipped: SysmlSeedResult = { status: "skipped", created: 0, updated: 0, removed: 0 };

  const notation = await db.eaNotation.findUnique({ where: { slug: notationSlug }, select: { id: true } });
  if (!notation) {
    console.warn(`[sysml-model-seed] notation "${notationSlug}" not seeded — skipping`);
    return skipped;
  }
  const notationId = notation.id;

  const etId = new Map<string, string>();
  for (const slug of model.elementTypeSlugs) {
    const et = await db.eaElementType.findUniqueOrThrow({ where: { notationId_slug: { notationId, slug } }, select: { id: true } });
    etId.set(slug, et.id);
  }
  const rtId = new Map<string, string>();
  for (const slug of model.relTypeSlugs) {
    const rt = await db.eaRelationshipType.findUniqueOrThrow({ where: { notationId_slug: { notationId, slug } }, select: { id: true } });
    rtId.set(slug, rt.id);
  }

  // Load existing elements for diff + soft-remove (scoped to the prefix when given).
  const existing: Array<{ id: string; infraCiKey: string | null; properties: unknown }> = model.softRemovePrefix
    ? await db.eaElement.findMany({ where: { infraCiKey: { startsWith: model.softRemovePrefix } }, select: { id: true, infraCiKey: true, properties: true } })
    : [];
  const existingByKey = new Map(existing.map((e) => [e.infraCiKey ?? "", e]));
  const desiredKeys = new Set(model.elements.map((e) => e.sysmlKey));

  let created = 0;
  let updated = 0;
  let removed = 0;
  const idByKey = new Map<string, string>();

  for (const el of model.elements) {
    const elementTypeId = etId.get(el.typeSlug);
    if (!elementTypeId) continue;
    const data = {
      elementTypeId,
      name: el.name,
      description: el.description,
      properties: { ...(el.properties ?? {}), provenance: "deterministic", mirrorRemoved: false },
      lifecycleStage: "production",
      lifecycleStatus: "active",
      infraCiKey: el.sysmlKey,
    };
    const prior = existingByKey.get(el.sysmlKey) ?? (await db.eaElement.findFirst({ where: { infraCiKey: el.sysmlKey }, select: { id: true } }));
    if (prior) {
      await db.eaElement.update({ where: { id: prior.id }, data });
      idByKey.set(el.sysmlKey, prior.id);
      updated++;
    } else {
      const row = await db.eaElement.create({ data, select: { id: true } });
      idByKey.set(el.sysmlKey, row.id);
      created++;
    }
  }

  if (model.softRemovePrefix) {
    for (const e of existing) {
      if (desiredKeys.has(e.infraCiKey ?? "")) continue;
      const props = (e.properties && typeof e.properties === "object" ? e.properties : {}) as Record<string, unknown>;
      if (props.mirrorRemoved === true) continue;
      await db.eaElement.update({ where: { id: e.id }, data: { lifecycleStatus: "inactive", properties: { ...props, mirrorRemoved: true } } });
      removed++;
    }
  }

  for (const rel of model.relationships) {
    const fromElementId = idByKey.get(rel.fromKey);
    const toElementId = idByKey.get(rel.toKey);
    const relationshipTypeId = rtId.get(rel.relSlug);
    if (!fromElementId || !toElementId || !relationshipTypeId) continue;
    const found = await db.eaRelationship.findFirst({ where: { fromElementId, toElementId, relationshipTypeId }, select: { id: true } });
    if (!found) {
      await db.eaRelationship.create({ data: { fromElementId, toElementId, relationshipTypeId, notationSlug, properties: {} } });
    }
  }

  const viewpoint = await db.viewpointDefinition.findUnique({ where: { name: model.view.viewpointName }, select: { id: true } });
  let view = await db.eaView.findFirst({ where: { notationId, name: model.view.name }, select: { id: true } });
  if (!view) {
    view = await db.eaView.create({
      data: {
        notationId, name: model.view.name, description: model.view.description,
        layoutType: "graph", scopeType: "custom", scopeRef: model.view.scopeRef,
        viewpointId: viewpoint?.id ?? null, status: "draft",
      },
      select: { id: true },
    });
  }
  for (const id of idByKey.values()) {
    await db.eaViewElement.upsert({
      where: { viewId_elementId: { viewId: view.id, elementId: id } },
      update: {},
      create: { viewId: view.id, elementId: id, mode: "existing" },
    });
  }

  const status: SysmlSeedResult["status"] = created === 0 && updated === 0 && removed === 0 ? "noop" : "applied";
  return { status, created, updated, removed };
}
