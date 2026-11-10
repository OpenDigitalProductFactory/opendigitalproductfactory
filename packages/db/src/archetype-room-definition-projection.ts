import { prisma } from "./client";
import type { Prisma } from "../generated/client/client";
import { isRecord } from "@dpf/validators";
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
 * identity the EA projection uses. Reconciliation withdraws missing definitions
 * without deleting their rows, references, or lifecycle history.
 */

const ARCHETYPE_ROOM_SOURCE = "archetype-room-definition";

type IdRow = { id: string };
type RoomRow = IdRow & { properties: Prisma.JsonValue; lifecycleStage: string; lifecycleStatus: string };

interface RoomDefinitionDb {
  eaNotation: { findUnique(args: Prisma.EaNotationFindUniqueArgs): Promise<IdRow | null> };
  eaElementType: { findUnique(args: Prisma.EaElementTypeFindUniqueArgs): Promise<IdRow | null> };
  eaElement: {
    findMany(args: Prisma.EaElementFindManyArgs): Promise<RoomRow[]>;
    create(args: Prisma.EaElementCreateArgs): Promise<IdRow>;
    update(args: Prisma.EaElementUpdateArgs): Promise<IdRow>;
  };
  lifecycleEvent: { create(args: Prisma.LifecycleEventCreateArgs): Promise<IdRow> };
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
  $connect?: () => Promise<void>;
  $transaction?: <T>(work: (tx: RoomDefinitionDb) => Promise<T>, options: { timeout: number }) => Promise<T>;
}

/** Serialize both projections by org inside one transaction. Prisma transaction
 * clients can expose $transaction for savepoints, but omit root connection
 * management. Reuse those clients so the caller retains transaction ownership. */
export async function withArchetypeProjectionTransaction<T>(
  inputDb: unknown, orgId: string, work: (tx: RoomDefinitionDb) => Promise<T>,
): Promise<T> {
  const db = (inputDb ?? prisma) as RoomDefinitionDb;
  const run = async (tx: RoomDefinitionDb) => {
    // Project a scalar, not PostgreSQL's void lock result (Prisma cannot decode
    // void). The materialized CTE follows the inventory projection convention.
    await tx.$queryRawUnsafe(
      "WITH acquired AS MATERIALIZED (SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))) SELECT 1 AS locked FROM acquired",
      `archetype-projection:${orgId}`,
    );
    return work(tx);
  };
  return typeof db.$connect === "function" && db.$transaction
    ? db.$transaction(run, { timeout: 30_000 }) : run(db);
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
  const roles = new Map(ovsm.streams.map((stream) => [stream.key, stream.responsibleRole]));
  const definitions = ovsm.stages.map((stage): ArchetypeRoomDefinition => ({
    definitionId: `archetype-room:${ovsm.archetypeId}:${stage.key}`,
    sourceKey: stage.key,
    label: stage.label,
    streamKey: stage.streamKey,
    order: stage.order,
    mode: stage.loadBearing ? "standing" : "finite",
    trigger: stage.input,
    outcome: stage.output,
    requiredParticipantRole: stage.responsibleRole?.trim() || roles.get(stage.streamKey)?.trim() || null,
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
  /** Definitions withdrawn from active use; rows and references are retained. */
  removed: number;
  definitionCount: number;
}

function roomMetadata(
  orgId: string,
  set: ArchetypeRoomDefinitionSet,
  definition: ArchetypeRoomDefinition,
): Prisma.InputJsonObject {
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
 * definitions no longer declared become inactive. Existing readers must filter
 * lifecycleStatus != inactive; history readers can still follow every old ID.
 */
export async function projectArchetypeRoomDefinitions(
  input: ProjectArchetypeRoomDefinitionsInput,
): Promise<ProjectArchetypeRoomDefinitionsResult> {
  return withArchetypeProjectionTransaction(input.db, input.orgId, (db) => projectRooms(db, input));
}

async function projectRooms(db: RoomDefinitionDb, input: ProjectArchetypeRoomDefinitionsInput) {
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
    select: { id: true, properties: true, lifecycleStage: true, lifecycleStatus: true },
  });
  const byStage = new Map(existing.map((row) => {
    const properties = isRecord(row.properties) ? row.properties : {};
    const projection = isRecord(properties.projection) ? properties.projection : {};
    return [projection.stageKey, row];
  }));

  let created = 0;
  let updated = 0;
  const currentIds = new Set<string>();

  for (const definition of set.definitions) {
    const found = byStage.get(definition.sourceKey);
    const previous = isRecord(found?.properties) ? found.properties : {};
    const metadata = roomMetadata(orgId, set, definition);
    const properties = { ...previous, ...metadata,
      projection: { ...(isRecord(previous.projection) ? previous.projection : {}), ...metadata.projection as Prisma.InputJsonObject },
      roomDefinition: { ...(isRecord(previous.roomDefinition) ? previous.roomDefinition : {}), ...metadata.roomDefinition as Prisma.InputJsonObject },
    } as Prisma.InputJsonObject;
    const description =
      definition.trigger && definition.outcome
        ? `${definition.trigger} -> ${definition.outcome}`
        : `Room for ${definition.label}`;

    if (found) {
      // These logical definitions are withdrawn reversibly, not moved to the
      // terminal retirement stage. Restoring a declaration preserves its ID.
      const reactivating = found.lifecycleStatus === "inactive" && found.lifecycleStage !== "retirement";
      const row = await db.eaElement.update({
        where: { id: found.id },
        data: { name: definition.label, description, properties, ...(reactivating ? { lifecycleStatus: "active" } : {}) },
        select: { id: true },
      });
      if (reactivating) await recordRoomStatus(db, found, "active", "Archetype stage restored");
      currentIds.add(row.id);
      updated += 1;
    } else {
      const row = await db.eaElement.create({
        data: {
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

  const orphans = existing.filter((row) => !currentIds.has(row.id) && row.lifecycleStatus !== "inactive");
  let removed = 0;
  for (const row of orphans) {
    await db.eaElement.update({
      where: { id: row.id }, data: { lifecycleStatus: "inactive" }, select: { id: true },
    });
    await recordRoomStatus(db, row, "inactive", "Archetype no longer declares this stage");
    removed++;
  }

  return { created, updated, removed, definitionCount: set.definitions.length };
}

async function recordRoomStatus(db: RoomDefinitionDb, row: RoomRow, toStatus: "active" | "inactive", reason: string) {
  await db.lifecycleEvent.create({
    data: { governedThingKind: "EaElement", governedThingId: row.id,
      fromStage: row.lifecycleStage, toStage: row.lifecycleStage,
      fromStatus: row.lifecycleStatus, toStatus, reason },
    select: { id: true },
  });
}
