import type { AtlasHold, AtlasShapeMeta } from "@/lib/work-management/atlas-map";
import type { AtlasRoom } from "@/lib/work-management/atlas-projection";
import type { HeldWorkroomRow } from "@/lib/work-management/held-workrooms";
import { getWorkShape } from "@/lib/work-management/work-shapes";

/** Display title and stages for each shape on the map, from the shape registry. */
export function atlasShapeMeta(rooms: readonly AtlasRoom[]): Record<string, AtlasShapeMeta> {
  const meta: Record<string, AtlasShapeMeta> = {};
  for (const key of new Set(rooms.flatMap((room) => room.shape ? [room.shape] : []))) {
    const shape = getWorkShape(key);
    if (shape) meta[key] = { title: shape.title, stages: shape.stages.map((stage) => ({ key: stage.key, title: stage.title })) };
  }
  return meta;
}

/**
 * The drive's recorded hold for each held room, in words. This is what the
 * retired "Shared recovery issues" section said; it now shows on the room's row.
 */
export function atlasHolds(rows: readonly HeldWorkroomRow[]): Record<string, AtlasHold> {
  return Object.fromEntries(rows.map((row) => {
    const cause = row.reason === "executor_writeback_unavailable" ? "Stage results were not recorded" : row.reason.replaceAll("_", " ");
    const detail = row.deviationCodes.map((code) => code.replaceAll("_", " "));
    return [row.capsuleId, { reason: [cause, ...detail].join(", "), since: row.since }];
  }));
}
