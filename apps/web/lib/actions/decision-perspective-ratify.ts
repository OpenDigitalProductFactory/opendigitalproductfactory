"use server";
// Ratify a decision-perspective policy version (BI-9C384562).
//
// The exact-bound authority projector (govern/authority/policy-authority-projector.ts)
// only turns a WWMD "yes" into an approval when the policy version that answered
// was promoted by a human: autonomy is delegated by a person who ratified the
// policy once, never by the platform vouching for itself. The seed creates the
// platform and organization profile versions with no promoter, and until this
// action existed nothing let a human record that ratification — so every
// routine reviewer receipt fell to a per-action approval card.
//
// This is the one-time act. It never fakes a signature: the promoter is the
// signed-in human's own principal, and a version already ratified is left as
// it is (the first ratifier stays the root of that delegation).
//
// Domain errors are RETURNED as values, never thrown (use-server rule).

import { revalidatePath } from "next/cache";

import { prisma } from "@dpf/db";

import { requireCapability } from "@/lib/actions/shared/guards";
import { resolvePrincipalIdForUser } from "@/lib/identity/principal-linking";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

export type RatifiedPolicyVersion = {
  profileId: string;
  versionId: string;
  promotedByPrincipalId: string;
  alreadyRatified: boolean;
};

export type RatifyPolicyVersionResult = ActionResult<RatifiedPolicyVersion>;

/** Only the two scope-owning kinds are ratifiable; profession profiles are governed through their craft pages. */
const RATIFIABLE_KINDS = new Set(["platform", "organization"]);

/** Narrow client surface so tests can pass a stub. */
export type RatifyPolicyVersionClient = {
  decisionPerspectiveProfile: {
    findUnique(args: unknown): Promise<unknown>;
  };
  decisionPerspectiveProfileVersion: {
    findUnique(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

export async function ratifyPolicyVersionForPrincipal(input: {
  db: RatifyPolicyVersionClient;
  profileId: string;
  principalId: string;
}): Promise<RatifyPolicyVersionResult> {
  const profile = (await input.db.decisionPerspectiveProfile.findUnique({
    where: { profileId: input.profileId },
    select: { profileId: true, kind: true, currentVersionId: true, status: true },
  })) as { profileId: string; kind: string; currentVersionId: string | null; status: string } | null;
  if (!profile || profile.status !== "active") {
    return err("That decision perspective is not active on this install.");
  }
  if (!RATIFIABLE_KINDS.has(profile.kind)) {
    return err("Only the platform and organization perspectives are ratified here; craft doctrine is confirmed on its craft page.");
  }
  if (!profile.currentVersionId) {
    return err("That perspective has no current version to ratify.");
  }
  const version = (await input.db.decisionPerspectiveProfileVersion.findUnique({
    where: { versionId: profile.currentVersionId },
    select: { versionId: true, promotedByPrincipalId: true },
  })) as { versionId: string; promotedByPrincipalId: string | null } | null;
  if (!version) {
    return err("The current policy version could not be loaded.");
  }
  if (version.promotedByPrincipalId) {
    return ok({
      profileId: profile.profileId,
      versionId: version.versionId,
      promotedByPrincipalId: version.promotedByPrincipalId,
      alreadyRatified: true,
    });
  }
  // Conditional write: two humans ratifying at once cannot both become root.
  const updated = await input.db.decisionPerspectiveProfileVersion.updateMany({
    where: { versionId: version.versionId, promotedByPrincipalId: null },
    data: { promotedByPrincipalId: input.principalId },
  });
  if (updated.count !== 1) {
    return err("Someone else ratified this version first; reload to see who.");
  }
  return ok({
    profileId: profile.profileId,
    versionId: version.versionId,
    promotedByPrincipalId: input.principalId,
    alreadyRatified: false,
  });
}

export async function ratifyPolicyVersion(input: { profileId: string }): Promise<RatifyPolicyVersionResult> {
  let userId: string;
  try {
    userId = (await requireCapability("manage_capabilities")).userId;
  } catch {
    return err("You do not have access to ratify a decision perspective.");
  }
  const principalId = await resolvePrincipalIdForUser(userId);
  if (!principalId) {
    return err("Your account has no principal identity to sign with.");
  }
  const result = await ratifyPolicyVersionForPrincipal({ db: prisma, profileId: input.profileId, principalId });
  if (result.ok) revalidatePath("/coworker-decisions/perspectives");
  return result;
}
