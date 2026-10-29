import "server-only";
import { projectAccountReadiness } from "./provider-account-readiness";
import { isLocalProviderId } from "@/lib/routing/provider-locality";
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
import { loadProviderCapacitySnapshots } from "@/lib/routing/provider-capacity/store";
import { capacityRoutingExclusionReason } from "@/lib/routing/capacity-routing-exclude";
import { accountRuntimeKey } from "@/lib/routing/provider-account-candidates";
import { isAccountCapacityState } from "@/lib/routing/provider-capacity/scopes";

export async function getProviderAccountCopy(): Promise<Record<string, string>> {
  const [t, setup] = await Promise.all([getT("providerAccounts"), getT("setup")]);
  return { ...Object.fromEntries(Object.keys(SOURCE_CATALOG.providerAccounts).map(key => [key, t(key as keyof typeof SOURCE_CATALOG.providerAccounts)])),
    modelsExecution: setup("providerConnection.modelsExecution") };
}

export async function loadProviderAccountOverview(input: {
  providers: ProviderWithCredential[]; modelSummaries: ReadonlyMap<string, ProviderModelSummary>;
  controls: ReadonlyMap<string, ProviderRoutingControlView>; resolvesPhases: ReadonlyMap<string, string[]>;
  copy: Record<string, string>; now?: Date;
}): Promise<ProviderAccountOverviewRow[]> {
  const now = input.now ?? new Date();
  const [accounts, business, evidence, capacity] = await Promise.all([
    getProviderAccounts(), loadBusinessSuitabilityContext(),
    prisma.aiProviderConnection.findMany({
      where: { providerId: { in: input.providers.map(pw => pw.provider.providerId) } },
      include: { provider: { select: { providerId: true, category: true, endpointType: true, catalogEntry: true } },
        trustEvidence: true, supplierContract: { select: { contractId: true, status: true, startDate: true, endDate: true } } },
    }),
    loadProviderCapacitySnapshots({ includeInactiveAccountHealth: true }).catch(() => null),
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
    const ownedHealth = capacity?.get(accountRuntimeKey(account.providerId, account.connectionId));
    const ownedRestriction = capacityRoutingExclusionReason(ownedHealth, now.getTime());
    const providerLimit = capacity?.get(account.providerId);
    const sharedLimit = !account.isDefault && providerLimit && !isAccountCapacityState(providerLimit.state)
      && capacityRoutingExclusionReason(providerLimit, now.getTime()) ? providerLimit : null;
    const credentialNeedsRenewal = account.credential?.status === "expired"
      || Boolean(account.credential?.tokenExpiresAt && Date.parse(account.credential.tokenExpiresAt) <= now.getTime());
    const additionalSharedControl = !account.isDefault ? input.controls.get(account.providerId) : undefined;
    const sharedRestrictions = additionalSharedControl?.restrictions.filter(restriction =>
      ["quota", "quota-recovery", "local-only", "host-capacity"].includes(restriction.key)) ?? [];
    const recoveryAction = ownedHealth?.action === "reconnect" ? ["oauth", "oauth2_authorization_code"].includes(account.authMethod) ? input.copy.signIn : input.copy.reviewConnectionSettings
      : ownedHealth?.action === "add_credits_or_plan" ? input.copy.reviewAccountBilling : null;
    const resetParts = [
      ...(credentialNeedsRenewal ? [input.copy.tokenNeedsRenewal] : []),
      ...(ownedRestriction && recoveryAction ? [recoveryAction] : []),
      ...(ownedRestriction && ownedHealth?.retryAtMs ? [new Date(ownedHealth.retryAtMs).toISOString()] : []),
      ...(control ? control.restrictions.map(restriction => `${restriction.summary}${restriction.until ? ` ${restriction.until}` : ""}`) : []),
      ...(additionalSharedControl?.weeklyHint ? [`${input.copy.sharedProviderLimits}: ${additionalSharedControl.weeklyHint}`] : []),
      ...sharedRestrictions.map(restriction => `${input.copy.sharedProviderLimits}: ${restriction.summary}${restriction.until ? ` ${restriction.until}` : ""}`),
      ...(sharedLimit?.safeSummary ? [`${input.copy.sharedProviderLimits}: ${sharedLimit.safeSummary}${sharedLimit.retryAtMs ? ` ${new Date(sharedLimit.retryAtMs).toISOString()}` : ""}`] : []),
      ...(capacity === null ? [input.copy.routingCheckUnavailable] : []),
    ].filter(Boolean);
    const accessible = Array.isArray(account.accessibleModelIds) ? account.accessibleModelIds.filter(value => typeof value === "string") : [];
    const summary = input.modelSummaries.get(account.providerId);
    const catalogCount = summary?.totalModels;
    const modelSummary = account.modelsVerifiedAt ? `${accessible.length} ${input.copy.verifiedModels}`
      : catalogCount ? `${catalogCount} ${input.copy.catalogModels} · ${input.copy.notVerified}` : input.copy.notVerified;
    const readiness = projectAccountReadiness({ status: account.status,
      requiresCredential: !isLocalProviderId(account.providerId) && account.authMethod !== "none",
      hasCredential: Boolean(account.credential?.hasUsableMaterial || (account.isDefault && pw.credential?.hasUsableMaterial)),
      verifiedModelCount: account.modelsVerifiedAt ? accessible.length : undefined,
      credentialNeedsRenewal, healthAvailable: capacity !== null && (!account.isDefault || Boolean(control)),
      capacity: ownedHealth, sharedCapacity: account.isDefault ? providerLimit : sharedLimit ?? undefined,
      control, sharedRestrictions, now: now.getTime(), copy: input.copy });
    const authLabel = isLocalProviderId(account.providerId) ? input.copy.localConnection
      : account.authMethod === "api_key" ? input.copy.apiKeyMethod
        : account.authMethod === "oauth2_client_credentials" ? input.copy.workloadMethod : input.copy.oauthMethod;
    return [{
      readiness,
      connectionSummary: `${authLabel} · ${isLocalProviderId(account.providerId) ? input.copy.localConnection
        : account.credential?.hasUsableMaterial || (account.isDefault && pw.credential?.hasUsableMaterial) ? input.copy.connectionSaved : input.copy.needsSetup}`,
      lastCheckedAt: ownedHealth?.observedAtMs ? new Date(ownedHealth.observedAtMs).toISOString() : null,
      lastSucceededAt: ownedHealth?.lastSuccessAtMs ? new Date(ownedHealth.lastSuccessAtMs).toISOString() : null,
      quotaRecheckAt: control?.restrictions.find(restriction => restriction.key === "quota-recovery")?.until ?? null,
      eligibilitySummary: control?.eligibility.reason ?? (["waiting", "paused", "blocked"].includes(readiness.state)
        ? input.copy.notRouting : input.copy.accountEligibilityUnconfirmed),
      nextActionLabel: recoveryAction ?? (control?.healthStatus === "billing" ? input.copy.reviewAccountBilling : readiness.state === "waiting" ? input.copy.reviewAvailability
        : readiness.state === "paused" ? input.copy.reviewPause
          : readiness.state === "blocked" ? input.copy.reviewConnectionSettings
            : readiness.state === "unverified" || !account.modelsVerifiedAt ? input.copy.reviewAndVerify : input.copy.viewAccount),
      connectionId: account.connectionId, providerId: account.providerId, isDefault: account.isDefault,
      status: account.status, credential: account.credential ? { hasUsableMaterial: account.credential.hasUsableMaterial } : null,
      modelsVerifiedAt: account.modelsVerifiedAt, lastReviewedAt: account.lastReviewedAt, supplierContractId: account.supplierContractId,
      label: account.label ?? pw.provider.name, providerName: pw.provider.name,
      statusLabel: ["paused", "disabled", "disconnected"].includes(account.status) ? statusLabels[account.status]
        : credentialNeedsRenewal || ownedRestriction ? input.copy.degraded
          : control?.eligibility.label ?? (account.isDefault ? input.copy.routingUnknown : statusLabels[account.status] ?? input.copy.unavailable),
      allowedWork: review?.scope === "company-work" ? input.copy.companyWork : review?.scope === "public-only" ? input.copy.publicOnly : input.copy.workBlocked,
      allowedWorkSummary: review?.headline ?? input.copy.notVerified,
      modelSummary,
      capabilitySummary: account.isDefault && summary?.routingScores && (!account.modelsVerifiedAt || accessible.includes(summary.representativeModelId ?? ""))
        ? `${input.copy.catalogCapability} ${input.copy.reasoning} ${summary.routingScores.reasoning} · ${input.copy.coding} ${summary.routingScores.codegen} · ${input.copy.tools} ${summary.routingScores.toolFidelity}`
        : input.copy.capabilityUnmeasured,
      capacitySummary: ownedRestriction && ownedHealth?.safeSummary ? ownedHealth.safeSummary : control?.weeklyHint ?? input.copy.capacityUnknown,
      resetSummary: [...new Set(resetParts)].join(" ") || (account.isDefault && !control ? input.copy.routingCheckUnavailable : null),
      resolvesPhases: account.isDefault ? input.resolvesPhases.get(account.providerId) ?? [] : [],
    }];
  });
}
