"use server";

import { auth } from "@/lib/govern/auth";
import {
  taskrunRetry,
  taskrunAbandon,
  taskrunEscalate,
  TaskrunRecoveryError,
} from "./taskrun-recovery";
import { ok, err, type ActionResult } from "@/lib/shared/action-result";

/**
 * Server-action wrappers for Phase F recovery UI. They:
 *   1. resolve the operator's userId via the auth() session,
 *   2. call into the pure recovery functions,
 *   3. normalize errors into a discriminated result the UI can render.
 *
 * Errors include the TaskrunRecoveryError code (not_found / not_stalled /
 * ship_phase_requires_force) when applicable so the client can react
 * intelligently — e.g. surface a "this isn't stalled anymore" message
 * after a stale UI click.
 */

async function operatorUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

function describeError(err: unknown): string {
  if (err instanceof TaskrunRecoveryError) {
    return `${err.code}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function serverTaskrunRetry(
  taskRunId: string,
  opts: { force?: boolean } = {},
): Promise<ActionResult<{ newTaskRunId: string; strategy: string }>> {
  const userId = await operatorUserId();
  if (!userId) return err("Not authenticated");
  try {
    const { newTaskRunId, strategy } = await taskrunRetry(taskRunId, userId, opts);
    return ok({ newTaskRunId, strategy });
  } catch (e) {
    return err(describeError(e));
  }
}

export async function serverTaskrunAbandon(taskRunId: string): Promise<ActionResult> {
  const userId = await operatorUserId();
  if (!userId) return err("Not authenticated");
  try {
    await taskrunAbandon(taskRunId, userId);
    return ok();
  } catch (e) {
    return err(describeError(e));
  }
}

export async function serverTaskrunEscalate(
  taskRunId: string,
  notes?: string,
): Promise<ActionResult> {
  const userId = await operatorUserId();
  if (!userId) return err("Not authenticated");
  try {
    await taskrunEscalate(taskRunId, userId, notes);
    return ok();
  } catch (e) {
    return err(describeError(e));
  }
}
