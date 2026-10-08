// apps/web/lib/queue/functions/workroom-drive-children.ts
//
// Sub-shape child rooms for the graph drive (BI-8875C9DF, GPP Phase 3c
// PR-3c-5). Design:
// docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
// §9 (sub-shape); plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-5, workroom-drive-children.ts). Kept apart from workroom-drive.ts,
// which sits under its size ceiling.
//
// The planner decides (drive-child-rooms.ts); this module carries it out.
// Founder decision 2026-10-02 (design §14 Q2, Q6): the drive, as system
// actor, may create, complete and abandon child rooms.
//
// - ensureChildRoom: createWorkCapsule as the system actor, idempotent on
//   `sub-shape:<parent>:<cycle>:<stage>:<iteration>` (an existing key returns
//   the existing room), pinned to the stage's `key@version` through
//   withWorkShapeClaim, owned by the parent's owner (its Process Overseer, else
//   who requested or created it), with a parent→child `contains` relation
//   (skipDuplicates). The child records no repository
//   (SUB_SHAPE_ROOM_KEY_PREFIX), so it can be completed. It inherits nothing
//   else: no permit, binding or grant is copied; a child's calls mint permits
//   under its own workroom id (design §9.4).
// - recordChildCompletion: in ONE transaction, `child-completion` evidence on
//   the parent stage (outcome `completed`, with the child, its shape ref, its
//   disposition and the iteration), the child set `complete` through
//   updateWorkCapsuleStatus, and the parent→child `contains` row deleted.
//   Idempotent: a child already complete records nothing again.
// - abandonChild: in ONE transaction, the child set `abandoned` with the
//   reason, and its `contains` row deleted. A terminal child is left as it is.
//
// The drive deletes the `contains` row itself because the terminal-room
// reconcile covers only `standing-room:` keys (workroom-drive-data.ts,
// standing-room-nesting.ts).
//
// TECHNICAL CHECK (plan PR-3c-5): updateWorkCapsuleStatus authorizes nothing
// against its actor; the actor only attributes the `status-override`
// activity (recordedById is not a foreign key). The workroom reaper already
// calls it with a system actor. Completing a room is refused only by the
// publication boundary for a room that records a repository, which a sub-shape
// child never does, and by the governed path for a room linked to a backlog
// item, build or task run, which a child never is. So the system actor below
// completes and abandons children through the ordinary path.

import type { DrivePlan } from "@/lib/work-management/drive-resolution";
import { readStoredDriveMarking, type DriveMarking } from "@/lib/work-management/drive-marking";
import {
  liveSubShapeChildren,
  withChildEntry,
  type SubShapeAbandon,
  type SubShapeChildObservation,
  type SubShapeCompletion,
  type SubShapeEnsure,
} from "@/lib/work-management/drive-child-rooms";
import { readWorkShapeDefinitionContract } from "@/lib/work-management/work-shapes";
import { resolveWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";

import type { WorkroomDriveRoom } from "./workroom-drive";

/** The drive, acting for the platform on its own child rooms. Not a user: recordedById is not a foreign key. */
export const SUB_SHAPE_DRIVE_ACTOR = { userId: "system:workroom-drive", agentId: null, principalId: null } as const;

type ParentRef = { id: string; capsuleId: string; objective?: string | null };

export type SubShapeChildEffects = {
  /** Create (or find) the pass's child room. Resolves its capsule id, or null when it could not be created. */
  ensureChildRoom?: (input: { parent: ParentRef; ensure: SubShapeEnsure; now: Date }) => Promise<{ capsuleId: string } | null>;
  /** True once the completion is committed (or was already). */
  recordChildCompletion?: (input: { parent: ParentRef; completion: SubShapeCompletion; now: Date }) => Promise<boolean>;
  /** True once the abandonment is committed (or the child was already terminal). */
  abandonChild?: (input: { parent: ParentRef; abandon: SubShapeAbandon; now: Date }) => Promise<boolean>;
};

function isMarking(value: unknown): value is DriveMarking {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && "children" in (value as object) && "tokens" in (value as object);
}

/**
 * Carry out the plan's child effects, and return a function that writes what
 * committed into the snapshot's marking: a created child's entry, and the
 * `completed` or `abandoned` state of a child whose effect committed. An
 * effect that failed (false, null, or a throw) writes nothing and is decided
 * again next tick. Called only on a tick that commits its snapshot.
 */
export async function applySubShapeEffects(input: {
  room: WorkroomDriveRoom;
  plan: DrivePlan;
  effects: SubShapeChildEffects;
  now: Date;
}): Promise<(snapshot: Record<string, unknown>) => Record<string, unknown>> {
  const { room, plan, effects, now } = input;
  const identity = (snapshot: Record<string, unknown>) => snapshot;
  const work = plan.subShapes;
  if (!work) return identity;
  const parent: ParentRef = { id: room.id, capsuleId: room.capsuleId, objective: room.objective ?? null };
  const patches: Array<(marking: DriveMarking) => DriveMarking> = [];
  for (const ensure of work.ensure) {
    const created = effects.ensureChildRoom ? await effects.ensureChildRoom({ parent, ensure, now }).catch(() => null) : null;
    if (created) patches.push((marking) => withChildEntry(marking, ensure.key, { capsuleId: created.capsuleId, ref: ensure.ref }));
  }
  for (const completion of work.complete) {
    const done = effects.recordChildCompletion ? await effects.recordChildCompletion({ parent, completion, now }).catch(() => false) : false;
    if (done) patches.push((marking) => withChildEntry(marking, completion.key, { capsuleId: completion.childCapsuleId, ref: completion.ref, state: "completed" }));
  }
  for (const abandon of work.abandon) {
    const done = effects.abandonChild ? await effects.abandonChild({ parent, abandon, now }).catch(() => false) : false;
    if (done) patches.push((marking) => withChildEntry(marking, abandon.key, { capsuleId: abandon.childCapsuleId, ref: abandon.ref, state: "abandoned" }));
  }
  if (patches.length === 0) return identity;
  return (snapshot) => (isMarking(snapshot.marking)
    ? { ...snapshot, marking: patches.reduce((marking, patch) => patch(marking), snapshot.marking) }
    : snapshot);
}

/** The capsule ids of every live child the rooms' stored markings name, per parent capsule id. */
export function liveChildCapsuleIds(rooms: readonly Pick<WorkroomDriveRoom, "capsuleId" | "scopeClaims" | "workspaceState">[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const room of rooms) {
    const shape = resolveWorkShapeClaim(room.scopeClaims);
    if (!shape || !shape.stages.some((stage) => stage.subShape !== undefined)) continue;
    const read = readStoredDriveMarking(room.workspaceState, readWorkShapeDefinitionContract(shape), null);
    if (!read.ok || read.data.source !== "stored") continue;
    const ids = liveSubShapeChildren(read.data.marking).map(([, entry]) => entry.capsuleId);
    if (ids.length > 0) out.set(room.capsuleId, ids);
  }
  return out;
}

type ChildRow = { capsuleId: string; status: string; workspaceState: unknown };

function observe(row: ChildRow): SubShapeChildObservation {
  const state = row.workspaceState && typeof row.workspaceState === "object" ? (row.workspaceState as Record<string, unknown>) : {};
  const drive = state.workroomDrive && typeof state.workroomDrive === "object" ? (state.workroomDrive as Record<string, unknown>) : {};
  return {
    capsuleId: row.capsuleId,
    status: row.status,
    action: typeof drive.action === "string" ? drive.action : null,
    reason: typeof drive.reason === "string" ? drive.reason : null,
  };
}

/**
 * The rooms with their live children's observations attached (subShapeChildren),
 * read through one query of the child rows. Rooms with no live child are
 * returned as they are. A failed read attaches nothing: each child then reads
 * as running, so the parent keeps waiting, which is visible and safe.
 */
export async function withSubShapeChildren<R extends WorkroomDriveRoom>(
  rooms: R[],
  loadDb: () => Promise<{ workroom: { findMany(args: unknown): Promise<ChildRow[]> } }> = async () => (await import("@dpf/db")).prisma as never,
): Promise<R[]> {
  const byParent = liveChildCapsuleIds(rooms);
  const ids = [...new Set([...byParent.values()].flat())];
  if (ids.length === 0) return rooms;
  let rows: ChildRow[] = [];
  try {
    rows = await (await loadDb()).workroom.findMany({ where: { capsuleId: { in: ids } }, select: { capsuleId: true, status: true, workspaceState: true } });
  } catch {
    return rooms;
  }
  const byId = new Map(rows.map((row) => [row.capsuleId, observe(row)]));
  return rooms.map((room) => {
    const children = byParent.get(room.capsuleId);
    if (!children) return room;
    return { ...room, subShapeChildren: Object.fromEntries(children.flatMap((id) => (byId.has(id) ? [[id, byId.get(id)!]] : []))) };
  });
}

type ChildDb = {
  $transaction<T>(fn: (tx: ChildTx) => Promise<T>): Promise<T>;
};
type ChildTx = {
  workroom: {
    findUnique(args: unknown): Promise<any>;
    update(args: unknown): Promise<any>;
  };
  workroomRelation: {
    createMany(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
};

const TERMINAL = new Set(["complete", "abandoned", "archived"]);

/** The live child-room effects, over the platform database. */
export function createSubShapeChildEffects(loadDb: () => Promise<ChildDb> = async () => (await import("@dpf/db")).prisma as never): Required<SubShapeChildEffects> {
  return {
    async ensureChildRoom({ parent, ensure, now }) {
      const db = await loadDb();
      const [{ createWorkCapsule }, { establishRoomOwnership }, { withWorkShapeClaim, readWorkShapeClaim }] = await Promise.all([
        import("@/lib/work-capsules/work-capsule-store"),
        import("@/lib/work-capsules/room-ownership"),
        import("@/lib/work-management/workroom-shape-claim"),
      ]);
      return db.$transaction(async (tx) => {
        const row = await tx.workroom.findUnique({
          where: { id: parent.id },
          select: {
            id: true, requestedByPrincipalId: true, createdByPrincipalId: true,
            participants: { where: { lifecycle: "active" }, select: { principalId: true, roles: true } },
          },
        });
        if (!row) return null;
        const overseer = (row.participants as Array<{ principalId: string; roles: string[] }>).find((participant) => participant.roles.includes("coordinator"));
        const owner: string | null = overseer?.principalId ?? row.requestedByPrincipalId ?? row.createdByPrincipalId ?? null;
        const child = await createWorkCapsule({
          db: tx as never,
          input: {
            title: `${ensure.stageTitle} (${ensure.ref})`,
            objective: `Run sub-shape ${ensure.ref} for stage ${ensure.stageKey} of ${parent.capsuleId}${parent.objective ? `: ${parent.objective}` : "."}`,
            source: "scheduled-steward",
            idempotencyKey: ensure.idempotencyKey,
            status: "working",
            requestedByPrincipalId: owner,
          },
          actor: { ...SUB_SHAPE_DRIVE_ACTOR },
        });
        const claimed = readWorkShapeClaim(child.scopeClaims);
        if (!claimed || `${claimed.key}@${claimed.version}` !== ensure.ref) {
          await tx.workroom.update({ where: { id: child.id }, data: { scopeClaims: withWorkShapeClaim(child.scopeClaims, ensure.ref, now) as object } });
        }
        if (owner) await establishRoomOwnership(tx as never, { workroomId: child.id, ownerPrincipalId: owner, assistantPrincipalId: null });
        await tx.workroomRelation.createMany({ data: [{ fromWorkroomId: parent.id, toWorkroomId: child.id, relation: "contains" }], skipDuplicates: true });
        return { capsuleId: child.capsuleId as string };
      });
    },
    async recordChildCompletion({ parent, completion, now }) {
      const db = await loadDb();
      const { recordWorkCapsuleEvidence, updateWorkCapsuleStatus } = await import("@/lib/work-capsules/work-capsule-store");
      return db.$transaction(async (tx) => {
        const child = await tx.workroom.findUnique({ where: { capsuleId: completion.childCapsuleId }, select: { id: true, status: true } });
        if (!child) return false;
        if (child.status !== "complete") {
          await recordWorkCapsuleEvidence({
            db: tx as never,
            capsuleId: parent.capsuleId,
            evidence: {
              kind: "child-completion",
              summary: `Sub-shape ${completion.ref} completed in ${completion.childCapsuleId} (${completion.disposition}).`,
              stageKey: completion.stageKey,
              outcome: "completed",
              result: { childCapsuleId: completion.childCapsuleId, childShapeRef: completion.ref, disposition: completion.disposition, iteration: completion.iteration },
            },
            actor: { ...SUB_SHAPE_DRIVE_ACTOR },
            deferPublication: true,
          });
          await updateWorkCapsuleStatus({
            db: tx as never,
            capsuleId: completion.childCapsuleId,
            status: "complete",
            reason: `The sub-shape ${completion.ref} reached its success stop; stage ${completion.stageKey} of ${parent.capsuleId} moves on.`,
            actor: { ...SUB_SHAPE_DRIVE_ACTOR },
            now,
          });
        }
        await tx.workroomRelation.deleteMany({ where: { fromWorkroomId: parent.id, toWorkroomId: child.id, relation: "contains" } });
        return true;
      });
    },
    async abandonChild({ parent, abandon, now }) {
      const db = await loadDb();
      const { updateWorkCapsuleStatus } = await import("@/lib/work-capsules/work-capsule-store");
      return db.$transaction(async (tx) => {
        const child = await tx.workroom.findUnique({ where: { capsuleId: abandon.childCapsuleId }, select: { id: true, status: true } });
        if (!child) return false;
        if (!TERMINAL.has(child.status)) {
          await updateWorkCapsuleStatus({ db: tx as never, capsuleId: abandon.childCapsuleId, status: "abandoned", reason: abandon.reason, actor: { ...SUB_SHAPE_DRIVE_ACTOR }, now });
        }
        await tx.workroomRelation.deleteMany({ where: { fromWorkroomId: parent.id, toWorkroomId: child.id, relation: "contains" } });
        return true;
      });
    },
  };
}
