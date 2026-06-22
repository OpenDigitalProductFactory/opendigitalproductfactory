import { prisma } from "@dpf/db";
import { deriveRiskPostureDefault } from "@/lib/govern/risk-posture";

/**
 * Seed the org-wide risk-posture default at setup completion (EP-ONBOARDING-INTAKE
 * P0). Derives from the chosen archetype category (the canonical industry per
 * AGENTS.md §2) + card-handling, mirroring INDUSTRY_RETENTION_FLOORS.
 *
 * Seed-once / idempotent: writes only when no posture is set yet, or when the
 * stored value is still the machine-derived default (source="industry-default").
 * An operator's explicit choice (source="operator") is never overwritten — so a
 * posture confirmed/changed at the business-context step survives, while a
 * default left untouched is re-derived against the archetype the operator
 * actually picked later in the flow.
 *
 * Inert in P0: nothing reads the value until P1 wires the consumers. Fail-open —
 * returns quietly on any error so onboarding completion never blocks.
 */
export async function seedRiskPosture({
  organizationId,
}: {
  organizationId: string;
}): Promise<void> {
  try {
    const bc = await prisma.businessContext.findUnique({
      where: { organizationId },
      select: {
        riskPosture: true,
        riskPostureSource: true,
        handlesCardPayments: true,
        industry: true,
      },
    });
    if (!bc) return;
    // Respect an operator's explicit choice; only (re)seed the derived default.
    if (bc.riskPosture && bc.riskPostureSource !== "industry-default") return;

    const storefront = await prisma.storefrontConfig.findFirst({
      where: { organizationId },
      select: { archetype: { select: { category: true } } },
    });

    const { posture, source } = deriveRiskPostureDefault({
      archetypeCategory: storefront?.archetype?.category ?? null,
      industry: bc.industry,
      handlesCardPayments: bc.handlesCardPayments,
    });

    // No-op when the derived value already matches what's stored.
    if (bc.riskPosture === posture && bc.riskPostureSource === source) return;

    await prisma.businessContext.update({
      where: { organizationId },
      data: {
        riskPosture: posture,
        riskPostureSource: source,
        riskPostureCapturedAt: new Date(),
      },
    });
  } catch (err) {
    console.warn("[setup] risk-posture seeding failed (fail-open):", err);
  }
}
