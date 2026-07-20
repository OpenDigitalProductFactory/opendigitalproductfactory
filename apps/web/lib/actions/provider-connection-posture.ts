"use server";

import { prisma } from "@dpf/db";

import { requireCapability } from "@/lib/actions/shared/guards";
import { activateProvider } from "@/lib/govern/activate-provider";

const PROVIDER_ACCOUNT_CLASSES = ["regular", "business-team", "enterprise", "unknown"] as const;

/**
 * Record the operator's connected-account declaration. This is deliberately
 * an attestation, not contract proof; uploaded/reviewed supplier evidence owns
 * the stronger `contract-uploaded` state.
 */
export async function updateProviderConnectionPosture(input: {
  providerId: string;
  accountClass: (typeof PROVIDER_ACCOUNT_CLASSES)[number];
  noTraining: boolean | null;
  enabledRegions: string[];
  zeroRetention?: boolean | null;
  regionalProcessing?: boolean | null;
  approvedUnderlyingProviderSlugs?: string[];
}): Promise<{ error?: string }> {
  await requireCapability("manage_provider_connections");
  if (!PROVIDER_ACCOUNT_CLASSES.includes(input.accountClass)) {
    return { error: "Choose a valid account type" };
  }
  const connectionId = `provider-default-${input.providerId}`;
  const connection = await prisma.aiProviderConnection.findUnique({
    where: { connectionId },
    select: { entitlements: true, evidenceStatus: true },
  });
  if (!connection) return { error: "Provider connection not found" };
  const existingEntitlements = connection.entitlements && typeof connection.entitlements === "object" && !Array.isArray(connection.entitlements)
    ? connection.entitlements as Record<string, unknown>
    : {};
  await prisma.aiProviderConnection.update({
    where: { connectionId },
    data: {
      accountClass: input.accountClass,
      evidenceStatus: connection.evidenceStatus === "contract-uploaded" ? "contract-uploaded" : "operator-attested",
      lastReviewedAt: new Date(),
      entitlements: {
        ...existingEntitlements,
        noTraining: input.noTraining,
        enabledRegions: [...new Set(input.enabledRegions.map((region) => region.trim().toLowerCase()).filter(Boolean))].sort(),
        ...(input.providerId === "openrouter" ? {
          zeroRetention: input.zeroRetention ?? null,
          regionalProcessing: input.regionalProcessing ?? null,
          approvedUnderlyingProviderSlugs: [...new Set(
            (input.approvedUnderlyingProviderSlugs ?? [])
              .map((slug) => slug.trim().toLowerCase())
              .filter((slug) => /^[a-z0-9][a-z0-9._/-]*$/.test(slug)),
          )].sort(),
        } : {}),
      },
    },
  });
  const provider = await prisma.modelProvider.findUnique({
    where: { providerId: input.providerId },
    select: { status: true },
  });
  if (provider?.status === "active") {
    await activateProvider(input.providerId, { trigger: "test_auth", skipDiscovery: true });
  }
  return {};
}
