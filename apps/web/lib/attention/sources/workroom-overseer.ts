// Overseer items (BI-8E1486FA): what the drive's per-room overseer duty could
// not resolve itself, routed to the room's Process Overseer.
//
// The duty writes at most one record per room, at
// workspaceState.workroomOverseer.attention, and clears it when the cause goes
// away (lib/work-management/workroom-overseer-duty.ts). This source only reads
// it, like the stall source beside it: no table, no writer of its own. One
// record per room is the dedupe, and the item id is stable per room, so a
// re-raise never shows twice. It is listed under the workroom-stall source
// because it is the same residue: a room that waits on someone.

import type { prisma } from "@dpf/db";

import { encodeWorkCaseKey } from "@/lib/work-management/case-key";
import { readOverseerState } from "@/lib/work-management/workroom-overseer-duty";

import type { AttentionItem } from "../types";

type Db = typeof prisma;

/** Bounded like every other source. */
export const OVERSEER_ATTENTION_SCAN_LIMIT = 100;

export type OverseerAttentionRow = { capsuleId: string; title: string; updatedAt: Date; workspaceState: unknown };

export function projectOverseerAttention(row: OverseerAttentionRow): AttentionItem | null {
  const attention = readOverseerState(row.workspaceState).attention;
  if (!attention) return null;
  const roomHref = `/workspace/cases/${encodeWorkCaseKey({ sourceType: "work-capsule", sourceId: row.capsuleId })}`;
  const assignee = attention.assigneePrincipalRef;
  return {
    id: `workroom-overseer:${row.capsuleId}`,
    source: "workroom-stall",
    title: attention.title || `${row.title} needs its owner`,
    context: attention.context,
    decisionClass: { scorability: "unscorable" },
    riskClass: "read",
    triage: {
      timeToAct: "none",
      residueReason: "room-stalled",
      blastRadius: assignee
        ? "this room's outcome, and a later claim on its item"
        : "this room's outcome — and it has no overseer to route to",
      decideEffort: "judgment",
      irreversible: false,
    },
    createdAtIso: attention.raisedAt || row.updatedAt.toISOString(),
    actions: [{ kind: "open-in-context", label: "Open room", href: roomHref }],
    deepLink: roomHref,
    audience: { operator: true, ...(assignee ? { assigneePrincipalId: assignee } : {}) },
  };
}

export async function loadWorkroomOverseerItems(db: Db): Promise<AttentionItem[]> {
  const rows = await db.$queryRaw<OverseerAttentionRow[]>`
    SELECT w."capsuleId" AS "capsuleId", w."title" AS "title", w."updatedAt" AS "updatedAt", w."workspaceState" AS "workspaceState"
    FROM "WorkCapsule" w
    WHERE w."archivedAt" IS NULL
      AND w."status" NOT IN ('abandoned', 'archived', 'complete')
      AND jsonb_typeof(w."workspaceState" #> '{workroomOverseer,attention}') = 'object'
    ORDER BY w."updatedAt" ASC
    LIMIT ${OVERSEER_ATTENTION_SCAN_LIMIT}
  `;
  return rows.map(projectOverseerAttention).filter((item): item is AttentionItem => item !== null);
}
