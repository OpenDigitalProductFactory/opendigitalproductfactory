// Data-model mirror applier — EP-DATA-ARCH Phase 2 (BI-2167A734).
//
// Thin IO layer over the pure `planMirror` diff: resolves the EA context
// (archimate4 notation, data_object element type, associated_with relationship
// type), ensures the managed "Data Model" view exists, loads existing mirror
// rows, applies the plan, writes an EaSnapshot on material delta, and (when a
// source key is duplicated) writes a conformance issue and stops.
//
// Neo4j sync is optional and injected so the Postgres reconcile is testable
// without a live graph.

import {
  planMirror,
  summarizePlan,
  describeChange,
  DATA_MODEL_MIRROR_VERSION,
  MODEL_SOURCE_KEY_PREFIX,
  RELATION_SOURCE_KEY_PREFIX,
  type DesiredElement,
  type DesiredRelationship,
  type ExistingMirrorRow,
  type MirrorPlan,
} from "./data-model-mirror";
import type { Prisma } from "@dpf/db";
import type { PrismaSchemaFacts } from "../build/code-graph/extractors/prisma-schema-adapter";

const NOTATION_SLUG = "archimate4";
const ELEMENT_TYPE_SLUG = "data_object";
const RELATIONSHIP_TYPE_SLUG = "associated_with";
const VIEWPOINT_NAME = "Data Model";
const VIEW_SCOPE_TYPE = "data-model";
const VIEW_SCOPE_REF = "prisma";
const DUPLICATE_ISSUE_TYPE = "mirror-duplicate-source-key";

// Narrow client surface (cast from the real prisma client, like state-store.ts).
export type MirrorPrismaClient = {
  eaNotation: { findUnique(args: Record<string, unknown>): Promise<{ id: string; slug: string } | null> };
  eaElementType: { findUnique(args: Record<string, unknown>): Promise<{ id: string; neoLabel: string; slug: string } | null> };
  eaRelationshipType: { findUnique(args: Record<string, unknown>): Promise<{ id: string; neoType: string; slug: string } | null> };
  viewpointDefinition: { upsert(args: Record<string, unknown>): Promise<{ id: string }> };
  eaView: {
    findFirst(args: Record<string, unknown>): Promise<{ id: string } | null>;
    create(args: Record<string, unknown>): Promise<{ id: string }>;
  };
  eaElement: {
    findMany(args: Record<string, unknown>): Promise<Array<{ id: string; properties: unknown }>>;
    create(args: Record<string, unknown>): Promise<{ id: string }>;
    update(args: Record<string, unknown>): Promise<unknown>;
  };
  eaRelationship: {
    findMany(args: Record<string, unknown>): Promise<Array<{ id: string; properties: unknown }>>;
    create(args: Record<string, unknown>): Promise<{ id: string }>;
    upsert(args: Record<string, unknown>): Promise<{ id: string }>;
    update(args: Record<string, unknown>): Promise<unknown>;
  };
  eaViewElement: {
    findFirst(args: Record<string, unknown>): Promise<{ id: string } | null>;
    create(args: Record<string, unknown>): Promise<{ id: string }>;
  };
  eaSnapshot: { create(args: Record<string, unknown>): Promise<{ id: string }> };
  eaConformanceIssue: {
    findFirst(args: Record<string, unknown>): Promise<{ id: string } | null>;
    create(args: Record<string, unknown>): Promise<{ id: string }>;
  };
};

export type MirrorContext = {
  notationId: string;
  notationSlug: string;
  elementTypeId: string;
  relationshipTypeId: string;
  viewId: string;
};

export type MirrorResult = {
  status: "applied" | "noop" | "blocked";
  summary: ReturnType<typeof summarizePlan>;
  snapshotWritten: boolean;
  duplicateIssues: number;
  viewId: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toExistingRow(row: { id: string; properties: unknown }): ExistingMirrorRow {
  const props = asRecord(row.properties);
  return {
    id: row.id,
    sourceKey: String(props.sourceKey ?? ""),
    descriptor: String(props.descriptor ?? ""),
    removed: props.mirrorRemoved === true,
  };
}

export async function resolveMirrorContext(prisma: MirrorPrismaClient): Promise<MirrorContext> {
  const notation = await prisma.eaNotation.findUnique({ where: { slug: NOTATION_SLUG } });
  if (!notation) throw new Error(`EA notation '${NOTATION_SLUG}' not found — seed the ArchiMate 4 notation first.`);

  const elementType = await prisma.eaElementType.findUnique({
    where: { notationId_slug: { notationId: notation.id, slug: ELEMENT_TYPE_SLUG } },
  });
  if (!elementType) throw new Error(`EA element type '${ELEMENT_TYPE_SLUG}' not found for notation '${NOTATION_SLUG}'.`);

  const relationshipType = await prisma.eaRelationshipType.findUnique({
    where: { notationId_slug: { notationId: notation.id, slug: RELATIONSHIP_TYPE_SLUG } },
  });
  if (!relationshipType) {
    throw new Error(`EA relationship type '${RELATIONSHIP_TYPE_SLUG}' not found for notation '${NOTATION_SLUG}'.`);
  }

  const viewId = await ensureDataModelView(prisma, notation.id);

  return {
    notationId: notation.id,
    notationSlug: notation.slug,
    elementTypeId: elementType.id,
    relationshipTypeId: relationshipType.id,
    viewId,
  };
}

export async function ensureDataModelView(prisma: MirrorPrismaClient, notationId: string): Promise<string> {
  const viewpoint = await prisma.viewpointDefinition.upsert({
    where: { name: VIEWPOINT_NAME },
    update: {
      description: "Logical data model mirrored from the Prisma schema.",
      allowedElementTypeSlugs: [ELEMENT_TYPE_SLUG],
      allowedRelTypeSlugs: [RELATIONSHIP_TYPE_SLUG],
    },
    create: {
      name: VIEWPOINT_NAME,
      description: "Logical data model mirrored from the Prisma schema.",
      allowedElementTypeSlugs: [ELEMENT_TYPE_SLUG],
      allowedRelTypeSlugs: [RELATIONSHIP_TYPE_SLUG],
    },
  });

  const existing = await prisma.eaView.findFirst({
    where: { scopeType: VIEW_SCOPE_TYPE, scopeRef: VIEW_SCOPE_REF },
  });
  if (existing) return existing.id;

  const created = await prisma.eaView.create({
    data: {
      notationId,
      name: "Data Model",
      description: "Live ERD mirrored from the Prisma schema (system-owned).",
      layoutType: "graph",
      scopeType: VIEW_SCOPE_TYPE,
      scopeRef: VIEW_SCOPE_REF,
      viewpointId: viewpoint.id,
      status: "draft",
    },
  });
  return created.id;
}

export async function loadExistingMirror(prisma: MirrorPrismaClient): Promise<{
  elements: ExistingMirrorRow[];
  relationships: ExistingMirrorRow[];
}> {
  const elementRows = await prisma.eaElement.findMany({
    where: { properties: { path: ["sourceKey"], string_starts_with: MODEL_SOURCE_KEY_PREFIX } },
    select: { id: true, properties: true },
  });
  const relationshipRows = await prisma.eaRelationship.findMany({
    where: { properties: { path: ["sourceKey"], string_starts_with: RELATION_SOURCE_KEY_PREFIX } },
    select: { id: true, properties: true },
  });
  return {
    elements: elementRows.map(toExistingRow),
    relationships: relationshipRows.map(toExistingRow),
  };
}

async function writeDuplicateIssues(
  prisma: MirrorPrismaClient,
  viewId: string,
  plan: MirrorPlan,
): Promise<number> {
  let written = 0;
  for (const conflict of plan.duplicates) {
    const existing = await prisma.eaConformanceIssue.findFirst({
      where: { issueType: DUPLICATE_ISSUE_TYPE, status: "open", viewId },
    });
    // One open umbrella issue per source key; skip if an identical open one exists.
    if (existing) continue;
    await prisma.eaConformanceIssue.create({
      data: {
        viewId,
        issueType: DUPLICATE_ISSUE_TYPE,
        severity: "error",
        status: "open",
        message: `Mirror source key '${conflict.sourceKey}' maps to ${conflict.ids.length} ${conflict.scope} rows; reconcile halted to avoid duplication.`,
        detailsJson: { scope: conflict.scope, sourceKey: conflict.sourceKey, ids: conflict.ids },
      },
    });
    written += 1;
  }
  return written;
}

export function elementCreateData(ctx: MirrorContext, desired: DesiredElement) {
  return {
    elementTypeId: ctx.elementTypeId,
    name: desired.name,
    lifecycleStage: "production",
    lifecycleStatus: "active",
    infraCiKey: desired.sourceKey,
    properties: {
      ...desired.properties,
      descriptor: desired.descriptor,
      mirrorRemoved: false,
    } as Prisma.InputJsonValue,
  };
}

export function relationshipCreateData(
  ctx: MirrorContext,
  desired: DesiredRelationship,
  fromElementId: string,
  toElementId: string,
) {
  return {
    fromElementId,
    toElementId,
    relationshipTypeId: ctx.relationshipTypeId,
    notationSlug: ctx.notationSlug,
    properties: {
      ...desired.properties,
      descriptor: desired.descriptor,
      mirrorRemoved: false,
    } as Prisma.InputJsonValue,
  };
}

/**
 * Reconcile the Prisma data model into the EA substrate. Deterministic and
 * idempotent: a no-delta run performs no writes and no snapshot.
 */
export async function reconcileDataModelMirror(deps: {
  prisma: MirrorPrismaClient;
  facts: PrismaSchemaFacts;
  createdById?: string | null;
  syncNeo4j?: (ctx: MirrorContext) => Promise<void>;
}): Promise<MirrorResult> {
  const { prisma, facts } = deps;
  const ctx = await resolveMirrorContext(prisma);
  const existing = await loadExistingMirror(prisma);
  const plan = planMirror(facts, existing);
  const summary = summarizePlan(plan);

  if (plan.blocked) {
    const duplicateIssues = await writeDuplicateIssues(prisma, ctx.viewId, plan);
    return { status: "blocked", summary, snapshotWritten: false, duplicateIssues, viewId: ctx.viewId };
  }

  if (!plan.material) {
    return { status: "noop", summary, snapshotWritten: false, duplicateIssues: 0, viewId: ctx.viewId };
  }

  // sourceKey -> elementId, seeded with existing rows then extended by creates.
  const elementIdByKey = new Map<string, string>();
  for (const row of existing.elements) elementIdByKey.set(row.sourceKey, row.id);

  // 1) Elements first (relationships need their endpoint ids).
  for (const op of plan.elementOps) {
    if (op.kind === "create") {
      const created = await prisma.eaElement.create({
        data: { ...elementCreateData(ctx, op.desired), createdById: deps.createdById ?? null },
      });
      elementIdByKey.set(op.desired.sourceKey, created.id);
      await ensureViewMembership(prisma, ctx.viewId, created.id);
    } else if (op.kind === "update" || op.kind === "revive") {
      await prisma.eaElement.update({
        where: { id: op.id },
        data: {
          name: op.desired.name,
          lifecycleStatus: "active",
          properties: { ...op.desired.properties, descriptor: op.desired.descriptor, mirrorRemoved: false },
        },
      });
      elementIdByKey.set(op.desired.sourceKey, op.id);
      await ensureViewMembership(prisma, ctx.viewId, op.id);
    } else if (op.kind === "remove") {
      await markRemoved(prisma, "eaElement", op.id);
    }
  }

  // 2) Relationships.
  for (const op of plan.relationshipOps) {
    if (op.kind === "create") {
      const fromId = elementIdByKey.get(op.desired.fromSourceKey);
      const toId = elementIdByKey.get(op.desired.toSourceKey);
      if (!fromId || !toId) continue; // endpoint missing (defensive); skip.
      if (fromId === toId) continue; // skip self-loops (projection noise)
      // Upsert on the (from, to, type) natural key so re-applies don't duplicate edges. BI-8C121D30.
      const data = { ...relationshipCreateData(ctx, op.desired, fromId, toId), createdById: deps.createdById ?? null };
      await prisma.eaRelationship.upsert({
        where: { fromElementId_toElementId_relationshipTypeId: { fromElementId: fromId, toElementId: toId, relationshipTypeId: ctx.relationshipTypeId } },
        create: data,
        update: { properties: data.properties },
      });
    } else if (op.kind === "update" || op.kind === "revive") {
      await prisma.eaRelationship.update({
        where: { id: op.id },
        data: { properties: { ...op.desired.properties, descriptor: op.desired.descriptor, mirrorRemoved: false } },
      });
    } else if (op.kind === "remove") {
      await markRemoved(prisma, "eaRelationship", op.id);
    }
  }

  // 3) Snapshot on material delta (evolution history).
  const activeElements = facts.models.length;
  const activeRelationships = plan.relationshipOps.length + existing.relationships.filter((r) => !r.removed).length;
  await prisma.eaSnapshot.create({
    data: {
      viewId: ctx.viewId,
      elementCount: activeElements,
      relationshipCount: activeRelationships,
      changeSummary: `Mirror reconcile: ${describeChange(summary)}.`,
      graphJson: {
        mirror: DATA_MODEL_MIRROR_VERSION,
        summary,
        models: facts.models.length,
        relations: facts.relations.length,
      },
    },
  });

  if (deps.syncNeo4j) {
    try {
      await deps.syncNeo4j(ctx);
    } catch {
      // Neo4j projection is best-effort; Postgres remains the source of truth.
    }
  }

  return { status: "applied", summary, snapshotWritten: true, duplicateIssues: 0, viewId: ctx.viewId };
}

async function ensureViewMembership(
  prisma: MirrorPrismaClient,
  viewId: string,
  elementId: string,
): Promise<void> {
  const existing = await prisma.eaViewElement.findFirst({ where: { viewId, elementId } });
  if (existing) return;
  await prisma.eaViewElement.create({ data: { viewId, elementId, mode: "existing" } });
}

async function markRemoved(
  prisma: MirrorPrismaClient,
  model: "eaElement" | "eaRelationship",
  id: string,
): Promise<void> {
  // Mark-removed via a JSON merge flag; never hard-delete (Never wipe to fix).
  const client = prisma[model];
  const current =
    model === "eaElement"
      ? await prisma.eaElement.findMany({ where: { id }, select: { id: true, properties: true } })
      : await prisma.eaRelationship.findMany({ where: { id }, select: { id: true, properties: true } });
  const props = asRecord(current[0]?.properties);
  await client.update({ where: { id }, data: { properties: { ...props, mirrorRemoved: true } } });
}
