import { prisma } from "./client";
import type { OperationalValueStream } from "@dpf/storefront-templates";

/**
 * Persist an org's derived Operational Value Stream Model (OVSM) into the
 * existing EA substrate (EaElement / EaView / EaViewElement / EaRelationship) so
 * it renders on the same `/ea/value-streams` canvas as reference-model
 * projections and exports through the same ArchiMate path. Mirrors
 * `reference-model-projection.ts`, with two differences:
 *   1. an injectable `db` (setup calls with the package client; archetype-reset
 *      calls inside its `prisma.$transaction`);
 *   2. the source is a derived OVSM, not a seeded reference model, so idempotency
 *      keys on (source, orgId, stageKey) and a prune keeps the org's single
 *      operational view clean across archetype changes (e.g. rental→non-rental
 *      drops the Return & Inspect stage).
 *
 * No new Prisma table — this is a projection into EA elements/views.
 */

// Minimal structural DB interface — deliberately type-safety-light.
// Typing `db` as the full Prisma client (or `Prisma.TransactionClient`, an Omit
// mapped type) and calling ~20 delegate methods with recursive JSON-path `where`
// filters forced the type checker to instantiate Prisma's giant generic delegate
// types at every call site, which exhausted the typecheck / Next-build heap
// (OOM, PR #1798 CI). This narrow interface keeps the queries cheap to check; the
// real PrismaClient and a `$transaction` client both satisfy it at runtime, so we
// cast at the single boundary in projectArchetypeValueStream(). Query shapes are
// covered by the unit tests rather than the Prisma types.
type IdRow = { id: string };
interface OvsmDb {
  eaNotation: { findUnique(args: unknown): Promise<IdRow | null> };
  viewpointDefinition: { findUnique(args: unknown): Promise<IdRow | null> };
  eaElementType: { findUnique(args: unknown): Promise<IdRow | null> };
  eaRelationshipType: { findUnique(args: unknown): Promise<IdRow | null> };
  eaView: {
    findFirst(args: unknown): Promise<IdRow | null>;
    create(args: unknown): Promise<IdRow>;
    update(args: unknown): Promise<IdRow>;
  };
  eaElement: {
    findFirst(args: unknown): Promise<IdRow | null>;
    findMany(args: unknown): Promise<IdRow[]>;
    create(args: unknown): Promise<IdRow>;
    update(args: unknown): Promise<IdRow>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  eaViewElement: {
    findUnique(args: unknown): Promise<IdRow | null>;
    create(args: unknown): Promise<IdRow>;
    update(args: unknown): Promise<IdRow>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  eaRelationship: {
    findFirst(args: unknown): Promise<IdRow | null>;
    create(args: unknown): Promise<IdRow>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
}

const ARCHETYPE_OVSM_SOURCE = "archetype-ovsm";
/** Cross-cuts are rendered as stages but are not part of the linear flow. */
const FLOW_EXCLUDED_KEYS = new Set(["trust-compliance", "operate-improve"]);

export interface ProjectArchetypeValueStreamInput {
  /**
   * A PrismaClient or a `$transaction` client. Typed `unknown` on purpose: naming
   * the Prisma client type here forced every importer (incl. apps/web) to compute
   * Prisma's `Omit<PrismaClient, …>` mapped type, which blew the typecheck heap
   * (OOM, PR #1798 CI). It is cast to the narrow OvsmDb at the single boundary in
   * projectArchetypeValueStream(); callers pass `prisma` or a transaction client.
   */
  db?: unknown;
  orgId: string;
  ovsm: OperationalValueStream;
}

export interface ProjectArchetypeValueStreamResult {
  viewId: string;
  createdView: boolean;
  createdElements: number;
  updatedElements: number;
  createdViewElements: number;
  updatedViewElements: number;
  removedElements: number;
}

function buildScopeRef(orgId: string): string {
  return `${orgId}:operational`;
}

function bandMetadata(
  orgId: string,
  ovsm: OperationalValueStream,
  stream: OperationalValueStream["streams"][number],
): Record<string, unknown> {
  return {
    projection: {
      layoutRole: "stream_band",
      source: ARCHETYPE_OVSM_SOURCE,
      orgId,
      archetypeId: ovsm.archetypeId,
      streamKey: stream.key,
      stageKey: `__stream__:${stream.key}`,
    },
    operationalValueStream: {
      orgId,
      archetypeId: ovsm.archetypeId,
      category: ovsm.category,
      streamKey: stream.key,
      purpose: stream.purpose,
      input: stream.input,
      output: stream.output,
      responsibleRole: stream.responsibleRole,
      loadBearingStageKeys: ovsm.loadBearingStageKeys,
      capacityUnit: ovsm.capacityUnit,
      demandSignature: ovsm.demandSignature,
      trustGates: ovsm.trustGates,
      supportingCapabilities: ovsm.supportingCapabilities,
      // EaElement.itValueStream uses the EA notation's value-stream slugs
      // (evaluate/explore/…), a different taxonomy from the storefront IT4IT
      // stages, so the binding is stored here rather than mapped onto that field.
      it4itStageBinding: ovsm.it4itStageBinding,
    },
  };
}

function stageMetadata(
  orgId: string,
  ovsm: OperationalValueStream,
  stage: OperationalValueStream["stages"][number],
): Record<string, unknown> {
  return {
    projection: {
      layoutRole: "stream_stage",
      source: ARCHETYPE_OVSM_SOURCE,
      orgId,
      archetypeId: ovsm.archetypeId,
      stageKey: stage.key,
      streamKey: stage.streamKey,
    },
    operationalValueStream: {
      orgId,
      stageKey: stage.key,
      loadBearing: stage.loadBearing,
      capabilityBindings: stage.capabilityBindings,
      metricBindings: stage.metricBindings,
      trustGateKeys: stage.trustGateKeys,
      input: stage.input,
      output: stage.output,
      responsibleRole: stage.responsibleRole,
      handoffToStageKey: stage.handoffToStageKey,
      // OVSM-level facts denormalized onto each stage for cheap reads.
      capacityUnit: ovsm.capacityUnit,
      demandSignature: ovsm.demandSignature,
      trustGates: ovsm.trustGates,
      it4itStageBinding: ovsm.it4itStageBinding,
    },
  };
}

async function resolveElement(
  db: OvsmDb,
  input: {
    orgId: string;
    stageKey: string;
    elementTypeId: string;
    name: string;
    description: string;
    properties: Record<string, unknown>;
  },
): Promise<{ id: string; created: boolean }> {
  const existing = await db.eaElement.findFirst({
    where: {
      elementTypeId: input.elementTypeId,
      AND: [
        { properties: { path: ["projection", "source"], equals: ARCHETYPE_OVSM_SOURCE } },
        { properties: { path: ["projection", "orgId"], equals: input.orgId } },
        { properties: { path: ["projection", "stageKey"], equals: input.stageKey } },
      ],
    },
    select: { id: true },
  });

  if (existing) {
    const updated = await db.eaElement.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        description: input.description,
        properties: input.properties,
        lifecycleStage: "design",
        lifecycleStatus: "draft",
      },
      select: { id: true },
    });
    return { id: updated.id, created: false };
  }

  const created = await db.eaElement.create({
    data: {
      elementTypeId: input.elementTypeId,
      name: input.name,
      description: input.description,
      properties: input.properties,
      lifecycleStage: "design",
      lifecycleStatus: "draft",
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

async function resolveViewElement(
  db: OvsmDb,
  input: { viewId: string; elementId: string; parentViewElementId: string | null; orderIndex: number | null },
): Promise<{ id: string; created: boolean }> {
  const existing = await db.eaViewElement.findUnique({
    where: { viewId_elementId: { viewId: input.viewId, elementId: input.elementId } },
    select: { id: true },
  });

  if (existing) {
    const updated = await db.eaViewElement.update({
      where: { id: existing.id },
      data: {
        parentViewElementId: input.parentViewElementId,
        orderIndex: input.orderIndex,
        mode: "reference",
      },
      select: { id: true },
    });
    return { id: updated.id, created: false };
  }

  const created = await db.eaViewElement.create({
    data: {
      viewId: input.viewId,
      elementId: input.elementId,
      parentViewElementId: input.parentViewElementId,
      orderIndex: input.orderIndex,
      mode: "reference",
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

export async function projectArchetypeValueStream(
  input: ProjectArchetypeValueStreamInput,
): Promise<ProjectArchetypeValueStreamResult> {
  // Single boundary cast: the real PrismaClient / transaction client satisfies
  // OvsmDb structurally at runtime (see the OvsmDb note above).
  const db = (input.db ?? prisma) as unknown as OvsmDb;
  const { orgId, ovsm } = input;

  const notation = await db.eaNotation.findUnique({
    where: { slug: "archimate4" },
    select: { id: true },
  });
  if (!notation) throw new Error("ArchiMate 4 notation is not seeded");

  const viewpoint = await db.viewpointDefinition.findUnique({
    where: { name: "Business Architecture" },
    select: { id: true },
  });

  const [valueStreamType, valueStreamStageType, flowRelationshipType] = await Promise.all([
    db.eaElementType.findUnique({
      where: { notationId_slug: { notationId: notation.id, slug: "value_stream" } },
      select: { id: true },
    }),
    db.eaElementType.findUnique({
      where: { notationId_slug: { notationId: notation.id, slug: "value_stream_stage" } },
      select: { id: true },
    }),
    db.eaRelationshipType.findUnique({
      where: { notationId_slug: { notationId: notation.id, slug: "flows_to" } },
      select: { id: true },
    }),
  ]);

  if (!valueStreamType || !valueStreamStageType) {
    throw new Error("Required ArchiMate value stream types are not seeded");
  }

  // Resolve the org's single operational value-stream view (idempotent by scope).
  const scopeRef = buildScopeRef(orgId);
  const viewName = `${ovsm.archetypeName} — Operational Value Stream`;
  const existingView = await db.eaView.findFirst({
    where: { scopeType: "archetype_value_stream", scopeRef },
    select: { id: true },
  });
  const viewData = {
    notationId: notation.id,
    name: viewName,
    description: `Operational value stream for ${ovsm.archetypeName} (${ovsm.archetypeId})`,
    layoutType: "graph",
    scopeType: "archetype_value_stream",
    scopeRef,
    viewpointId: viewpoint?.id ?? null,
    status: "draft",
  };
  const view = existingView
    ? { id: (await db.eaView.update({ where: { id: existingView.id }, data: viewData, select: { id: true } })).id, created: false }
    : { id: (await db.eaView.create({ data: viewData, select: { id: true } })).id, created: true };

  // Snapshot existing projected elements for this org so we can prune orphans
  // (e.g. the Return & Inspect stage when resetting rental → non-rental).
  const existingElements = await db.eaElement.findMany({
    where: {
      AND: [
        { properties: { path: ["projection", "source"], equals: ARCHETYPE_OVSM_SOURCE } },
        { properties: { path: ["projection", "orgId"], equals: orgId } },
      ],
    },
    select: { id: true },
  });

  let createdElements = 0;
  let updatedElements = 0;
  let createdViewElements = 0;
  let updatedViewElements = 0;
  const currentElementIds = new Set<string>();
  const elementIdByStageKey = new Map<string, string>();

  const orderedStreams = [...ovsm.streams];
  for (let streamIndex = 0; streamIndex < orderedStreams.length; streamIndex += 1) {
    const stream = orderedStreams[streamIndex]!;
    const bandStageKey = `__stream__:${stream.key}`;
    const band = await resolveElement(db, {
      orgId,
      stageKey: bandStageKey,
      elementTypeId: valueStreamType.id,
      name: stream.label,
      description: stream.purpose,
      properties: bandMetadata(orgId, ovsm, stream),
    });
    band.created ? (createdElements += 1) : (updatedElements += 1);
    currentElementIds.add(band.id);

    const bandViewElement = await resolveViewElement(db, {
      viewId: view.id,
      elementId: band.id,
      parentViewElementId: null,
      orderIndex: streamIndex,
    });
    bandViewElement.created ? (createdViewElements += 1) : (updatedViewElements += 1);

    const orderedStages = [...stream.stages].sort((a, b) => a.order - b.order);
    for (let stageIndex = 0; stageIndex < orderedStages.length; stageIndex += 1) {
      const stage = orderedStages[stageIndex]!;
      const element = await resolveElement(db, {
        orgId,
        stageKey: stage.key,
        elementTypeId: valueStreamStageType.id,
        name: stage.label,
        description: `${stage.label} — ${ovsm.archetypeName}`,
        properties: stageMetadata(orgId, ovsm, stage),
      });
      element.created ? (createdElements += 1) : (updatedElements += 1);
      currentElementIds.add(element.id);
      elementIdByStageKey.set(stage.key, element.id);

      const stageViewElement = await resolveViewElement(db, {
        viewId: view.id,
        elementId: element.id,
        parentViewElementId: bandViewElement.id,
        orderIndex: stageIndex,
      });
      stageViewElement.created ? (createdViewElements += 1) : (updatedViewElements += 1);
    }
  }

  // Prune orphans no longer in the current stage set.
  const orphanIds = existingElements
    .map((e: { id: string }) => e.id)
    .filter((id: string) => !currentElementIds.has(id));
  let removedElements = 0;
  if (orphanIds.length > 0) {
    await db.eaRelationship.deleteMany({
      where: { OR: [{ fromElementId: { in: orphanIds } }, { toElementId: { in: orphanIds } }] },
    });
    await db.eaViewElement.deleteMany({ where: { elementId: { in: orphanIds } } });
    const removed = await db.eaElement.deleteMany({ where: { id: { in: orphanIds } } });
    removedElements = removed.count;
  }

  // Linear flow between sequential primary stages (cross-cuts excluded).
  if (flowRelationshipType) {
    const flowPairs: Array<{ fromKey: string; toKey: string; handoff: boolean }> = [];
    for (const stream of orderedStreams) {
      const flowStages = [...stream.stages]
        .sort((a, b) => a.order - b.order)
        .filter((stage) => !FLOW_EXCLUDED_KEYS.has(stage.key));
      for (let index = 0; index < flowStages.length - 1; index += 1) {
        flowPairs.push({ fromKey: flowStages[index]!.key, toKey: flowStages[index + 1]!.key, handoff: false });
      }
      for (const stage of flowStages) {
        if (stage.handoffToStageKey) {
          flowPairs.push({ fromKey: stage.key, toKey: stage.handoffToStageKey, handoff: true });
        }
      }
    }

    const seenPairs = new Set<string>();
    for (const pair of flowPairs) {
      const pairKey = `${pair.fromKey}->${pair.toKey}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      const fromId = elementIdByStageKey.get(pair.fromKey);
      const toId = elementIdByStageKey.get(pair.toKey);
      if (!fromId || !toId) continue;
      const existingRel = await db.eaRelationship.findFirst({
        where: { fromElementId: fromId, toElementId: toId, relationshipTypeId: flowRelationshipType.id },
        select: { id: true },
      });
      if (!existingRel) {
        await db.eaRelationship.create({
          data: {
            fromElementId: fromId,
            toElementId: toId,
            relationshipTypeId: flowRelationshipType.id,
            notationSlug: "archimate4",
            properties: {
              projection: { source: ARCHETYPE_OVSM_SOURCE, orgId },
              handoff: pair.handoff,
            },
          },
          select: { id: true },
        });
      }
    }
  }

  return {
    viewId: view.id,
    createdView: view.created,
    createdElements,
    updatedElements,
    createdViewElements,
    updatedViewElements,
    removedElements,
  };
}
