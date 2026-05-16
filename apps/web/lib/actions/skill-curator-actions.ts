"use server";

// Slice 4 admin surface for the skill curator and lifecycle controls.
// All actions require `manage_capabilities` so operator-set state changes
// share authority with proposal approval (Slice 3).

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  runSkillCurator as runCurator,
  type CuratorReport,
} from "@/lib/skills/curator";
import {
  isSkillLifecycleState,
  type SkillLifecycleState,
} from "@/lib/skills/lifecycle";

type AuthOk = { ok: true; userId: string };
type AuthFail = { ok: false; error: string };

async function requireAdmin(): Promise<AuthOk | AuthFail> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized" };
  const ctx = {
    userId: session.user.id,
    platformRole: session.user.platformRole ?? null,
    isSuperuser: session.user.isSuperuser ?? false,
  };
  if (!can(ctx, "manage_capabilities")) {
    return { ok: false, error: "manage_capabilities capability required" };
  }
  return { ok: true, userId: session.user.id };
}

async function setSkillLifecycleState(
  skillId: string,
  next: SkillLifecycleState,
): Promise<{ ok: true; lifecycleState: SkillLifecycleState } | { ok: false; error: string }> {
  const a = await requireAdmin();
  if (!a.ok) return a;
  if (!isSkillLifecycleState(next)) {
    return { ok: false, error: `invalid lifecycleState: ${next}` };
  }
  try {
    await prisma.skillDefinition.update({
      where: { skillId },
      data: { lifecycleState: next },
    });
    return { ok: true, lifecycleState: next };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function pinSkillAction(skillId: string) {
  return setSkillLifecycleState(skillId, "pinned");
}

export async function quarantineSkillAction(skillId: string) {
  return setSkillLifecycleState(skillId, "quarantined");
}

/**
 * Reset a skill back to `active`. Used to clear pin / quarantine without
 * waiting for the next curator pass; safe because the curator will
 * re-classify on the next run if the skill should actually be stale.
 */
export async function unpinSkillAction(skillId: string) {
  return setSkillLifecycleState(skillId, "active");
}

export async function runSkillCuratorAction(): Promise<
  { ok: true; report: CuratorReport } | { ok: false; error: string }
> {
  const a = await requireAdmin();
  if (!a.ok) return a;
  try {
    const report = await runCurator({ invokedByUserId: a.userId });
    return { ok: true, report };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
