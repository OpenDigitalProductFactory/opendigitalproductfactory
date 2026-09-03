// Appointing a Workroom's owner (BI-F63200A8).
//
// Conformance requires exactly one EXPLICIT Process Overseer before a room may
// execute. `persistWorkroomParticipantAssignment` has always been able to write
// one — it simply had no caller, so WC-A69BCABB woke 100 times, resolved its
// shape, projected a cycle, and refused every time for want of an owner.
//
// This is the missing caller. It is deliberately thin: the roster carrier, the
// role vocabulary and the conformance rules all already exist, and none of them
// are re-implemented here.

import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import type { WorkroomParticipantRole } from "./room-types";

export type AppointCoordinatorDb = {
  workroom: {
    findUnique(args: {
      where: { capsuleId: string };
      select: { id: true; capsuleId: true };
    }): Promise<{ id: string; capsuleId: string } | null>;
  };
  workroomParticipant: {
    findMany(args: {
      where: { workroomId: string; lifecycle: string };
      select: { principalId: true; roles: true };
    }): Promise<Array<{ principalId: string; roles: string[] }>>;
  };
  principal: {
    findFirst(args: {
      where: { principalId: string; status: string };
      select: { id: true; displayName: true };
    }): Promise<{ id: string; displayName: string } | null>;
  };
};

/** Composed from the shared action-result primitive rather than a local shape. */
export type AppointedCoordinator = {
  workroomId: string;
  capsuleId: string;
  principalRef: string;
  displayName: string;
};
export type AppointCoordinatorResult = ActionResult<AppointedCoordinator>;

/**
 * Validate an appointment against the rules conformance already enforces, so a
 * refusal happens here with a readable reason rather than as a paused room
 * nobody can explain.
 *
 * Deliberately NOT enforced here: whether the appointee is a sensible choice.
 * That is the ownership ladder's job (BI-24E7D59F). This only refuses what is
 * structurally invalid.
 */
export async function planCoordinatorAppointment(input: {
  db: AppointCoordinatorDb;
  capsuleId: string;
  principalRef: string;
  replaceExisting: boolean;
}): Promise<AppointCoordinatorResult> {
  const room = await input.db.workroom.findUnique({
    where: { capsuleId: input.capsuleId },
    select: { id: true, capsuleId: true },
  });
  if (!room) {
    return err(`workroom_not_found: no Workroom ${input.capsuleId}.`);
  }

  // An inactive or unknown principal would persist as a row the roster cannot
  // project — the room would look owned and still refuse to execute, which is
  // the failure mode this whole line of work exists to end.
  const principal = await input.db.principal.findFirst({
    where: { principalId: input.principalRef, status: "active" },
    select: { id: true, displayName: true },
  });
  if (!principal) {
    return err(
      `principal_not_found: no active principal ${input.principalRef}. An appointment `
        + "must name someone who can actually answer for the room.",
    );
  }

  const existing = await input.db.workroomParticipant.findMany({
    where: { workroomId: room.id, lifecycle: "active" },
    select: { principalId: true, roles: true },
  });
  const coordinators = existing.filter((p) => p.roles.includes("coordinator"));
  const alreadyThis = coordinators.some((p) => p.principalId === principal.id);
  if (coordinators.length > 0 && !alreadyThis && !input.replaceExisting) {
    // Conformance treats multiple_coordinators as blocking. Silently adding a
    // second would leave the room MORE stuck than before the appointment.
    return err(
      "coordinator_already_appointed: this room already has a Process Overseer. A room "
        + "may have exactly one — pass replaceExisting to hand over.",
    );
  }

  return ok({
    workroomId: room.id,
    capsuleId: room.capsuleId,
    principalRef: input.principalRef,
    displayName: principal.displayName,
  });
}

/** The roles an appointment writes. Coordinator is the Process Overseer role. */
export const COORDINATOR_ROLES: WorkroomParticipantRole[] = ["coordinator"];
