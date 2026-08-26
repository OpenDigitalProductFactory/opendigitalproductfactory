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
async function requireManage(): Promise<{ actor: string }> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_platform")
  ) {
    throw new Error("Unauthorized");
  }
  return { actor: user.email ?? "operator" };
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
