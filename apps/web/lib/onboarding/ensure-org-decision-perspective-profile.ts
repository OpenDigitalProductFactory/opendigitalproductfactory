import { prisma } from "@dpf/db";

import { DECISION_DOMAIN_CLASSES } from "@/lib/decision-perspective/types";

/** Platform fallback our organization profiles chain to (material.ts:14). */
export const ORG_PERSPECTIVE_FALLBACK_PROFILE_ID = "dpf-organizational-principles";

const PLAN_READINESS_DOMAIN_CLASS = "plan-readiness";
const DEFAULT_AUTONOMY_POLICY = {
  allowRecommendation: true,
  allowArbitration: false,
  maxRiskForArbitration: "low",
  minimumConfidenceForRecommendation: 0.55,
  minimumConfidenceForArbitration: 0.9,
};

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type EnsureOrgDecisionPerspectiveProfileClient = {
  decisionPerspectiveProfile: {
    upsert(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  decisionPerspectiveProfileVersion: {
    upsert(args: unknown): Promise<unknown>;
  };
};

export type EnsureOrgDecisionPerspectiveProfileInput = {
  organizationId: string;
  organizationName: string | null;
  db?: EnsureOrgDecisionPerspectiveProfileClient;
};

export type EnsureOrgDecisionPerspectiveProfileResult = {
  profileId: string;
  versionId: string;
};

/**
 * Materialize the canonical organization decision-profile container.
 *
 * This is deliberately narrower than `seedOrgWwwdCorpus`: any valid WWWD
 * write path may ensure its container without triggering unrelated page,
 * embedding, or setup-completion work. Stable-id upserts make replay safe.
 */
export async function ensureOrgDecisionPerspectiveProfile(
  input: EnsureOrgDecisionPerspectiveProfileInput,
): Promise<EnsureOrgDecisionPerspectiveProfileResult> {
  const db = input.db ?? (prisma as unknown as EnsureOrgDecisionPerspectiveProfileClient);
  const profileId = `org-perspective-${input.organizationId}`;
  const versionId = `${profileId}-v1`;

  // The fallback FK target historically shipped only as an in-code constant.
  // Ensure it first so a fresh install cannot fail the organization upsert.
  await db.decisionPerspectiveProfile.upsert({
    where: { profileId: ORG_PERSPECTIVE_FALLBACK_PROFILE_ID },
    update: {},
    create: {
      profileId: ORG_PERSPECTIVE_FALLBACK_PROFILE_ID,
      name: "DPF Organizational Principles",
      kind: "organization",
      scope: { domains: ["platform-governance", PLAN_READINESS_DOMAIN_CLASS] },
      fallbackProfileId: null,
      defaultResolver: { type: "build-studio-owner" },
      autonomyPolicy: DEFAULT_AUTONOMY_POLICY,
      status: "active",
    },
  });

  await db.decisionPerspectiveProfile.upsert({
    where: { profileId },
    update: {
      name: `${input.organizationName ?? "Organization"} perspective`,
      kind: "organization",
      scope: { domains: [...DECISION_DOMAIN_CLASSES] },
      ownerOrganizationId: input.organizationId,
      fallbackProfileId: ORG_PERSPECTIVE_FALLBACK_PROFILE_ID,
      defaultResolver: { type: "build-studio-owner" },
      autonomyPolicy: DEFAULT_AUTONOMY_POLICY,
      status: "active",
    },
    create: {
      profileId,
      name: `${input.organizationName ?? "Organization"} perspective`,
      kind: "organization",
      scope: { domains: [...DECISION_DOMAIN_CLASSES] },
      ownerOrganizationId: input.organizationId,
      fallbackProfileId: ORG_PERSPECTIVE_FALLBACK_PROFILE_ID,
      defaultResolver: { type: "build-studio-owner" },
      autonomyPolicy: DEFAULT_AUTONOMY_POLICY,
      status: "active",
    },
  });

  await db.decisionPerspectiveProfileVersion.upsert({
    where: { versionId },
    update: { changeSummary: "Organization perspective seeded at onboarding." },
    create: {
      versionId,
      profileId,
      versionNumber: 1,
      materialFingerprint: `seed:${profileId}:v1`,
      changeSummary: "Organization perspective seeded at onboarding.",
    },
  });

  await db.decisionPerspectiveProfile.update({
    where: { profileId },
    data: { currentVersionId: versionId },
  });

  return { profileId, versionId };
}
