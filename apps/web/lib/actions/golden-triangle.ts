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
import { getEffectiveGoldenTrianglePosture, setGoldenTrianglePosture } from "@/lib/golden-triangle/persistence";

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
