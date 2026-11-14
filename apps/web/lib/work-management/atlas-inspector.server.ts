/**
 * Work Atlas room inspector read (BI-94C9AFC1, design §3.6).
 *
 * One selected room: its flow map from the same loader the room page uses
 * (`loadWorkroomFlowMap`), so the checklist cannot disagree with
 * `/workspace/cases/[caseKey]`, and its latest recorded activity as the live line.
 */
import { loadWorkroomFlowMap, type WorkroomFlowMapDb } from "@/lib/work-management/workroom-flow-map.server";
import type { WorkroomFlowMapModel } from "@/lib/work-management/workroom-flow-map";

export type AtlasInspectorDb = WorkroomFlowMapDb & {
  workroom: WorkroomFlowMapDb["workroom"] & {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
  workroomActivity: { findFirst(args: unknown): Promise<{ summary: string; recordedAt: Date } | null> };
};

export type AtlasInspectorData = {
  flow: WorkroomFlowMapModel | null;
  live: { summary: string; recordedAt: string } | null;
};

/** Null when no open room has this id. A failed telemetry read leaves the checklist out, not the panel. */
export async function loadAtlasInspector(db: AtlasInspectorDb, capsuleId: string, now: Date = new Date()): Promise<AtlasInspectorData | null> {
  const row = await db.workroom.findFirst({ where: { capsuleId, archivedAt: null }, select: { id: true } });
  if (!row) return null;
  const [flow, live] = await Promise.all([
    loadWorkroomFlowMap(db, { roomRowId: row.id, now }).catch(() => null),
    db.workroomActivity.findFirst({
      where: { workCapsuleId: row.id },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      select: { summary: true, recordedAt: true },
    }).catch(() => null),
  ]);
  return {
    flow,
    live: live ? { summary: live.summary, recordedAt: live.recordedAt.toISOString() } : null,
  };
}
