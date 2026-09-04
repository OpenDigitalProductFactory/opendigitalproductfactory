"use server";

import { prisma } from "@dpf/db";

import { requireCapability } from "@/lib/actions/shared/guards";
import { activateProvider } from "@/lib/govern/activate-provider";
import {
  recordProviderTrustEvidence,
  supersedeProviderTrustEvidenceClaim,
  type ProviderTrustClaimKey,
} from "@/lib/routing/provider-suitability/evidence";

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
  enabledRegions?: string[];
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
    select: { id: true, entitlements: true, evidenceStatus: true },
  });
  if (!connection) return { error: "Provider connection not found" };
  const existingEntitlements = connection.entitlements && typeof connection.entitlements === "object" && !Array.isArray(connection.entitlements)
    ? connection.entitlements as Record<string, unknown>
    : {};
  const reviewedAt = new Date();
  const expiresAt = new Date(reviewedAt.getTime() + 90 * 86_400_000);
  const enabledRegions = input.enabledRegions == null
    ? undefined
    : [...new Set(input.enabledRegions.map((region) => region.trim().toLowerCase()).filter(Boolean))].sort();
  const approvedUnderlyingProviderSlugs = [...new Set(
    (input.approvedUnderlyingProviderSlugs ?? [])
      .map((slug) => slug.trim().toLowerCase())
      .filter((slug) => /^[a-z0-9][a-z0-9._/-]*$/.test(slug)),
  )].sort();
  await prisma.aiProviderConnection.update({
    where: { connectionId },
    data: {
      accountClass: input.accountClass,
      evidenceStatus: connection.evidenceStatus === "contract-uploaded" ? "contract-uploaded" : "operator-attested",
      lastReviewedAt: reviewedAt,
      entitlements: {
        ...existingEntitlements,
        noTraining: input.noTraining,
        ...(enabledRegions === undefined ? {} : { enabledRegions }),
        ...(input.regionalProcessing === undefined ? {} : { regionalProcessing: input.regionalProcessing }),
        ...(input.providerId === "openrouter" ? {
          zeroRetention: input.zeroRetention ?? null,
          approvedUnderlyingProviderSlugs,
        } : {}),
      },
    },
  });
  const recordDeclaration = (
    claimKey: ProviderTrustClaimKey,
    assertedValue: boolean | string[] | null | undefined,
    title: string,
  ) => assertedValue == null || (Array.isArray(assertedValue) && assertedValue.length === 0)
    ? supersedeProviderTrustEvidenceClaim({ providerConnectionDbId: connection.id, claimKey })
    : recordProviderTrustEvidence({
      providerConnectionDbId: connection.id,
      claimKey,
      assertedValue,
      evidenceType: "provider-operator-attestation",
      title,
      description: "Operator declaration captured during provider setup; contract evidence is still required where policy demands it.",
      collectedAt: reviewedAt,
      expiresAt,
    });
  const evidenceWrites = [
    recordDeclaration("no-training", input.noTraining, "Connected-account no-training declaration"),
    ...(enabledRegions === undefined ? [] : [recordDeclaration("enabled-regions", enabledRegions, "Connected-account enabled-region declaration")]),
    ...(input.regionalProcessing === undefined ? [] : [recordDeclaration("regional-processing", input.regionalProcessing, "Connected-account regional-processing declaration")]),
  ];
  if (input.providerId === "openrouter") {
    evidenceWrites.push(
      recordDeclaration("zero-retention", input.zeroRetention, "Connected-account zero-retention declaration"),
      recordDeclaration("approved-underlying-providers", approvedUnderlyingProviderSlugs, "Connected-account router-provider declaration"),
    );
  }
  await Promise.all(evidenceWrites);
  const provider = await prisma.modelProvider.findUnique({
    where: { providerId: input.providerId },
    select: { status: true },
  });
  if (provider?.status === "active") {
    await activateProvider(input.providerId, { trigger: "test_auth", skipDiscovery: true });
  }
  return {};
}
