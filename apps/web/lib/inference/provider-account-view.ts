import type { AccountReadiness } from "./provider-account-readiness";
import { isLocalProviderId } from "@/lib/routing/provider-locality";

/** Presentation identity consumes the canonical masked account read model. */
export type ProviderAccountIdentity = {
  connectionId: string;
  providerId: string;
  isDefault: boolean;
  status: string;
  credential: { hasUsableMaterial: boolean } | null;
  modelsVerifiedAt: string | null;
  lastReviewedAt: string | null;
  supplierContractId?: string | null;
};

export type ProviderAccountOverviewRow = ProviderAccountIdentity & {
  label: string; providerName: string; statusLabel: string;
  readiness?: AccountReadiness;
  allowedWork: string; allowedWorkSummary: string;
  modelSummary: string; capacitySummary: string; resetSummary: string | null;
  capabilitySummary?: string;
  resolvesPhases: string[];
};

export function isProviderAccountVisible(
  account: ProviderAccountIdentity,
  context: { firstRun: boolean; legacyCredentialPresent?: boolean },
): boolean {
  const configuredLocal = isLocalProviderId(account.providerId) && account.status !== "unconfigured";
  return context.firstRun || account.providerId === "local" || configuredLocal || !account.isDefault
    || account.status === "paused" || account.status === "disconnected"
    || Boolean(account.credential?.hasUsableMaterial || account.modelsVerifiedAt
      || account.lastReviewedAt || account.supplierContractId || context.legacyCredentialPresent);
}

export function selectProviderAccount<T extends ProviderAccountIdentity>(
  accounts: readonly T[], providerId: string, requestedConnectionId?: string,
): T | null {
  const connectionId = requestedConnectionId ?? `provider-default-${providerId}`;
  return accounts.find((account) => account.providerId === providerId && account.connectionId === connectionId) ?? null;
}

/** Default links retain the legacy shared-credential and callback paths. */
export function providerAccountHref(account: Pick<ProviderAccountIdentity, "providerId" | "connectionId" | "isDefault">): string {
  const path = `/platform/ai/providers/${encodeURIComponent(account.providerId)}`;
  return account.isDefault ? path : `${path}?account=${encodeURIComponent(account.connectionId)}`;
}

export type ProviderAccountConnectionDraft = {
  label: string;
  secretRef: string;
  clientId: string;
  clientSecret: string;
  tokenEndpoint: string;
  scope: string;
};

/** Write-only secrets start empty; a label-only save must not revoke trust/model proof. */
export function providerAccountConfigurationInput(
  connectionId: string,
  draft: ProviderAccountConnectionDraft,
  initial: Pick<ProviderAccountConnectionDraft, "clientId" | "tokenEndpoint" | "scope">,
) {
  return {
    connectionId, label: draft.label,
    ...(draft.secretRef ? { secretRef: draft.secretRef } : {}),
    ...(draft.clientSecret ? { clientSecret: draft.clientSecret } : {}),
    ...(draft.clientId !== initial.clientId ? { clientId: draft.clientId } : {}),
    ...(draft.tokenEndpoint !== initial.tokenEndpoint ? { tokenEndpoint: draft.tokenEndpoint } : {}),
    ...(draft.scope !== initial.scope ? { scope: draft.scope } : {}),
  };
}
