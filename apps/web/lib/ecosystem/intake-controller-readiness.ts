/**
 * Commissioning readiness for the inbound issue-intake controller (BI-FD40397B
 * AC-1, plan 2026-10-12 step 4).
 *
 * The admin register shows the AC-1 predicate as a checklist so an operator can
 * see which clause stops them before pressing Commission. Nothing here decides
 * authority: every row comes from evaluateIntakeControllerClauses, the same
 * clauses the runner and commissionIntakeController enforce. This module only
 *   - finds the candidate controller room (the recorded one, else the live
 *     issue-triage standing room),
 *   - evaluates the clauses against a candidate commission made out to the
 *     viewer, and
 *   - lets a platform manager become the room's owner through the one governed
 *     coordinator writer (executeCoordinatorAppointment).
 */

import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { TERMINAL_WORKROOM_STATUSES } from "@/lib/work-management/standing-room-nesting";
import { readWorkShapeClaimRef } from "@/lib/work-management/workroom-shape-claim";
import {
  INTAKE_CONTROLLER_JOB_ID,
  INTAKE_CONTROLLER_WORK_SHAPE,
  parseIntakeControllerCommission,
  type IntakeControllerCommission,
} from "@/lib/operate/scheduled-jobs/intake-controller-commission";

import {
  evaluateIntakeControllerAuthority,
  evaluateIntakeControllerClauses,
  isIntakeControllerOwner,
  loadIntakeControllerFacts,
  resolveIntakeControllerDb,
  type IntakeControllerClauseId,
  type IntakeControllerDb,
  type IntakeControllerDeps,
  type IntakeControllerFacts,
} from "./intake-controller-authority";

/** Standing rooms for issue triage are keyed `standing-room:issue-triage:v<n>`. */
export const INTAKE_CONTROLLER_ROOM_KEY_PREFIX = "standing-room:issue-triage";

export type IntakeControllerChecklistRow = {
  id: IntakeControllerClauseId;
  status: "pass" | "fail" | "unchecked";
  /** The predicate's plain reason when the clause fails; null otherwise. */
  reason: string | null;
};

export type IntakeControllerReadiness = {
  room: { capsuleId: string; status: string; repositoryFullName: string | null } | null;
  /** One row per clause, excluding the commission reference itself. */
  rows: IntakeControllerChecklistRow[];
  /** The first failing row: why Commission is unavailable. */
  blocking: IntakeControllerChecklistRow | null;
  canCommission: boolean;
  viewerIsOwner: boolean;
  ownership: {
    canBecomeOwner: boolean;
    /** Current coordinators who would hand over to the viewer. */
    handsOverFrom: string[];
  };
  commission: {
    workroomCapsuleId: string;
    repositoryFullName: string;
    commissionedBy: string;
    commissionedAt: string;
    /** Whether the recorded commission still passes the predicate. */
    holds: boolean;
    reason: string | null;
  } | null;
};

/** Clauses that must hold before taking ownership makes sense: the room itself is a valid controller. */
const ROOM_CLAUSES: IntakeControllerClauseId[] = ["room-found", "room-live", "work-shape", "locally-owned"];

function candidateReason(
  id: IntakeControllerClauseId,
  reason: string,
  facts: IntakeControllerFacts,
  viewerPrincipalRecordId: string | null,
): string {
  if (id === "room-found" && !facts.workroom) {
    return `no live ${INTAKE_CONTROLLER_WORK_SHAPE} room was found on this installation`;
  }
  if (id === "commissioner-owns") {
    return viewerPrincipalRecordId
      ? `you are not an active accountable or coordinator owner of workroom ${facts.workroom?.capsuleId ?? ""}`
      : "your account has no active person record that can own the room";
  }
  return reason;
}

/** Pure presenter: facts for a candidate commission (made out to the viewer) → checklist view. */
export function presentIntakeControllerReadiness(input: {
  candidateFacts: IntakeControllerFacts;
  recorded: IntakeControllerCommission | null;
  /** Facts for the recorded commission when it names a different room than the candidate. */
  recordedFacts?: IntakeControllerFacts;
  viewerPrincipalRecordId: string | null;
  /** Principal row id → display name. */
  principalNames: Record<string, string>;
}): IntakeControllerReadiness {
  const { candidateFacts: facts, viewerPrincipalRecordId: viewer } = input;
  const rows: IntakeControllerChecklistRow[] = evaluateIntakeControllerClauses(facts)
    .filter((clause) => clause.id !== "commission")
    .map((clause) => ({
      id: clause.id,
      status: clause.status,
      reason: clause.status === "fail" ? candidateReason(clause.id, clause.reason, facts, viewer) : null,
    }));
  const blocking = rows.find((row) => row.status === "fail") ?? null;
  const participants = facts.workroom?.participants ?? [];
  const viewerIsOwner = Boolean(viewer)
    && participants.some((p) => p.principalId === viewer && isIntakeControllerOwner(p));
  const roomIsController = rows.every((row) => !ROOM_CLAUSES.includes(row.id) || row.status === "pass");
  const name = (id: string) => input.principalNames[id] ?? id;

  let commission: IntakeControllerReadiness["commission"] = null;
  if (input.recorded) {
    const verdict = evaluateIntakeControllerAuthority({ ...(input.recordedFacts ?? facts), commission: input.recorded });
    commission = {
      workroomCapsuleId: input.recorded.workroomCapsuleId,
      repositoryFullName: input.recorded.repositoryFullName,
      commissionedBy: name(input.recorded.commissionedByPrincipalId),
      commissionedAt: input.recorded.commissionedAt,
      holds: verdict.commissioned,
      reason: verdict.commissioned ? null : verdict.reason,
    };
  }

  return {
    room: facts.workroom
      ? { capsuleId: facts.workroom.capsuleId, status: facts.workroom.status, repositoryFullName: facts.workroom.repositoryFullName }
      : null,
    rows,
    blocking,
    canCommission: blocking === null,
    viewerIsOwner,
    ownership: {
      canBecomeOwner: Boolean(viewer) && !viewerIsOwner && roomIsController,
      handsOverFrom: participants
        .filter((p) => p.lifecycle === "active" && p.roles.includes("coordinator") && p.principalId !== viewer)
        .map((p) => name(p.principalId)),
    },
    commission,
  };
}

// ── impure edge ───────────────────────────────────────────────────────────────

/** The narrow Prisma surface readiness reads, on top of the predicate's own. */
export type IntakeControllerReadinessDb = IntakeControllerDb & {
  workroom: IntakeControllerDb["workroom"] & {
    findMany(args: unknown): Promise<Array<{ capsuleId: string; scopeClaims: unknown }>>;
  };
  principal: { findMany(args: unknown): Promise<Array<{ id: string; displayName: string }>> };
};

async function findStandingRoom(db: IntakeControllerReadinessDb): Promise<string | null> {
  const rooms = await db.workroom.findMany({
    where: {
      idempotencyKey: { startsWith: INTAKE_CONTROLLER_ROOM_KEY_PREFIX },
      archivedAt: null,
      status: { notIn: [...TERMINAL_WORKROOM_STATUSES] },
    },
    select: { capsuleId: true, scopeClaims: true },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });
  return rooms.find((room) => readWorkShapeClaimRef(room.scopeClaims) === INTAKE_CONTROLLER_WORK_SHAPE)?.capsuleId ?? null;
}

function candidateFor(capsuleId: string, viewer: string | null): IntakeControllerCommission {
  return {
    workroomCapsuleId: capsuleId,
    repositoryFullName: "",
    workShape: INTAKE_CONTROLLER_WORK_SHAPE,
    commissionedByPrincipalId: viewer ?? "",
    commissionedAt: new Date(0).toISOString(),
  };
}

/** A room is a usable candidate when it exists, is live, and declares the controller shape. */
function roomUsable(facts: IntakeControllerFacts): boolean {
  return evaluateIntakeControllerClauses(facts)
    .filter((clause) => clause.id === "room-found" || clause.id === "room-live" || clause.id === "work-shape")
    .every((clause) => clause.status === "pass");
}

/**
 * Load the checklist for the recorded room, or for the live standing room when
 * nothing usable is recorded. The candidate commission names the viewer, so
 * the ownership clause answers "do YOU own it".
 */
export async function loadIntakeControllerReadiness(input: IntakeControllerDeps & {
  viewerPrincipalRecordId: string | null;
}): Promise<IntakeControllerReadiness> {
  const db = (await resolveIntakeControllerDb(input)) as IntakeControllerReadinessDb;
  const viewer = input.viewerPrincipalRecordId;
  const job = await db.scheduledJob.findUnique({ where: { jobId: INTAKE_CONTROLLER_JOB_ID }, select: { metadata: true } });
  const recorded = parseIntakeControllerCommission(job?.metadata);
  const load = (capsuleId: string) =>
    loadIntakeControllerFacts(db, candidateFor(capsuleId, viewer), input.loadEnvironment);

  let recordedFacts: IntakeControllerFacts | undefined;
  let facts: IntakeControllerFacts | null = null;
  if (recorded) {
    recordedFacts = await load(recorded.workroomCapsuleId);
    if (roomUsable(recordedFacts)) facts = recordedFacts;
  }
  if (!facts) {
    const standing = await findStandingRoom(db);
    facts = standing
      ? await load(standing)
      : await loadIntakeControllerFactsWithoutRoom(db, viewer, input);
  }
  // The candidate commission names the room's own repository, as commissioning would.
  facts = { ...facts, commission: { ...facts.commission!, repositoryFullName: facts.workroom?.repositoryFullName ?? "" } };

  const ids = new Set<string>(facts.workroom?.participants.map((p) => p.principalId) ?? []);
  if (recorded) ids.add(recorded.commissionedByPrincipalId);
  if (viewer) ids.add(viewer);
  const principals = ids.size > 0
    ? await db.principal.findMany({ where: { id: { in: [...ids] } }, select: { id: true, displayName: true } })
    : [];

  return presentIntakeControllerReadiness({
    candidateFacts: facts,
    recorded,
    recordedFacts,
    viewerPrincipalRecordId: viewer,
    principalNames: Object.fromEntries(principals.map((p) => [p.id, p.displayName])),
  });
}

/** Installation-level facts with no room: the room clauses fail plainly, the rest still answer. */
async function loadIntakeControllerFactsWithoutRoom(
  db: IntakeControllerReadinessDb,
  viewer: string | null,
  deps: IntakeControllerDeps,
): Promise<IntakeControllerFacts> {
  const noRoom: IntakeControllerDb = {
    ...db,
    workroom: { findFirst: async () => null },
  };
  return loadIntakeControllerFacts(noRoom, candidateFor("", viewer), deps.loadEnvironment);
}

// ── becoming the owner ───────────────────────────────────────────────────────

type AccessRefusal = { message: string } | null;

export type AppointIntakeControllerOwnerDeps = {
  loadReadiness: () => Promise<IntakeControllerReadiness>;
  /** coordinatorAppointmentAccessRefusal — the appoint_room_coordinator access rule. */
  accessRefusal: (input: { capsuleId: string; userId: string }) => Promise<AccessRefusal>;
  /** Principal row id → semantic principal ref (PRN-*). */
  resolvePrincipalRef: (principalRecordId: string) => Promise<string | null>;
  /** executeCoordinatorAppointment — the one write path for a room's owner. */
  appoint: (input: {
    capsuleId: string; principalRef: string; replaceExisting: boolean; reason: string | null;
  }) => Promise<ActionResult<{ capsuleId: string; principalRef: string; displayName: string }>>;
  recordActivity: (input: { capsuleId: string; userId: string; summary: string; principalRef: string }) => Promise<void>;
};

const OWNERSHIP_REASON = "Took ownership from Scheduled work to commission inbound issue intake (BI-FD40397B).";

/**
 * Make the signed-in platform manager the owner of the intake controller room.
 * Only the candidate room the checklist shows may be taken, and only when it is
 * a valid controller room the viewer does not already own. The caller checks
 * platform-management authority (lib/actions/scheduled-jobs.ts).
 */
export async function appointIntakeControllerOwner(input: AppointIntakeControllerOwnerDeps & {
  capsuleId: string;
  userId: string;
  principalRecordId: string;
}): Promise<ActionResult<string>> {
  try {
    const readiness = await input.loadReadiness();
    if (readiness.room?.capsuleId !== input.capsuleId) {
      return err(`Workroom ${input.capsuleId} is not the issue intake controller room.`);
    }
    if (!readiness.ownership.canBecomeOwner) {
      return err(readiness.viewerIsOwner
        ? `You already own ${input.capsuleId}.`
        : `${input.capsuleId} cannot take a new owner until it is a live, locally owned ${INTAKE_CONTROLLER_WORK_SHAPE} room.`);
    }
    const refusal = await input.accessRefusal({ capsuleId: input.capsuleId, userId: input.userId });
    if (refusal) return err(refusal.message);
    const principalRef = await input.resolvePrincipalRef(input.principalRecordId);
    if (!principalRef) return err("Your account has no active person record that can own the room.");

    const appointed = await input.appoint({
      capsuleId: input.capsuleId, principalRef, replaceExisting: true, reason: OWNERSHIP_REASON,
    });
    if (!appointed.ok) return err(appointed.error);
    await input.recordActivity({
      capsuleId: input.capsuleId,
      userId: input.userId,
      principalRef,
      summary: `${appointed.data.displayName} took ownership to commission inbound issue intake.`,
    });
    return ok(`${appointed.data.displayName} now owns ${appointed.data.capsuleId}.`);
  } catch (error) {
    return err(getErrorMessage(error));
  }
}
