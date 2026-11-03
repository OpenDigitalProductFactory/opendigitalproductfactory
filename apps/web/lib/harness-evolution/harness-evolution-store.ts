// The Prisma side of the harness evolution loop (BI-49BC21C1 slice 1). Kept
// apart from the orchestration so the run is tested against a fake store and
// this file holds the only queries. Every read is bounded.

import { randomUUID } from "crypto";

import type { Prisma } from "@dpf/db";
import { prisma } from "@dpf/db";

import type { PlatformQueueItem } from "./room-candidates";

/** Room statuses that still do work; terminal and archived rooms are not improved. */
export const ACTIVE_ROOM_STATUSES = ["working", "ready", "blocked", "verifying", "ready-for-review", "ready-for-promotion"] as const;

export const HARNESS_EVOLUTION_ROOM_ACTIVITY_KIND = "harness-evolution-candidate";
export const HARNESS_EVOLUTION_COMMAND_SCOPE = "harness-evolution";
export const HARNESS_EVOLUTION_ARTIFACT_KIND = "harness-evolution-aggregate";

const ROOM_READ_LIMIT = 1_000;
const MISS_READ_LIMIT = 5_000;
const SIGNAL_READ_LIMIT = 200;

export type ActiveRoomRow = { id: string; capsuleId: string; scopeClaims: unknown; decisionScope: string | null };
export type ToolFailureRow = { capsuleId: string; id: string; toolName: string; error: string | null; createdAt: Date };
export type RoomActivityRow = { workCapsuleId: string; id: string; kind: string; recordedAt: Date };
export type ShapeSignalRow = { signalId: string; title: string; recurrenceCount: number; evidence: unknown };

export interface HarnessEvolutionStore {
  findRun(repeatedPatternKey: string): Promise<{ taskRunId: string } | null>;
  /** Active rooms updated since `since`, newest first. */
  listActiveRooms(since: Date): Promise<ActiveRoomRow[]>;
  listToolFailures(capsuleIds: readonly string[], since: Date): Promise<ToolFailureRow[]>;
  listRoomActivities(roomIds: readonly string[], kinds: readonly string[], since: Date): Promise<RoomActivityRow[]>;
  /** Open flow-bottleneck signals: shape-level evidence (flow-map design §8). */
  listShapeSignals(since: Date): Promise<ShapeSignalRow[]>;
  listBacklogItems(itemIds: readonly string[]): Promise<PlatformQueueItem[]>;
  /** One record per room per day; false when the day's record already exists. */
  recordRoomCandidates(input: {
    roomId: string; capsuleId: string; periodKey: string; agentId: string; summary: string; payload: Record<string, unknown>;
  }): Promise<boolean>;
  recordRun(input: {
    ownerUserId: string; agentId: string; taskId: string; periodKey: string; repeatedPatternKey: string;
    completedAt: Date; progressPayload: Record<string, unknown>; artifactData: Record<string, unknown>; artifactDescription: string;
  }): Promise<{ taskRunId: string }>;
}

export const prismaHarnessEvolutionStore: HarnessEvolutionStore = {
  async findRun(repeatedPatternKey) {
    return prisma.taskRun.findFirst({ where: { repeatedPatternKey }, select: { taskRunId: true } });
  },

  async listActiveRooms(since) {
    return prisma.workroom.findMany({
      where: { archivedAt: null, status: { in: [...ACTIVE_ROOM_STATUSES] }, updatedAt: { gte: since } },
      select: { id: true, capsuleId: true, scopeClaims: true, decisionScope: true },
      orderBy: [{ updatedAt: "desc" }, { capsuleId: "asc" }],
      take: ROOM_READ_LIMIT,
    });
  },

  async listToolFailures(capsuleIds, since) {
    if (!capsuleIds.length) return [];
    // Same `result.error` projection the MCP-efficiency scan uses; raw payloads stay in PostgreSQL.
    return prisma.$queryRaw<ToolFailureRow[]>`
      SELECT parameters->>'capsuleId' AS "capsuleId", id, "toolName",
        CASE WHEN jsonb_typeof(result->'error') = 'string' THEN left(result->>'error', 200) ELSE NULL END AS error,
        "createdAt"
      FROM "ToolExecution"
      WHERE success = false AND "createdAt" >= ${since}
        AND jsonb_typeof(parameters->'capsuleId') = 'string'
        AND parameters->>'capsuleId' = ANY(${[...capsuleIds]})
      ORDER BY "createdAt" DESC, id ASC
      LIMIT ${MISS_READ_LIMIT}`;
  },

  async listRoomActivities(roomIds, kinds, since) {
    if (!roomIds.length || !kinds.length) return [];
    return prisma.workroomActivity.findMany({
      where: { workCapsuleId: { in: [...roomIds] }, kind: { in: [...kinds] }, recordedAt: { gte: since } },
      select: { workCapsuleId: true, id: true, kind: true, recordedAt: true },
      orderBy: [{ recordedAt: "desc" }, { id: "asc" }],
      take: MISS_READ_LIMIT,
    });
  },

  async listShapeSignals(since) {
    return prisma.improvementSignal.findMany({
      where: { sourceType: "workroom-flow-bottleneck", status: "open", lastSeenAt: { gte: since } },
      select: { signalId: true, title: true, recurrenceCount: true, evidence: true },
      orderBy: [{ recurrenceCount: "desc" }, { signalId: "asc" }],
      take: SIGNAL_READ_LIMIT,
    });
  },

  async listBacklogItems(itemIds) {
    if (!itemIds.length) return [];
    return prisma.backlogItem.findMany({
      where: { itemId: { in: [...itemIds] } },
      select: { itemId: true, title: true, status: true },
    });
  },

  async recordRoomCandidates(input) {
    // The (commandScopeKey, commandKey) unique index makes a same-day retry a no-op.
    const { count } = await prisma.workroomActivity.createMany({
      data: [{
        workCapsuleId: input.roomId,
        kind: HARNESS_EVOLUTION_ROOM_ACTIVITY_KIND,
        summary: input.summary,
        payload: input.payload as Prisma.InputJsonValue,
        recordedByAgentId: input.agentId,
        commandScopeKey: HARNESS_EVOLUTION_COMMAND_SCOPE,
        commandKey: `${input.capsuleId}:${input.periodKey}`,
      }],
      skipDuplicates: true,
    });
    return count > 0;
  },

  async recordRun(input) {
    const taskRun = await prisma.taskRun.create({
      data: {
        taskRunId: `TR-HEV-${randomUUID().slice(0, 8).toUpperCase()}`,
        userId: input.ownerUserId,
        title: `Harness evolution loop ${input.periodKey}`,
        objective: "Record each ring-0 room's recurring misses as room-scoped harness-edit candidates and roll them up for promotion.",
        source: "proactive",
        status: "completed",
        authorityScope: [],
        a2aMetadata: { trigger: "harness-evolution-loop", scheduledTaskId: input.taskId },
        initiatingAgentId: input.agentId,
        currentAgentId: null,
        routeContext: "/platform/ai/skills",
        repeatedPatternKey: input.repeatedPatternKey,
        progressPayload: input.progressPayload as Prisma.InputJsonValue,
        completedAt: input.completedAt,
      },
      select: { id: true, taskRunId: true },
    });
    await prisma.taskArtifact.create({
      data: {
        id: randomUUID(),
        artifactId: `ta_${randomUUID()}`,
        taskRunId: taskRun.id,
        name: "Harness evolution aggregate",
        description: input.artifactDescription,
        // Widen through `unknown`: candidates carry `null` fields, which Prisma's
        // InputJsonValue type excludes although null is valid JSON.
        parts: [{ type: HARNESS_EVOLUTION_ARTIFACT_KIND, mimeType: "application/json", data: input.artifactData }] as unknown as Prisma.InputJsonValue,
        metadata: { kind: HARNESS_EVOLUTION_ARTIFACT_KIND, periodKey: input.periodKey },
      },
    });
    return { taskRunId: taskRun.taskRunId };
  },
};
