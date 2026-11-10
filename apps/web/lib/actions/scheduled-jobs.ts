"use server";

// EP-SCHEDULING-SURFACE — Scheduled Jobs admin surface server actions.
//
// Thin authn/authz + revalidate wrapper. All policy (core-locked enforcement,
// cadence validation, which substrate a mutation lands on, run-now eligibility)
// lives in lib/operate/scheduled-jobs/control.ts so the operator path here and
// any coworker dispatch share one rule set.

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { requireCapability } from "@/lib/actions/shared/guards";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import type { IntakeControllerReadiness } from "@/lib/ecosystem/intake-controller-readiness";
import {
  retireAllSpent,
  retireWork,
  runWorkNow,
  setWorkEnabled,
  updateWorkSchedule,
  type MutationResult,
} from "@/lib/operate/scheduled-jobs/control";
import {
  listScheduledWork,
  type ScheduledWorkView,
} from "@/lib/operate/scheduled-jobs/register";

const JOBS_PATH = "/admin/scheduled-jobs";

/** Read access — same authority that gates the admin shell. */
async function requireRead(): Promise<void> {
  await requireCapability("view_admin");
}

/** Mutate access — platform-management authority (superuser / platform admin). */
async function requireManage(): Promise<{ actor: string; userId: string | null }> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_platform")
  ) {
    throw new Error("Unauthorized");
  }
  return { actor: user.email ?? "operator", userId: typeof user.id === "string" ? user.id : null };
}

export async function listScheduledJobsAction(): Promise<ScheduledWorkView[]> {
  await requireRead();
  return listScheduledWork();
}

export async function updateJobScheduleAction(
  jobId: string,
  schedule: string,
): Promise<MutationResult> {
  const { actor } = await requireManage();
  const result = await updateWorkSchedule(jobId, schedule, actor);
  if (result.ok) revalidatePath(JOBS_PATH);
  return result;
}

export async function setJobEnabledAction(
  jobId: string,
  enabled: boolean,
): Promise<MutationResult> {
  const { actor } = await requireManage();
  const result = await setWorkEnabled(jobId, enabled, actor);
  if (result.ok) revalidatePath(JOBS_PATH);
  return result;
}

export async function runJobNowAction(jobId: string): Promise<MutationResult> {
  const { actor } = await requireManage();
  const result = await runWorkNow(jobId, actor);
  if (result.ok) revalidatePath(JOBS_PATH);
  return result;
}

export async function retireJobAction(jobId: string): Promise<MutationResult> {
  const { actor } = await requireManage();
  const result = await retireWork(jobId, actor);
  if (result.ok) revalidatePath(JOBS_PATH);
  return result;
}

export async function retireSpentJobsAction(jobIds: string[]): Promise<MutationResult> {
  const { actor } = await requireManage();
  const result = await retireAllSpent(jobIds, actor);
  if (result.ok) revalidatePath(JOBS_PATH);
  return result;
}

/**
 * Commission the inbound issue-intake controller (BI-FD40397B AC-1, spec §6.1).
 *
 * Two authorities, both required: platform-management authority (as for every
 * other register mutation here) AND current ownership of the controller
 * Workroom by the acting user's active human principal. The predicate itself —
 * workroom, shape, local ownership, explicit repository, production install,
 * confirmed evolve-dpf intent — is the same one the runner re-checks before
 * every scan, so a commission written here cannot outlive its authority.
 */
export async function commissionIntakeControllerAction(
  workroomCapsuleId: string,
): Promise<MutationResult> {
  const { userId } = await requireManage();
  const { resolveActiveHumanPrincipalRecordIdForUser } = await import("@/lib/identity/principal-linking");
  const principalRecordId = userId ? await resolveActiveHumanPrincipalRecordIdForUser(userId) : null;
  if (!principalRecordId) {
    return err("not commissioned: your account has no active person record that can own the controller workroom");
  }
  const { commissionIntakeController } = await import("@/lib/ecosystem/intake-controller-authority");
  const result = await commissionIntakeController({ workroomCapsuleId, principalRecordId });
  if (!result.ok) return err(result.error);
  revalidatePath(JOBS_PATH);
  return ok(`Issue intake commissioned to ${result.data.workroomCapsuleId} for ${result.data.repositoryFullName}.`);
}

async function viewerPrincipalRecordId(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { resolveActiveHumanPrincipalRecordIdForUser } = await import("@/lib/identity/principal-linking");
  return resolveActiveHumanPrincipalRecordIdForUser(userId);
}

export type IntakeControllerPanelState = ActionResult<{ readiness: IntakeControllerReadiness; canManage: boolean }>;

/**
 * The commissioning checklist for the issue intake controller: each AC-1 clause
 * with pass/fail, evaluated as if the signed-in person commissioned it now.
 */
export async function loadIntakeControllerPanelAction(): Promise<IntakeControllerPanelState> {
  await requireRead();
  try {
    const session = await auth();
    const user = session?.user;
    const userId = typeof user?.id === "string" ? user.id : null;
    const canManage = Boolean(user)
      && can({ platformRole: user!.platformRole, isSuperuser: user!.isSuperuser }, "manage_platform");
    const { loadIntakeControllerReadiness } = await import("@/lib/ecosystem/intake-controller-readiness");
    const readiness = await loadIntakeControllerReadiness({ viewerPrincipalRecordId: await viewerPrincipalRecordId(userId) });
    return ok({ readiness, canManage });
  } catch (error) {
    const { getErrorMessage } = await import("@/lib/shared/get-error-message");
    return err(getErrorMessage(error));
  }
}

/**
 * Make the signed-in platform manager the owner (Process Overseer) of the issue
 * intake controller room, through the same governed writer and access rule as
 * appoint_room_coordinator. Any current coordinator is stood down and the
 * handover is recorded on the room.
 */
export async function becomeIntakeControllerOwnerAction(workroomCapsuleId: string): Promise<MutationResult> {
  const { userId } = await requireManage();
  const principalRecordId = await viewerPrincipalRecordId(userId);
  if (!userId || !principalRecordId) {
    return err("Your account has no active person record that can own the room.");
  }
  const [{ prisma }, readinessModule, { coordinatorAppointmentAccessRefusal }, { executeCoordinatorAppointment }] =
    await Promise.all([
      import("@dpf/db"),
      import("@/lib/ecosystem/intake-controller-readiness"),
      import("@/lib/work-capsules/oauth-workroom-ownership"),
      import("@/lib/work-management/execute-coordinator-appointment.server"),
    ]);
  const result = await readinessModule.appointIntakeControllerOwner({
    capsuleId: workroomCapsuleId,
    userId,
    principalRecordId,
    loadReadiness: () => readinessModule.loadIntakeControllerReadiness({ viewerPrincipalRecordId: principalRecordId }),
    accessRefusal: coordinatorAppointmentAccessRefusal,
    resolvePrincipalRef: async (id) =>
      (await prisma.principal.findUnique({ where: { id }, select: { principalId: true } }))?.principalId ?? null,
    appoint: executeCoordinatorAppointment,
    recordActivity: async ({ capsuleId, userId: recordedById, summary, principalRef }) => {
      const room = await prisma.workroom.findUnique({ where: { capsuleId }, select: { id: true } });
      if (!room) return;
      await prisma.workroomActivity.create({
        data: {
          workCapsuleId: room.id,
          kind: "governed-action",
          summary,
          recordedById,
          payload: { action: "appoint_room_coordinator", principalRef, via: JOBS_PATH, backlogItemId: "BI-FD40397B" },
        },
      });
    },
  });
  if (result.ok) revalidatePath(JOBS_PATH);
  return result;
}
