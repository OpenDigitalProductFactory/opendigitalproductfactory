// Data loaders and reconcilers for the standing Workroom drive.
//
// Extracted from workroom-drive.ts, which the substrate-complexity guard
// correctly flagged as crossing the 800-LOC hotspot threshold as these
// accumulated. The drive decides; this module reads and writes what it decides
// over.

import { planCoordinationBindings } from "@/lib/authority/coordination-bindings";
import type { PrismaClient } from "@dpf/db";
import {
  COORDINATION_RESOURCE_TYPE,
  COORDINATION_SCOPE_TYPE,
} from "@/lib/work-management/coordinator-eligibility";
import type { RecordedEvidence } from "@/lib/work-management/stage-evidence-receipts";
import { planContainmentRelations, terminalStandingRoomIds } from "@/lib/work-management/standing-room-nesting";

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
      select: { id: true, capsuleId: true, idempotencyKey: true, status: true },
    });
    const byCapsuleId = new Map(rooms.map((room) => [room.capsuleId, room.id]));
    const rows = rooms.map((room) => ({
      capsuleId: room.capsuleId,
      idempotencyKey: room.idempotencyKey,
      status: room.status,
    }));
    // Withdraw containment for rooms that have since gone terminal: the rows
    // were materialized while those rooms were live, and a walk over the tree
    // must not find a retired duplicate beside its replacement (BI-CFB3FDB7).
    const retired = terminalStandingRoomIds(rows).flatMap((capsuleId) => {
      const id = byCapsuleId.get(capsuleId);
      return id ? [id] : [];
    });
    if (retired.length > 0) {
      await prisma.workroomRelation.deleteMany({
        where: {
          relation: "contains",
          OR: [{ toWorkroomId: { in: retired } }, { fromWorkroomId: { in: retired } }],
        },
      });
    }
    const plans = planContainmentRelations(rows);
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
 * When the room's current stage started: the actual agent dispatch for the
 * current stage and cycle, or — for a governed-decision stage, which is never
 * dispatched — the drive's own attention ask for that stage's decision.
 * Missing start is not permission to accept historical evidence.
 *
 * The attention branch is scoped to the room STILL waiting on that governed
 * decision (its stored pendingAttention), not to the cycle key. The drive writes
 * an attention row only when its hold changes (BI-E8C78E80), and the hold key
 * has no cycle in it, so a decision left waiting across a cycle rollover has no
 * row in the current cycle: on this install the dependency-advisory-watch room
 * asked on 2026-09-26 and was on cycle 2026-09-29 with no newer row. Cycle
 * scoping would have made its decision unreadable. The latest ask still bounds
 * the evidence, so a decision recorded before the room asked does not count.
 */
export async function loadStageDispatchTimes(
  capsuleIds: readonly string[],
  db?: Pick<PrismaClient, "$queryRaw">,
): Promise<Map<string, Date>> {
  if (capsuleIds.length === 0) return new Map();
  const source = db ?? (await import("@dpf/db")).prisma;
  const rows = await source.$queryRaw<Array<{ capsuleId: string; dispatchedAt: Date }>>`
    SELECT DISTINCT ON (w."capsuleId") w."capsuleId", a."recordedAt" AS "dispatchedAt"
    FROM "WorkCapsuleActivity" a
    JOIN "WorkCapsule" w ON w."id" = a."workCapsuleId"
    WHERE w."capsuleId" = ANY(${[...capsuleIds]}::text[])
      AND a."payload" ->> 'stageKey' = w."workspaceState" #>> '{workroomDrive,stageKey}'
      AND (
        (
          a."kind" = 'workroom-drive'
          AND a."payload" ->> 'action' = 'dispatch_agent'
          AND a."payload" ->> 'reason' = 'agent_stage'
          AND a."payload" ->> 'lastCycleKey' = w."workspaceState" #>> '{workroomDrive,lastCycleKey}'
        )
        OR (
          a."kind" = 'workroom-drive-attention'
          AND a."payload" ->> 'action' = 'attention'
          AND a."payload" ->> 'reason' = 'governed_decision'
          AND w."workspaceState" #>> '{workroomDrive,pendingAttention,reason}' = 'governed_decision'
          AND w."workspaceState" #>> '{workroomDrive,pendingAttention,stageKey}' = a."payload" ->> 'stageKey'
        )
      )
    ORDER BY w."capsuleId", a."recordedAt" DESC
  `;
  return new Map(rows.map((row) => [row.capsuleId, row.dispatchedAt]));
}

/**
 * Graph rooms only (GPP Phase 3c, BI-8875C9DF): when each marked stage most
 * recently started, per stage, for rooms whose stored drive snapshot carries a
 * `marking`. Sequential rooms keep loadStageDispatchTimes, unchanged.
 *
 * - A dispatch row counts for every stage it names in
 *   `payload.dispatchedStageKeys` (or, when absent, its single
 *   `payload.stageKey`), within the room's current cycle.
 * - An attention row counts for a stage the room is STILL waiting on as a
 *   governed decision: an entry of the stored `pendingAttentions` with reason
 *   `governed_decision`, matched against the row's own `pendingAttentions`. As
 *   for the sequential loader, the attention branch is not cycle-scoped.
 *
 * The latest row per stage wins, so a rework's fresh dispatch bounds the new
 * iteration's evidence.
 */
export async function loadStageDispatchTimesByStage(
  capsuleIds: readonly string[],
  db?: Pick<PrismaClient, "$queryRaw">,
): Promise<Map<string, Map<string, Date>>> {
  const byRoom = new Map<string, Map<string, Date>>();
  if (capsuleIds.length === 0) return byRoom;
  const source = db ?? (await import("@dpf/db")).prisma;
  const rows = await source.$queryRaw<Array<{ capsuleId: string; stageKey: string; dispatchedAt: Date }>>`
    SELECT DISTINCT ON (started."capsuleId", started."stageKey")
           started."capsuleId", started."stageKey", started."dispatchedAt"
    FROM (
      SELECT w."capsuleId", s."stageKey", a."recordedAt" AS "dispatchedAt"
      FROM "WorkCapsuleActivity" a
      JOIN "WorkCapsule" w ON w."id" = a."workCapsuleId"
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(a."payload" -> 'dispatchedStageKeys') = 'array' THEN a."payload" -> 'dispatchedStageKeys'
          WHEN jsonb_typeof(a."payload" -> 'stageKey') = 'string' THEN jsonb_build_array(a."payload" -> 'stageKey')
          ELSE '[]'::jsonb
        END
      ) AS s("stageKey")
      WHERE w."capsuleId" = ANY(${[...capsuleIds]}::text[])
        AND jsonb_typeof(w."workspaceState" #> '{workroomDrive,marking}') = 'object'
        AND a."kind" = 'workroom-drive'
        AND a."payload" ->> 'action' = 'dispatch_agent'
        AND a."payload" ->> 'lastCycleKey' = w."workspaceState" #>> '{workroomDrive,lastCycleKey}'
      UNION ALL
      SELECT w."capsuleId", p ->> 'stageKey' AS "stageKey", a."recordedAt" AS "dispatchedAt"
      FROM "WorkCapsuleActivity" a
      JOIN "WorkCapsule" w ON w."id" = a."workCapsuleId"
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(a."payload" -> 'pendingAttentions') = 'array' THEN a."payload" -> 'pendingAttentions' ELSE '[]'::jsonb END
      ) AS p
      WHERE w."capsuleId" = ANY(${[...capsuleIds]}::text[])
        AND jsonb_typeof(w."workspaceState" #> '{workroomDrive,marking}') = 'object'
        AND a."kind" = 'workroom-drive-attention'
        AND p ->> 'reason' = 'governed_decision'
        AND jsonb_typeof(w."workspaceState" #> '{workroomDrive,pendingAttentions}') = 'array'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(w."workspaceState" #> '{workroomDrive,pendingAttentions}') AS pending
          WHERE pending ->> 'reason' = 'governed_decision' AND pending ->> 'stageKey' = p ->> 'stageKey'
        )
    ) AS started
    WHERE started."stageKey" IS NOT NULL
    ORDER BY started."capsuleId", started."stageKey", started."dispatchedAt" DESC
  `;
  for (const row of rows) {
    const stages = byRoom.get(row.capsuleId) ?? new Map<string, Date>();
    stages.set(row.stageKey, row.dispatchedAt);
    byRoom.set(row.capsuleId, stages);
  }
  return byRoom;
}

/**
 * Stage-scoped evidence recorded through record_workroom_evidence. Executor
 * completion status is not evidence of a stage outcome.
 *
 * `choice` is the stage decision's `payload.result.choice` (the evidence
 * object is the payload, work-capsule-activity-store.ts). Phase 3c reads it
 * for gate verdicts from PR-3c-3; nothing reads it before then.
 *
 * The LIMIT 500 spans every room in the tick, not each room. That is a
 * pre-existing defect, recorded in the Phase 3c plan (risk R13) for its own
 * backlog item, and deliberately not changed here.
 */
export async function loadRecordedEvidence(
  capsuleIds: readonly string[],
  db?: Pick<PrismaClient, "$queryRaw">,
): Promise<Map<string, RecordedEvidence[]>> {
  const byRoom = new Map<string, RecordedEvidence[]>();
  if (capsuleIds.length === 0) return byRoom;
  try {
    const source = db ?? (await import("@dpf/db")).prisma;
    const rows = await source.$queryRaw<Array<{
      capsuleId: string;
      stageKey: string | null;
      evidenceKind: string | null;
      outcome: string | null;
      choice: string | null;
      recordedAt: Date;
    }>>`
      SELECT w."capsuleId"                      AS "capsuleId",
             a."payload" ->> 'stageKey'         AS "stageKey",
             a."payload" ->> 'kind'             AS "evidenceKind",
             a."payload" ->> 'outcome'          AS "outcome",
             a."payload" #>> '{result,choice}'  AS "choice",
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
        outcome: row.outcome,
        recordedAt: row.recordedAt,
        choice: row.choice ?? null,
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

/** Max rooms one drive tick will consider. Bounds CANDIDATES, not all rooms. */
export const STANDING_ROOM_SCAN_LIMIT = 200;

/**
 * Ids of the rooms the drive could possibly act on: non-terminal, not archived,
 * and actually carrying a work-shape claim.
 *
 * The claim lives inside the `scopeClaims` JSON, which Prisma cannot filter on
 * for an array of objects — so this is raw SQL rather than a `findMany` where
 * clause. That matters more than it looks: the previous implementation capped
 * `findMany` at 200 rows and only then filtered for the claim in JavaScript, so
 * the cap applied to ALL rooms rather than to candidates. On the reference
 * install that meant 276 non-terminal rooms, exactly one of them shaped, and a
 * drive that reported `scanned: 0` forever because the one shaped room fell
 * outside an unordered 200-row window. Filtering in SQL means the cap now
 * bounds work the drive can actually do, and `ORDER BY` makes which rooms it
 * takes deterministic instead of whatever the planner returned.
 */
export async function loadStandingRoomIds(db: {
  $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<Array<{ id: string }>>;
}): Promise<string[]> {
  const rows = await db.$queryRaw`
    SELECT "id"
    FROM "WorkCapsule"
    WHERE "archivedAt" IS NULL
      AND "status" NOT IN ('abandoned', 'archived', 'complete')
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          CASE jsonb_typeof("scopeClaims")
            WHEN 'array' THEN "scopeClaims"
            WHEN 'object' THEN jsonb_build_array("scopeClaims")
            ELSE '[]'::jsonb
          END
        ) AS claim
        WHERE claim ? 'workShape'
      )
    ORDER BY "updatedAt" ASC, "id" ASC
    LIMIT ${STANDING_ROOM_SCAN_LIMIT}
  `;
  return rows.map((row) => row.id);
}
