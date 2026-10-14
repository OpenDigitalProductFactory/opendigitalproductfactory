import "server-only";
import { prisma } from "@dpf/db";
import { SOURCE_CATALOG } from "@dpf/i18n";
import { getT } from "@/lib/i18n/t.server";
import { getProviderAccounts } from "./ai-provider-data";
import type { ProviderWithCredential, ProviderModelSummary } from "./ai-provider-types";
import { isProviderAccountVisible, type ProviderAccountOverviewRow } from "./provider-account-view";
import type { ProviderRoutingControlView } from "@/lib/routing/provider-routing-control";
import { connectionPosture, loadBusinessSuitabilityContext, providerCatalogFacts } from "@/lib/routing/provider-suitability/provider-onboarding-data";
import { PROVIDER_TRUST_CLAIM_KEYS, resolveProviderTrustEvidence } from "@/lib/routing/provider-suitability/evidence";
import { resolveProviderTrustFacts } from "@/lib/routing/provider-suitability/provider-trust";
import { projectProviderConnectionReview } from "@/lib/routing/provider-suitability/provider-connection-review";

export async function getProviderAccountCopy() {
  const t = await getT("providerAccounts");
  return Object.fromEntries(Object.keys(SOURCE_CATALOG.providerAccounts).map(key => [key, t(key as keyof typeof SOURCE_CATALOG.providerAccounts)]));
}

export async function loadProviderAccountOverview(input: {
  providers: ProviderWithCredential[]; modelSummaries: ReadonlyMap<string, ProviderModelSummary>;
  controls: ReadonlyMap<string, ProviderRoutingControlView>; resolvesPhases: ReadonlyMap<string, string[]>;
  copy: Record<string, string>; now?: Date;
}): Promise<ProviderAccountOverviewRow[]> {
  const now = input.now ?? new Date();
  const [accounts, business, evidence] = await Promise.all([
    getProviderAccounts(), loadBusinessSuitabilityContext(),
    prisma.aiProviderConnection.findMany({
      where: { providerId: { in: input.providers.map(pw => pw.provider.providerId) } },
      include: { provider: { select: { providerId: true, category: true, endpointType: true, catalogEntry: true } },
        trustEvidence: true, supplierContract: { select: { contractId: true, status: true, startDate: true, endDate: true } } },
    }),
  ]);
  const providers = new Map(input.providers.map(pw => [pw.provider.providerId, pw]));
  const evidenceById = new Map(evidence.map(connection => [connection.connectionId, connection]));
  const statusLabels: Record<string, string> = { active: input.copy.authenticated, disabled: input.copy.disabled,
    paused: input.copy.paused, disconnected: input.copy.disconnectedState, unconfigured: input.copy.needsSetup,
    degraded: input.copy.degraded };
  return accounts.flatMap(account => {
    const pw = providers.get(account.providerId);
    if (!pw || !isProviderAccountVisible(account, { firstRun: false, legacyCredentialPresent: account.isDefault && Boolean(pw.credential?.hasUsableMaterial) })) return [];
    const source = evidenceById.get(account.connectionId);
    const resolved = source ? resolveProviderTrustEvidence({ connection: connectionPosture(source), evidenceConnectionId: source.id,
      records: source.trustEvidence, requiredClaims: [...PROVIDER_TRUST_CLAIM_KEYS], supplierContract: source.supplierContract ?? undefined, now }) : null;
    const review = source && resolved ? projectProviderConnectionReview({ ...business,
      facts: resolveProviderTrustFacts({ catalog: providerCatalogFacts(source.provider), connection: resolved.posture }) }) : null;
    const control = account.isDefault ? input.controls.get(account.providerId) : undefined;
    const accessible = Array.isArray(account.accessibleModelIds) ? account.accessibleModelIds.filter(value => typeof value === "string") : [];
    const summary = input.modelSummaries.get(account.providerId);
    const catalogCount = summary?.totalModels;
    const modelSummary = account.modelsVerifiedAt ? `${accessible.length} ${input.copy.verifiedModels}`
      : catalogCount ? `${catalogCount} ${input.copy.catalogModels} · ${input.copy.notVerified}` : input.copy.notVerified;
    return [{
      connectionId: account.connectionId, providerId: account.providerId, isDefault: account.isDefault,
      status: account.status, credential: account.credential ? { hasUsableMaterial: account.credential.hasUsableMaterial } : null,
      modelsVerifiedAt: account.modelsVerifiedAt, lastReviewedAt: account.lastReviewedAt, supplierContractId: account.supplierContractId,
      label: account.label ?? pw.provider.name, providerName: pw.provider.name,
      statusLabel: control?.eligibility.label ?? (account.status === "paused" ? input.copy.paused : account.isDefault ? input.copy.routingUnknown : statusLabels[account.status] ?? input.copy.unavailable),
      allowedWork: review?.scope === "company-work" ? input.copy.companyWork : review?.scope === "public-only" ? input.copy.publicOnly : input.copy.workBlocked,
      allowedWorkSummary: review?.headline ?? input.copy.notVerified,
      modelSummary,
      capabilitySummary: account.isDefault && summary?.routingScores && (!account.modelsVerifiedAt || accessible.includes(summary.representativeModelId ?? ""))
        ? `${input.copy.catalogCapability} ${input.copy.reasoning} ${summary.routingScores.reasoning} · ${input.copy.coding} ${summary.routingScores.codegen} · ${input.copy.tools} ${summary.routingScores.toolFidelity}`
        : input.copy.capabilityUnmeasured,
      capacitySummary: control?.weeklyHint ?? input.copy.capacityUnknown,
      resetSummary: control ? control.restrictions.map(restriction => `${restriction.summary}${restriction.until ? ` ${restriction.until}` : ""}`).join(" ") || null : account.isDefault ? input.copy.routingCheckUnavailable : null,
      resolvesPhases: account.isDefault ? input.resolvesPhases.get(account.providerId) ?? [] : [],
    }];
  });
}
