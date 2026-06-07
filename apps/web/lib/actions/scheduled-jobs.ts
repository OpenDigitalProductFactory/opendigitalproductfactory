"use server";

// BI-5A42E572 / EP-PROACTIVE-OPS — Scheduled Jobs admin surface server actions.
//
// Thin authn/authz + revalidate wrapper over the shared core module
// (lib/operate/scheduled-jobs/core.ts). All policy (core-locked enforcement,
// schedule validation, run-now eligibility) lives in core so the operator path
// here and any future coworker dispatch share one rule set.

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  listScheduledJobs,
  updateJobSchedule,
  setJobEnabled,
  runJobNow,
  type ScheduledJobView,
  type MutationResult,
} from "@/lib/operate/scheduled-jobs/core";

const JOBS_PATH = "/admin/scheduled-jobs";

type Actor = { actor: string };

/** Read access — same authority that gates the admin shell. */
async function requireRead(): Promise<void> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_admin")) {
    throw new Error("Unauthorized");
  }
}

/** Mutate access — platform-management authority (superuser / platform admin). */
async function requireManage(): Promise<Actor> {
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

export async function listScheduledJobsAction(): Promise<ScheduledJobView[]> {
  await requireRead();
  return listScheduledJobs();
}

export async function updateJobScheduleAction(
  jobId: string,
  schedule: string,
): Promise<MutationResult> {
  const { actor } = await requireManage();
  const result = await updateJobSchedule(jobId, schedule, actor);
  if (result.ok) revalidatePath(JOBS_PATH);
  return result;
}

export async function setJobEnabledAction(
  jobId: string,
  enabled: boolean,
): Promise<MutationResult> {
  const { actor } = await requireManage();
  const result = await setJobEnabled(jobId, enabled, actor);
  if (result.ok) revalidatePath(JOBS_PATH);
  return result;
}

export async function runJobNowAction(jobId: string): Promise<MutationResult> {
  const { actor } = await requireManage();
  const result = await runJobNow(jobId, actor);
  if (result.ok) revalidatePath(JOBS_PATH);
  return result;
}
