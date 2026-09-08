// Data loaders and reconcilers for the standing Workroom drive.
//
// Extracted from workroom-drive.ts, which the substrate-complexity guard
// correctly flagged as crossing the 800-LOC hotspot threshold as these
// accumulated. The drive decides; this module reads and writes what it decides
// over.

import { planCoordinationBindings } from "@/lib/authority/coordination-bindings";
import {
  COORDINATION_RESOURCE_TYPE,
  COORDINATION_SCOPE_TYPE,
} from "@/lib/work-management/coordinator-eligibility";
import type { RecordedEvidence } from "@/lib/work-management/stage-evidence-receipts";
import { planContainmentRelations } from "@/lib/work-management/standing-room-nesting";

/**
 * Write the declared standing-room tree, returning how many relations were newly
 * created. Idempotent: the (from, to, relation) unique constraint plus
 * skipDuplicates means a settled estate writes nothing and reports 0.
 *
 * Failure is non-fatal. Nesting is what the hierarchy is built on, but a room
 * that can still be driven must not be blocked because its parent link could not
 * be written this minute.
 */
export async function reconcileStandingRoomNesting(): Promise<number> {
  try {
    const { prisma } = await import("@dpf/db");
    const rooms = await prisma.workroom.findMany({
      where: { archivedAt: null, idempotencyKey: { startsWith: "standing-room:" } },
      select: { id: true, capsuleId: true, idempotencyKey: true },
    });
    const byCapsuleId = new Map(rooms.map((room) => [room.capsuleId, room.id]));
    const plans = planContainmentRelations(
      rooms.map((room) => ({ capsuleId: room.capsuleId, idempotencyKey: room.idempotencyKey })),
    );
    if (plans.length === 0) return 0;
    const created = await prisma.workroomRelation.createMany({
      data: plans.flatMap((plan) => {
        const fromWorkroomId = byCapsuleId.get(plan.fromCapsuleId);
        const toWorkroomId = byCapsuleId.get(plan.toCapsuleId);
        return fromWorkroomId && toWorkroomId
          ? [{ fromWorkroomId, toWorkroomId, relation: "contains" as const }]
          : [];
      }),
      skipDuplicates: true,
    });
    return created.count;
  } catch {
    return 0;
  }
}

/**
 * Materialize coordination authority for the shapes this install ships.
 *
 * Idempotent by derivable bindingId: an existing binding is left exactly as the
 * operator has it — including SUSPENDED. Re-seeding must never silently
 * re-grant authority a human deliberately withdrew, which is the one way this
 * could become an authority-laundering path rather than a grant.
 *
 * Returns how many were newly created; a settled install reports 0.
 */
export async function reconcileCoordinationBindings(): Promise<number> {
  try {
    const { prisma } = await import("@dpf/db");
    const plans = planCoordinationBindings();
    if (plans.length === 0) return 0;
    const existing = await prisma.authorityBinding.findMany({
      where: { bindingId: { in: plans.map((plan) => plan.bindingId) } },
      select: { bindingId: true },
    });
    const known = new Set(existing.map((row) => row.bindingId));
    const missing = plans.filter((plan) => !known.has(plan.bindingId));
    if (missing.length === 0) return 0;
    let created = 0;
    for (const plan of missing) {
      const agent = await prisma.principal.findFirst({
        where: { kind: "agent", principalId: plan.agentId },
        select: { id: true, principalId: true },
      });
      await prisma.authorityBinding.create({
        data: {
          bindingId: plan.bindingId,
          name: plan.name,
          scopeType: plan.scopeType,
          resourceType: plan.resourceType,
          resourceRef: plan.resourceRef,
          status: plan.status,
          approvalMode: plan.approvalMode,
          appliedAgentId: agent?.id ?? null,
          subjects: {
            create: plan.subjects.map((subject) => ({
              subjectType: subject.subjectType,
              subjectRef: subject.subjectRef,
              relation: subject.relation,
            })),
          },
        },
      });
      created += 1;
    }
    return created;
  } catch {
    // Never take the drive down over a seeding failure; rooms then read "absent"
    // and refuse, which is the safe pre-existing behaviour.
    return 0;
  }
}

/**
 * Stage-scoped evidence recorded through record_workroom_evidence, plus when
 * each room's current stage was last dispatched.
 *
 * This is the ONLY input a completing receipt is earned from. Executor status is
 * never consulted: 337 runs reported `completed` with zero tools executed, and
 * PR #5168 was correctly refused for proposing to trust exactly that.
 */
export async function loadRecordedEvidence(
  capsuleIds: readonly string[],
): Promise<Map<string, RecordedEvidence[]>> {
  const byRoom = new Map<string, RecordedEvidence[]>();
  if (capsuleIds.length === 0) return byRoom;
  try {
    const { prisma } = await import("@dpf/db");
    const rows = await prisma.$queryRaw<Array<{
      capsuleId: string;
      stageKey: string | null;
      evidenceKind: string | null;
      recordedAt: Date;
    }>>`
      SELECT w."capsuleId"                      AS "capsuleId",
             a."payload" ->> 'stageKey'         AS "stageKey",
             a."payload" ->> 'kind'             AS "evidenceKind",
             a."recordedAt"                     AS "recordedAt"
      FROM "WorkCapsuleActivity" a
      JOIN "WorkCapsule" w ON w."id" = a."workCapsuleId"
      WHERE a."kind" = 'evidence-recorded'
        AND w."capsuleId" = ANY(${[...capsuleIds]}::text[])
      ORDER BY a."recordedAt" DESC
      LIMIT 500
    `;
    for (const row of rows) {
      const entry: RecordedEvidence = {
        stageKey: row.stageKey,
        kind: row.evidenceKind,
        recordedAt: row.recordedAt,
      };
      const bucket = byRoom.get(row.capsuleId);
      if (bucket) bucket.push(entry);
      else byRoom.set(row.capsuleId, [entry]);
    }
  } catch {
    // No evidence read means no receipts earned: the stage re-dispatches, which
    // is visible and non-fabricating.
  }
  return byRoom;
}

export async function loadCoordinationBindings(): Promise<
  Map<string, Array<{ status: string; scopeType: string; resourceType: string; resourceRef: string }>>
> {
  const byShape = new Map<
    string,
    Array<{ status: string; scopeType: string; resourceType: string; resourceRef: string }>
  >();
  try {
    const { prisma } = await import("@dpf/db");
    const rows = await prisma.authorityBinding.findMany({
      where: { scopeType: COORDINATION_SCOPE_TYPE, resourceType: COORDINATION_RESOURCE_TYPE },
      select: { status: true, scopeType: true, resourceType: true, resourceRef: true },
    });
    for (const row of rows) {
      const bucket = byShape.get(row.resourceRef);
      if (bucket) bucket.push(row);
      else byShape.set(row.resourceRef, [row]);
    }
  } catch {
    // A binding lookup that fails must not take the drive down. Rooms then read
    // "unknown" and refuse, which is the pre-existing safe behaviour.
  }
  return byShape;
}
