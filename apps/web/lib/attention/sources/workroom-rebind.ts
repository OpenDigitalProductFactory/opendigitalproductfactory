// Workroom-rebind source — a room pinned to a superseded work-shape version
// reaches its owner (BI-CB5C0DCE, phase 4).
//
// A shape bump keeps pinned rooms running on their version
// (work-shape-prior-versions.ts); moving them is the owner's decision
// (rebind_workroom_shape / the room page). This reads what is already written —
// the room's claim against the registry — so there is one item per room, not
// one per drive tick, and no new writer.
// Spec: docs/superpowers/specs/2026-10-01-workroom-shape-rebind-design.md §4.4

import type { prisma } from "@dpf/db";

import { encodeWorkCaseKey } from "@/lib/work-management/case-key";
import { loadRoomAccountabilityBatch } from "@/lib/work-management/room-workforce.server";
import { diffWorkShapeBinding } from "@/lib/work-management/work-shape-binding-diff";
import { getWorkShape, getWorkShapeVersion, readWorkShapeDefinitionContract } from "@/lib/work-management/work-shapes";
import { readWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";

import type { AttentionItem } from "../types";

type Db = typeof prisma;

export const ROOM_REBIND_SCAN_LIMIT = 200;

export type RoomRebindRow = {
  id: string;
  capsuleId: string;
  title: string;
  scopeClaims: unknown;
  updatedAt: Date;
  /** The room's accountable person, when one resolves. */
  ownerPrincipalId?: string | null;
};

/** Pure: an item when the room's pin is behind the registry, else null. */
export function projectRoomRebind(row: RoomRebindRow): AttentionItem | null {
  const pinned = readWorkShapeClaim(row.scopeClaims);
  if (!pinned) return null;
  const current = getWorkShape(pinned.key);
  if (!current || current.version === pinned.version) return null;
  const from = getWorkShapeVersion(pinned.key, pinned.version);
  const classification = from
    ? diffWorkShapeBinding(readWorkShapeDefinitionContract(from), readWorkShapeDefinitionContract(current)).classification
    : null;
  const roomHref = `/workspace/cases/${encodeWorkCaseKey({ sourceType: "work-capsule", sourceId: row.capsuleId })}`;
  const what = classification === "widening"
    ? "It widens what the room can reach, so it waits for your decision."
    : classification === "narrowing"
      ? "It only narrows what the room can reach."
      : "The version this room runs is no longer in the registry, so the room cannot run until it is moved.";
  return {
    id: `workroom-rebind:${row.capsuleId}:${current.version}`,
    source: "workroom-rebind",
    title: `${row.title} — newer version ready`,
    context: `${row.title} (${row.capsuleId}) runs ${pinned.key}@${pinned.version}; ${current.version} is available. ${what}`,
    decisionClass: { scorability: "unscorable" },
    riskClass: "read",
    triage: {
      timeToAct: "none",
      residueReason: "awaiting-rebind",
      blastRadius: "this room keeps running on its current version until you decide",
      decideEffort: "judgment",
      irreversible: false,
    },
    createdAtIso: row.updatedAt.toISOString(),
    actions: [{ kind: "open-in-context", label: "Open room", href: roomHref }],
    deepLink: roomHref,
    audience: { operator: true, ...(row.ownerPrincipalId ? { assigneePrincipalId: row.ownerPrincipalId } : {}) },
  };
}

export async function loadWorkroomRebindItems(db: Db): Promise<AttentionItem[]> {
  const rows = await db.$queryRaw<Array<Omit<RoomRebindRow, "ownerPrincipalId">>>`
    SELECT w."id", w."capsuleId", w."title", w."scopeClaims", w."updatedAt"
    FROM "WorkCapsule" w
    WHERE w."archivedAt" IS NULL
      AND w."status" NOT IN ('abandoned', 'archived', 'complete')
      AND jsonb_typeof(w."scopeClaims") = 'array'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(w."scopeClaims") AS claim WHERE claim ? 'workShape')
    ORDER BY w."updatedAt" ASC
    LIMIT ${ROOM_REBIND_SCAN_LIMIT}
  `;
  const behind = rows.filter((row) => projectRoomRebind(row) !== null);
  if (behind.length === 0) return [];
  const owners = await loadRoomAccountabilityBatch(db as never, behind.map((row) => row.id));
  return behind.flatMap((row) => {
    const accountability = owners.get(row.id)?.accountability;
    const item = projectRoomRebind({
      ...row,
      ownerPrincipalId: accountability?.state === "resolved" ? accountability.principalId : null,
    });
    return item ? [item] : [];
  });
}
