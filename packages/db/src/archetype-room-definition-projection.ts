import { prisma } from "./client";
import type { OperationalValueStream } from "@dpf/storefront-templates";

/**
 * Project an org's derived Operational Value Stream Model into room definitions.
 *
 * The sibling `archetype-value-stream-projection.ts` compiles the same OVSM into
 * EaElement rows for the `/ea/value-streams` canvas. This module compiles it into
 * the room definitions a coworker can hold. Both read the one derived OVSM, so
 * the diagram and the rooms cannot disagree about what the business runs: a stage
 * on the canvas is a room, and a room is a stage on the canvas.
 *
 * The mapping is fixed:
 *   stage key       -> sourceKey       (what opens the room)
 *   stage input     -> trigger         (what has to arrive)
 *   stage output    -> outcome         (what the room owes)
 *   responsibleRole -> required role   (who must be in it)
 *   trustGateKeys   -> gate bindings
 *   metricBindings  -> measure bindings
 *
 * No new Prisma model: definitions persist as EaElement rows under their own
 * `archetype-room-definition` source, on the same (source, orgId, stageKey)
 * identity the EA projection uses, so re-projecting updates in place and prunes
 * what the archetype no longer declares.
 */

const ARCHETYPE_ROOM_SOURCE = "archetype-room-definition";

type IdRow = { id: string };

interface RoomDefinitionDb {
  eaNotation: { findUnique(args: unknown): Promise<IdRow | null> };
  eaElementType: { findUnique(args: unknown): Promise<IdRow | null> };
  eaElement: {
    findFirst(args: unknown): Promise<IdRow | null>;
    findMany(args: unknown): Promise<IdRow[]>;
    create(args: unknown): Promise<IdRow>;
    update(args: unknown): Promise<IdRow>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  eaViewElement: { deleteMany(args: unknown): Promise<{ count: number }> };
  eaRelationship: { deleteMany(args: unknown): Promise<{ count: number }> };
}

/** A room a coworker can hold, derived from one value-stream stage. */
export interface ArchetypeRoomDefinition {
  definitionId: string;
  /** What opens the room. Mirrors the stage key. */
  sourceKey: string;
  label: string;
  streamKey: string;
  order: number;
  /** A load-bearing stage is work the business repeats, so its room stands. */
  mode: "standing" | "finite";
  /** What has to arrive. Null when the stage declares no input. */
  trigger: string | null;
  /** What the room owes when it closes. Null when the stage declares no output. */
  outcome: string | null;
  /** The role that must be present. Null when the stage names no owner. */
  requiredParticipantRole: string | null;
  gateBindings: string[];
  measureBindings: string[];
}

export interface ArchetypeRoomDefinitionSet {
  archetypeId: string;
  archetypeName: string;
  category: string;
  definitions: ArchetypeRoomDefinition[];
  /** Backbone stages the archetype declared it does not run, with the reason. */
  declaredOmissions: { stageKey: string; reason: string }[];
}

/**
 * Pure derivation: OVSM to room definitions. Deterministic and side-effect free,
 * so it is asserted without a database.
 */
export function buildArchetypeRoomDefinitions(
  ovsm: OperationalValueStream,
): ArchetypeRoomDefinitionSet {
  const definitions = ovsm.stages.map((stage): ArchetypeRoomDefinition => ({
    definitionId: `archetype-room:${ovsm.archetypeId}:${stage.key}`,
    sourceKey: stage.key,
    label: stage.label,
    streamKey: stage.streamKey,
    order: stage.order,
    mode: stage.loadBearing ? "standing" : "finite",
    trigger: stage.input,
    outcome: stage.output,
    requiredParticipantRole: stage.responsibleRole,
    gateBindings: [...stage.trustGateKeys],
    measureBindings: [...stage.metricBindings],
  }));

  return {
    archetypeId: ovsm.archetypeId,
    archetypeName: ovsm.archetypeName,
    category: ovsm.category,
    definitions,
    declaredOmissions: ovsm.declaredBackboneOmissions.map((omission) => ({ ...omission })),
  };
}

export interface ProjectArchetypeRoomDefinitionsInput {
  /** PrismaClient or a transaction client; typed unknown for the EA projection's heap reason. */
  db?: unknown;
  orgId: string;
  ovsm: OperationalValueStream;
}

export interface ProjectArchetypeRoomDefinitionsResult {
  created: number;
  updated: number;
  removed: number;
  definitionCount: number;
}

function roomMetadata(
  orgId: string,
  set: ArchetypeRoomDefinitionSet,
  definition: ArchetypeRoomDefinition,
): Record<string, unknown> {
  return {
    projection: {
      layoutRole: "room_definition",
      source: ARCHETYPE_ROOM_SOURCE,
      orgId,
      archetypeId: set.archetypeId,
      stageKey: definition.sourceKey,
      streamKey: definition.streamKey,
    },
    roomDefinition: {
      orgId,
      definitionId: definition.definitionId,
      sourceKey: definition.sourceKey,
      mode: definition.mode,
      trigger: definition.trigger,
      outcome: definition.outcome,
      requiredParticipantRole: definition.requiredParticipantRole,
      gateBindings: definition.gateBindings,
      measureBindings: definition.measureBindings,
      order: definition.order,
      declaredOmissions: set.declaredOmissions,
    },
  };
}

/**
 * Persist the org's room definitions. Idempotent on (source, orgId, stageKey);
 * a definition the archetype no longer declares is pruned, so changing archetype
 * cannot leave behind a room nothing produces.
 */
export async function projectArchetypeRoomDefinitions(
  input: ProjectArchetypeRoomDefinitionsInput,
): Promise<ProjectArchetypeRoomDefinitionsResult> {
  const db = (input.db ?? prisma) as unknown as RoomDefinitionDb;
  const { orgId, ovsm } = input;
  const set = buildArchetypeRoomDefinitions(ovsm);

  const notation = await db.eaNotation.findUnique({
    where: { slug: "archimate4" },
    select: { id: true },
  });
  if (!notation) throw new Error("ArchiMate 4 notation is not seeded");

  const stageType = await db.eaElementType.findUnique({
    where: { notationId_slug: { notationId: notation.id, slug: "value_stream_stage" } },
    select: { id: true },
  });
  if (!stageType) throw new Error("Required ArchiMate value stream stage type is not seeded");

  const existing = await db.eaElement.findMany({
    where: {
      AND: [
        { properties: { path: ["projection", "source"], equals: ARCHETYPE_ROOM_SOURCE } },
        { properties: { path: ["projection", "orgId"], equals: orgId } },
      ],
    },
    select: { id: true },
  });

  let created = 0;
  let updated = 0;
  const currentIds = new Set<string>();

  for (const definition of set.definitions) {
    const properties = roomMetadata(orgId, set, definition);
    const description =
      definition.trigger && definition.outcome
        ? `${definition.trigger} -> ${definition.outcome}`
        : `Room for ${definition.label}`;

    const found = await db.eaElement.findFirst({
      where: {
        elementTypeId: stageType.id,
        AND: [
          { properties: { path: ["projection", "source"], equals: ARCHETYPE_ROOM_SOURCE } },
          { properties: { path: ["projection", "orgId"], equals: orgId } },
          { properties: { path: ["projection", "stageKey"], equals: definition.sourceKey } },
        ],
      },
      select: { id: true },
    });

    if (found) {
      const row = await db.eaElement.update({
        where: { id: found.id },
        data: { name: definition.label, description, properties },
        select: { id: true },
      });
      currentIds.add(row.id);
      updated += 1;
    } else {
      const row = await db.eaElement.create({
        data: {
          notationId: notation.id,
          elementTypeId: stageType.id,
          name: definition.label,
          description,
          properties,
          lifecycleStage: "design",
          lifecycleStatus: "draft",
        },
        select: { id: true },
      });
      currentIds.add(row.id);
      created += 1;
    }
  }

  const orphanIds = existing.map((row) => row.id).filter((id) => !currentIds.has(id));
  let removed = 0;
  if (orphanIds.length > 0) {
    await db.eaRelationship.deleteMany({
      where: { OR: [{ sourceId: { in: orphanIds } }, { targetId: { in: orphanIds } }] },
    });
    await db.eaViewElement.deleteMany({ where: { elementId: { in: orphanIds } } });
    removed = (await db.eaElement.deleteMany({ where: { id: { in: orphanIds } } })).count;
  }

  return { created, updated, removed, definitionCount: set.definitions.length };
}
