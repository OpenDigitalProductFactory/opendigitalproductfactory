"use server";
// EP-GOLDEN-TRIANGLE Slices 4/5 (BI-85B2E96C / BI-FC527806) — server actions to
// save a default posture. The WWMD/platform default (Slice 4) is the shipped
// seed; the WWWD/organization default (Slice 5) is the org's own override, which
// the effective-posture resolver layers ABOVE the platform default. Both are
// gated by `view_platform` (the capability that guards decision-perspective
// writes), the standard pattern for platform-admin surfaces.
import { revalidatePath } from "next/cache";

import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import type { GoldenTrianglePreference } from "@/lib/golden-triangle";
import { contributePostureDefault } from "@/lib/golden-triangle/hive";
import {
  getEffectiveGoldenTrianglePosture,
  getEffectivePostureForAgent,
  getGoldenTrianglePosture,
  setAgentGoldenTrianglePosture,
  setGoldenTrianglePosture,
} from "@/lib/golden-triangle/persistence";

/**
 * Read the saved platform (WWMD) default so a client surface (e.g. the coworker
 * header chip) can reflect what actually governs AI work. Read-only and only
 * requires a session — any signed-in user may SEE the active priority; changing
 * it stays gated by `view_platform` on the save actions. Returns null when unset
 * (the caller shows Balanced).
 */
export async function getGoldenTrianglePlatformDefault(): Promise<GoldenTrianglePreference | null> {
  const session = await auth();
  if (!session?.user) return null;
  return getGoldenTrianglePosture({ kind: "platform" });
}

/**
 * Read the EFFECTIVE posture for a coworker (agent → org → platform), so the
 * coworker chip reflects what actually governs that coworker's runs even before
 * it has its own override. Session-gated read.
 */
export async function getCoworkerGoldenTrianglePosture(agentId: string): Promise<GoldenTrianglePreference | null> {
  const session = await auth();
  if (!session?.user) return null;
  const resolved = await getEffectivePostureForAgent(agentId, null);
  return resolved?.preference ?? null;
}

/**
 * Save a coworker's OWN (per-agent) posture. This is what makes the priority real
 * per coworker: the saved posture layers above org/platform and tunes that
 * coworker's dispatch. `view_platform`-gated (a per-agent setting is shared, not
 * per-user); a non-admin caller gets "Couldn't save" client-side.
 */
export async function saveCoworkerGoldenTrianglePosture(
  agentId: string,
  preference: GoldenTrianglePreference,
): Promise<{ ok: boolean }> {
  await requirePlatformAdmin();
  const ok = await setAgentGoldenTrianglePosture(agentId, preference);
  return { ok };
}

async function requirePlatformAdmin() {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_platform")) {
    throw new Error("Unauthorized");
  }
  return user;
}

export async function saveGoldenTrianglePlatformDefault(
  preference: GoldenTrianglePreference,
): Promise<{ ok: boolean }> {
  await requirePlatformAdmin();
  const ok = await setGoldenTrianglePosture({ kind: "platform" }, preference);
  if (ok) revalidatePath("/platform/ai/priority");
  return { ok };
}

/**
 * Save the organization-wide (WWWD) default posture. DPF runs single-org installs
 * today, so the org is resolved implicitly (the one Organization row) — the same
 * pattern as wiki-edit / capability-activation. When multi-org lands, this takes
 * an explicit `organizationId` from route context plus an org-membership check;
 * the `view_platform` gate already scopes writes to platform admins of the install.
 */
export async function saveGoldenTriangleOrgDefault(
  preference: GoldenTrianglePreference,
): Promise<{ ok: boolean }> {
  await requirePlatformAdmin();
  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) throw new Error("No organization found");
  const ok = await setGoldenTrianglePosture({ kind: "organization", organizationId: org.id }, preference);
  if (ok) revalidatePath("/platform/ai/priority");
  return { ok };
}

/**
 * EP-GOLDEN-TRIANGLE Slice 7 — explicitly contribute the effective posture default
 * to the hive (the federated learning commons). Deliberately an EXPLICIT operator
 * action, not automatic on save: sharing a default is a privacy decision, so it is
 * gated by both `view_platform` AND the hive consent surface (the "improvement"
 * opt-in + master pause inside contributePostureDefault, which is fail-closed and
 * shares only the anonymized preset + weights — never an org identity).
 */
export async function contributeGoldenTrianglePostureToHive(): Promise<{ contributed: boolean; reason: string }> {
  await requirePlatformAdmin();
  const resolved = await getEffectiveGoldenTrianglePosture(null);
  if (!resolved) return { contributed: false, reason: "no_posture_set" };
  const res = await contributePostureDefault(resolved.preference);
  return { contributed: res.contributed, reason: res.reason };
}
