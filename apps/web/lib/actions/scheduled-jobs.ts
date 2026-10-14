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
import { err, ok } from "@/lib/shared/action-result";
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
  if (!result.ok) return err(result.reason);
  revalidatePath(JOBS_PATH);
  return ok(`Issue intake commissioned to ${result.commission.workroomCapsuleId} for ${result.commission.repositoryFullName}.`);
}
