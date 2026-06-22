import { prisma } from "@dpf/db";
import { resolveRiskEnvelope, riskEnvelopeToAutonomyPolicy } from "@/lib/govern/risk-posture";

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type ApplyRiskEnvelopeClient = {
  businessContext: { findUnique: (args: unknown) => Promise<unknown> };
  decisionPerspectiveProfile: { updateMany: (args: unknown) => Promise<{ count: number }> };
};

/**
 * Wire the org's risk posture into its decision-perspective autonomy policy
 * (EP-ONBOARDING-INTAKE P1). Reads BusinessContext.riskPosture, maps it to a
 * DecisionAutonomyPolicy (balanced == the policy the org WWWD profile is seeded
 * with today, so existing installs are unchanged), and writes it onto the org's
 * `kind="organization"` profile — the policy the decision-perspective evaluator
 * reads to gate how autonomously coworkers may act.
 *
 * Runs after seedRiskPosture (posture set) and seedOrgWwwdCorpus (profile
 * created). Idempotent (same posture -> same policy) and fail-open (onboarding
 * completion and a posture edit must never block on it). `updateMany` makes a
 * missing profile a 0-row no-op rather than a throw.
 */
export async function applyRiskEnvelopeToOrgProfile(input: {
  organizationId: string;
  db?: ApplyRiskEnvelopeClient;
}): Promise<void> {
  const db = input.db ?? (prisma as unknown as ApplyRiskEnvelopeClient);
  try {
    const bc = (await db.businessContext.findUnique({
      where: { organizationId: input.organizationId },
      select: { riskPosture: true },
    })) as { riskPosture: string | null } | null;

    const policy = riskEnvelopeToAutonomyPolicy(resolveRiskEnvelope(bc?.riskPosture ?? null));

    await db.decisionPerspectiveProfile.updateMany({
      where: { ownerOrganizationId: input.organizationId, kind: "organization" },
      data: { autonomyPolicy: policy },
    });
  } catch (err) {
    console.warn("[setup] risk-envelope -> autonomy-policy wiring failed (fail-open):", err);
  }
}
