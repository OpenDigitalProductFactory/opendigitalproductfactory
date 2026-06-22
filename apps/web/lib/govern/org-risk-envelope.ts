import { prisma } from "@dpf/db";
import { resolveRiskEnvelope, type RiskEnvelope } from "@/lib/govern/risk-posture";

/**
 * Resolve the install's org risk envelope (EP-ONBOARDING-INTAKE P1.2 — the read
 * side of the posture). Reads `BusinessContext.riskPosture` and maps it via
 * `resolveRiskEnvelope`. DPF is single-org-per-install, so `organizationId` is
 * optional — omit it to read the one org.
 *
 * Fail-open: any read failure (or an unset posture) resolves to the balanced
 * envelope, which every consumer treats as today's no-change behavior. A
 * consumer must never block or change behavior because the posture was
 * unreadable.
 */
export async function resolveOrgRiskEnvelope(
  organizationId?: string | null,
): Promise<RiskEnvelope> {
  try {
    const bc = organizationId
      ? await prisma.businessContext.findUnique({
          where: { organizationId },
          select: { riskPosture: true },
        })
      : await prisma.businessContext.findFirst({ select: { riskPosture: true } });
    return resolveRiskEnvelope(bc?.riskPosture ?? null);
  } catch {
    return resolveRiskEnvelope(null);
  }
}
