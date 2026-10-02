// The one write path for a room's Process Overseer: validate, stand the
// incumbent down, record the handover, write the appointee (BI-F63200A8,
// BI-061B2BC0). appoint_room_coordinator and the account handover
// (BI-F25A5FC7) both call this, so a room's owner changes by one rule.

import { prisma } from "@dpf/db";

import { err, ok, type ActionResult } from "@/lib/shared/action-result";

import { COORDINATOR_ROLES, planCoordinatorAppointment, rolesAfterStandDown } from "./appoint-room-coordinator";
import { persistWorkroomParticipantAssignment } from "./room-participant-assignment.server";

export type ExecutedAppointment = {
  capsuleId: string;
  principalRef: string;
  displayName: string;
};

export async function executeCoordinatorAppointment(input: {
  capsuleId: string;
  principalRef: string;
  replaceExisting: boolean;
  reason: string | null;
}): Promise<ActionResult<ExecutedAppointment>> {
  const plan = await planCoordinatorAppointment({
    db: prisma as never,
    capsuleId: input.capsuleId,
    principalRef: input.principalRef,
    replaceExisting: input.replaceExisting,
  });
  if (!plan.ok) return plan;
  const appointed = plan.data;

  // Demote first: a room briefly with no coordinator is recoverable, a room
  // with two is the blocking state a handover exists to fix (BI-061B2BC0).
  for (const outgoing of appointed.standDown) {
    await prisma.workroomParticipant.update({
      where: { id: outgoing.participantId },
      data: {
        roles: rolesAfterStandDown(outgoing.roles),
        lifecycleReason: `Stood down as Process Overseer: handed over to ${appointed.principalRef}.`,
      },
    });
    await prisma.workroomActivity.create({
      data: {
        workCapsuleId: appointed.workroomId,
        kind: "coworker-handoff",
        summary: `Process Overseer handed over to ${appointed.displayName} (${appointed.principalRef}).`,
        payload: {
          fromPrincipalId: outgoing.principalId,
          toPrincipalRef: appointed.principalRef,
          rolesRetained: rolesAfterStandDown(outgoing.roles),
          reason: input.reason,
        },
      },
    });
  }

  const written = await persistWorkroomParticipantAssignment({
    workroomId: appointed.workroomId,
    principalRef: appointed.principalRef,
    roles: COORDINATOR_ROLES,
    assignmentSource: "explicit",
    enteredReason: input.reason || "Appointed as the room's Process Overseer.",
    currentWorkSummary: null,
  });
  if (!written) return err("assignment_failed: The participant row could not be written.");
  return ok({ capsuleId: appointed.capsuleId, principalRef: appointed.principalRef, displayName: appointed.displayName });
}
