/**
 * Load a room's flow map (BI-FC0F4BD6, EP-B70E718D F3). Server only.
 *
 * Reads the room's declared shape and drive snapshot, this room's stage
 * telemetry, and the last four weeks of the shape version's stage snapshots,
 * then hands them to the pure builder. Returns null when the room declares no
 * resolvable shape — the room page then shows what it showed before.
 */
import type { QueueTelemetryRow } from "@/lib/queue/queue-metrics-rollup";

import { getWorkShape, getWorkShapeVersion, readDeclaredWorkShapeRef } from "./work-shapes";
import { buildWorkroomFlowMap, type StageSnapshot, type WorkroomFlowMapModel } from "./workroom-flow-map";
import { WORKROOM_STAGE_ITEM_KIND, readDriveObservation, workroomStageQueueKey } from "./workroom-stage-telemetry";

const DAY_MS = 24 * 60 * 60 * 1000;

export type WorkroomFlowMapDb = {
  workroom: {
    findUnique(args: {
      where: { id: string };
      select: { capsuleId: true; scopeClaims: true; workspaceState: true };
    }): Promise<{ capsuleId: string; scopeClaims: unknown; workspaceState: unknown } | null>;
  };
  queueTelemetryEvent: {
    findMany(args: unknown): Promise<QueueTelemetryRow[]>;
  };
  queueMetricSnapshot: {
    findMany(args: unknown): Promise<StageSnapshot[]>;
  };
};

export async function loadWorkroomFlowMap(
  db: WorkroomFlowMapDb,
  input: { roomRowId: string; now?: Date },
): Promise<WorkroomFlowMapModel | null> {
  const now = input.now ?? new Date();
  const room = await db.workroom.findUnique({
    where: { id: input.roomRowId },
    select: { capsuleId: true, scopeClaims: true, workspaceState: true },
  });
  if (!room) return null;
  const ref = readDeclaredWorkShapeRef(room.scopeClaims);
  if (!ref) return null;
  const [key, version] = ref.split("@");
  const definition = key ? (version ? getWorkShapeVersion(key, version) : getWorkShape(key)) : null;
  if (!definition) return null;
  const shapeRef = `${definition.key}@${definition.version}`;

  const [roomRows, snapshots] = await Promise.all([
    db.queueTelemetryEvent.findMany({
      where: {
        itemKind: WORKROOM_STAGE_ITEM_KIND,
        itemId: { startsWith: `${room.capsuleId}:` },
        occurredAt: { gte: new Date(now.getTime() - 90 * DAY_MS) },
      },
      select: { queueKey: true, itemKind: true, itemId: true, transition: true, outcome: true, occurredAt: true, laneKey: true },
      orderBy: { occurredAt: "asc" },
      take: 5000,
    }),
    db.queueMetricSnapshot.findMany({
      where: {
        queueKey: { in: definition.stages.map((stage) => workroomStageQueueKey(shapeRef, stage.key)) },
        period: { gte: new Date(now.getTime() - 28 * DAY_MS).toISOString().slice(0, 10) },
      },
      select: { queueKey: true, cycleP50Ms: true, throughput: true },
    }),
  ]);

  return buildWorkroomFlowMap({
    definition,
    current: readDriveObservation(room.workspaceState),
    roomRows,
    snapshots,
    now,
  });
}
