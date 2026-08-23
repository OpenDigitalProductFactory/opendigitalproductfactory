import type { TwinTemplate } from "@dpf/storefront-templates";

import type {
  TwinActor,
  TwinSnapshot,
  TwinZoneSnapshot,
  TwinQueueSnapshot,
  TwinCogSnapshot,
  TwinStageFlow,
  TwinOutcome,
} from "@/components/twin";
import type {
  CapacityChipData,
  FeedEventData,
  QuestData,
  UtilityMeterData,
  WorkItemData,
} from "@/components/twin/types";
import type {
  OperationalDegradedSource,
  OperationalSourceWatermark,
} from "@/lib/operate/source-health";

export const OPERATIONS_SNAPSHOT_SCHEMA_VERSION = "operations.v1" as const;

export interface OperationsIdentity {
  archetypeId: string;
  archetypeName: string;
  template: TwinTemplate;
}

export type OperationsSourceWatermark = OperationalSourceWatermark;
export type OperationsDegradedSource = OperationalDegradedSource;

export interface OperationsSnapshotTelemetry {
  durationMs: number;
  queryCount: number;
  payloadBytes: number;
}

export interface OperationsSummarySlice {
  capacityChips: CapacityChipData[];
  stageFlow?: TwinStageFlow[];
  outcomes?: TwinOutcome[];
  outcomesHeading?: string;
  quests: QuestData[];
  utility: UtilityMeterData[];
}

export interface OperationsSceneSlice {
  zones: TwinZoneSnapshot[];
  workItems: WorkItemData[];
}

export interface OperationsConflict {
  entityId: string;
  kind: string;
  message: string;
}

export interface OperationsQueueSlice {
  queues: TwinQueueSnapshot[];
  cog?: TwinCogSnapshot;
  conflicts: OperationsConflict[];
}

export interface OperationsActivitySlice {
  presence: TwinActor[];
  feed: FeedEventData[];
}

export interface VersionedOperationsSnapshot {
  schemaVersion: typeof OPERATIONS_SNAPSHOT_SCHEMA_VERSION;
  identity: OperationsIdentity;
  asOf: string;
  version: string;
  sourceWatermark: string | null;
  sourceWatermarks: OperationsSourceWatermark[];
  freshness: "current" | "stale" | "degraded";
  degradedSources: OperationsDegradedSource[];
  summary: OperationsSummarySlice;
  scene: OperationsSceneSlice;
  queue: OperationsQueueSlice;
  activity: OperationsActivitySlice;
  telemetry: OperationsSnapshotTelemetry;
}

export interface LiveTwinSnapshot extends TwinSnapshot {
  live: true;
  archetypeId: string;
  archetypeName: string;
  template: TwinTemplate;
}

export interface CreateVersionedOperationsSnapshotInput {
  identity: OperationsIdentity;
  twin: TwinSnapshot;
  asOf: string;
  sourceWatermarks: OperationsSourceWatermark[];
  degradedSources: OperationsDegradedSource[];
  conflicts?: OperationsConflict[];
  telemetry: OperationsSnapshotTelemetry;
  maxSourceAgeMs?: number;
}

function sourceWatermark(watermarks: OperationsSourceWatermark[]): string | null {
  let oldest: string | null = null;
  for (const watermark of watermarks) {
    if (!oldest || watermark.observedAt < oldest) oldest = watermark.observedAt;
  }
  return oldest;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function snapshotVersion(input: CreateVersionedOperationsSnapshotInput): string {
  // `asOf` and timing are intentionally excluded: rereading unchanged facts must
  // preserve the optimistic-concurrency token.
  return `ops-v1-${fnv1a(JSON.stringify({
    identity: input.identity,
    degradedSources: input.degradedSources,
    twin: input.twin,
  }))}`;
}

function resolveFreshness(
  input: CreateVersionedOperationsSnapshotInput,
  watermark: string | null,
): VersionedOperationsSnapshot["freshness"] {
  if (input.degradedSources.length > 0 || !watermark) return "degraded";
  const asOfMs = Date.parse(input.asOf);
  const watermarkMs = Date.parse(watermark);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(watermarkMs)) return "degraded";
  return asOfMs - watermarkMs > (input.maxSourceAgeMs ?? 30_000) ? "stale" : "current";
}

export function createVersionedOperationsSnapshot(
  input: CreateVersionedOperationsSnapshotInput,
): VersionedOperationsSnapshot {
  const watermark = sourceWatermark(input.sourceWatermarks);
  return {
    schemaVersion: OPERATIONS_SNAPSHOT_SCHEMA_VERSION,
    identity: input.identity,
    asOf: input.asOf,
    version: snapshotVersion(input),
    sourceWatermark: watermark,
    sourceWatermarks: input.sourceWatermarks,
    freshness: resolveFreshness(input, watermark),
    degradedSources: input.degradedSources,
    summary: {
      capacityChips: input.twin.capacityChips,
      stageFlow: input.twin.stageFlow,
      outcomes: input.twin.outcomes,
      outcomesHeading: input.twin.outcomesHeading,
      quests: input.twin.quests,
      utility: input.twin.utility,
    },
    scene: {
      zones: input.twin.zones,
      workItems: input.twin.workItems,
    },
    queue: {
      queues: input.twin.queues,
      cog: input.twin.cog,
      conflicts: input.conflicts ?? [],
    },
    activity: {
      presence: input.twin.presence,
      feed: input.twin.feed,
    },
    telemetry: input.telemetry,
  };
}

export function selectOperationsSummary(snapshot: VersionedOperationsSnapshot): OperationsSummarySlice {
  return snapshot.summary;
}

export function selectOperationsScene(snapshot: VersionedOperationsSnapshot): OperationsSceneSlice {
  return snapshot.scene;
}

export function selectOperationsQueues(snapshot: VersionedOperationsSnapshot): OperationsQueueSlice {
  return snapshot.queue;
}

export function selectOperationsActivity(snapshot: VersionedOperationsSnapshot): OperationsActivitySlice {
  return snapshot.activity;
}

export function toLivingBusinessSnapshot(snapshot: VersionedOperationsSnapshot): LiveTwinSnapshot {
  return {
    live: true,
    ...snapshot.identity,
    capacityChips: snapshot.summary.capacityChips,
    stageFlow: snapshot.summary.stageFlow,
    outcomes: snapshot.summary.outcomes,
    outcomesHeading: snapshot.summary.outcomesHeading,
    zones: snapshot.scene.zones,
    workItems: snapshot.scene.workItems,
    queues: snapshot.queue.queues,
    cog: snapshot.queue.cog,
    presence: snapshot.activity.presence,
    feed: snapshot.activity.feed,
    quests: snapshot.summary.quests,
    utility: snapshot.summary.utility,
  };
}
