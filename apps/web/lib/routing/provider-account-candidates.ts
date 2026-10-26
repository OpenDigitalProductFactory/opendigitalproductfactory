import type { CandidateTrace, EndpointManifest, SensitivityLevel } from "./types";
import type { RequestContract } from "./request-contract";
import type { RoutedExecutionPlan } from "./recipe-types";
import { createHash } from "node:crypto";

/** Routing facts contain credential readiness only, never secret material. */
export type ProviderAccountCandidateFacts = {
  connectionId: string;
  providerId: string;
  status: string;
  authMethod: string;
  executionChannel: string;
  credentialEntryId: string | null;
  credentialEntry: { status: string; updatedAt?: Date } | null;
  updatedAt?: Date;
  accessibleModelIds: string[];
  modelsVerifiedAt: Date | null;
  evidenceStatus: string;
  accountClass?: string;
  supplierContractId?: string | null;
  lastReviewedAt?: Date | null;
};

export class ProviderAccountSelectionChangedError extends Error {
  constructor(public readonly providerId: string, message: string) {
    super(message);
    this.name = "ProviderAccountSelectionChangedError";
  }
}

/** Binds a route to metadata revisions; secret material never enters the digest. */
export function accountExecutionVersion(account: ProviderAccountCandidateFacts): string {
  return createHash("sha256").update(JSON.stringify({ connectionId: account.connectionId, providerId: account.providerId,
    status: account.status, authMethod: account.authMethod, executionChannel: account.executionChannel,
    credentialEntryId: account.credentialEntryId, credential: account.credentialEntry ? { status: account.credentialEntry.status, updatedAt: account.credentialEntry.updatedAt } : null,
    accessibleModelIds: [...account.accessibleModelIds].sort(),
    modelsVerifiedAt: account.modelsVerifiedAt, evidenceStatus: account.evidenceStatus,
    accountClass: account.accountClass, supplierContractId: account.supplierContractId, lastReviewedAt: account.lastReviewedAt })).digest("hex");
}

/** Dispatch reuses the same account boundary as routing, after a fresh read. */
export function providerAccountExecutionBlock(account: ProviderAccountCandidateFacts | null, selection: {
  providerId: string; providerConnectionId?: string; providerConnectionVersion?: string; modelId: string;
}): string | null {
  if (selection.providerConnectionId === undefined) return null;
  if (!selection.providerConnectionId.trim()) return "Selected provider account identity is invalid";
  if (!account || account.connectionId !== selection.providerConnectionId || account.providerId !== selection.providerId
    || !["active", "degraded"].includes(account.status)) return "Selected provider account is unavailable";
  if (selection.providerConnectionVersion && accountExecutionVersion(account) !== selection.providerConnectionVersion) return "Selected provider account changed after routing";
  if (selection.providerConnectionId === `provider-default-${selection.providerId}`) return null;
  if (!selection.providerConnectionVersion || !account.modelsVerifiedAt || !account.accessibleModelIds.includes(selection.modelId)
    || !account.credentialEntryId || account.credentialEntry?.status !== "ok" || ["expired", "rejected"].includes(account.evidenceStatus)) return "Selected provider account proof is unavailable";
  return null;
}

export function accountAuthMethod(method: string): string {
  return ({ "api-key": "api_key", oauth: "oauth2_authorization_code", "workload-identity": "oauth2_client_credentials", local: "none" } as Record<string, string>)[method] ?? "unsupported";
}

export function accountRuntimeKey(providerId: string, connectionId?: string): string {
  return connectionId ? `${providerId}:account:${connectionId}` : providerId;
}

export function accountCandidateExclusion(manifest: EndpointManifest, contract: RequestContract): string | null {
  const deniedIdentity = manifest.providerConnectionId ?? `provider-default-${manifest.providerId}`;
  if (contract.deniedProviderConnectionIds?.includes(deniedIdentity)) return "Provider account is excluded by the request account denylist";
  if (contract.allowedProviderConnectionIds !== undefined
    && (!manifest.providerConnectionId || !contract.allowedProviderConnectionIds.includes(manifest.providerConnectionId))) return "Provider account is outside the request account allowlist";
  return null;
}

export function accountTraceProjector(endpoints: EndpointManifest[]) {
  const accountByEndpoint = new Map(endpoints.map(endpoint => [endpoint.id, endpoint]));
  return (trace: CandidateTrace): CandidateTrace => {
    const endpoint = accountByEndpoint.get(trace.endpointId);
    return endpoint?.providerConnectionId ? { ...trace, providerConnectionId: endpoint.providerConnectionId, modelProfileId: endpoint.modelProfileId,
      accountAuthMethod: endpoint.accountAuthMethod, executionChannel: endpoint.executionChannel, providerConnectionVersion: endpoint.providerConnectionVersion } : trace;
  };
}

export function bindProviderAccountExecution(plan: RoutedExecutionPlan | undefined, endpoint: EndpointManifest): RoutedExecutionPlan | undefined {
  if (!plan || !endpoint.providerConnectionId) return plan;
  return { ...plan, providerConnectionId: endpoint.providerConnectionId, providerConnectionVersion: endpoint.providerConnectionVersion, accountAuthMethod: endpoint.accountAuthMethod, executionChannel: endpoint.executionChannel,
    ...(endpoint.executionChannel === "direct-api" && endpoint.accountAuthMethod === "api_key" && endpoint.providerId === "anthropic-sub"
      ? { executionAdapter: "chat" }
      : {}),
  };
}

/** A compiler approval applies to this work and this account, never its siblings. */
export function bindProviderAccountSuitability(
  manifests: EndpointManifest[],
  sensitivity: SensitivityLevel,
  approvedConnectionIds: readonly string[],
): EndpointManifest[] {
  const approved = new Set(approvedConnectionIds);
  return manifests.map(manifest => manifest.providerConnectionId
    && manifest.providerConnectionId !== `provider-default-${manifest.providerId}`
    && approved.has(manifest.providerConnectionId)
    ? { ...manifest, sensitivityClearance: [...new Set([...manifest.sensitivityClearance, sensitivity])] }
    : manifest);
}

/** Catalog profiles stay shared; execution identities and entitlements do not. */
export function expandProviderAccountCandidates(
  manifest: EndpointManifest,
  accounts: readonly ProviderAccountCandidateFacts[],
  defaultReady: boolean,
  _capabilityOverrides: unknown,
): EndpointManifest[] {
  const owned = accounts.filter(account => account.providerId === manifest.providerId);
  const defaultId = `provider-default-${manifest.providerId}`;
  const defaultAccount = owned.find(account => account.connectionId === defaultId);
  const result: EndpointManifest[] = [];
  if (defaultReady && (!defaultAccount || ["active", "degraded"].includes(defaultAccount.status))) {
    // The documented Z.ai coding alias can use the legacy shared key without
    // owning that credential. Never invent an account binding or borrow it for
    // an explicit additional account; a configured coding override is owned.
    const boundDefault = defaultAccount && !(manifest.providerId === "zai-coding" && !defaultAccount.credentialEntryId);
    result.push({ ...manifest, modelProfileId: manifest.id, providerConnectionId: undefined, providerConnectionVersion: undefined,
      ...(boundDefault ? { providerConnectionId: defaultId, providerConnectionVersion: accountExecutionVersion(defaultAccount!),
        accountAuthMethod: accountAuthMethod(defaultAccount!.authMethod), executionChannel: defaultAccount!.executionChannel } : {}) });
  }
  for (const account of owned) {
    if (account.connectionId === defaultId || !["active", "degraded"].includes(account.status)) continue;
    const authMethod = accountAuthMethod(account.authMethod);
    const isolatedCli = account.executionChannel === "subscription-cli"
      && (manifest.providerId === "codex" && ["api_key", "oauth2_authorization_code"].includes(authMethod)
        || manifest.providerId === "anthropic-sub" && authMethod === "oauth2_authorization_code");
    const supportedApi = account.executionChannel === "direct-api" && manifest.providerId !== "codex"
      && !(manifest.providerId === "anthropic-sub" && authMethod === "oauth2_authorization_code");
    const exclusion = !account.credentialEntryId || account.credentialEntry?.status !== "ok"
      ? "Provider account authentication is not verified"
      : !account.modelsVerifiedAt || !account.accessibleModelIds.includes(manifest.modelId)
        ? "Model access is not verified for this provider account"
        : ["expired", "rejected"].includes(account.evidenceStatus)
          ? "Provider account data-terms evidence is expired or rejected"
          : !supportedApi && !isolatedCli
            ? "Account isolation is not yet supported for this execution channel"
            : authMethod === "unsupported" || authMethod === "none"
              ? "Provider account authentication is unsupported"
              : null;
    result.push({ ...manifest,
      id: `${manifest.id}:account:${encodeURIComponent(account.connectionId)}`,
      modelProfileId: manifest.id,
      providerConnectionId: account.connectionId,
      providerConnectionVersion: accountExecutionVersion(account),
      accountAuthMethod: authMethod,
      executionChannel: account.executionChannel,
      // Company-data clearance is granted only by the request's account policy.
      sensitivityClearance: ["public"],
      riskAcceptedClearances: [],
      status: account.status === "degraded" || manifest.status === "degraded" ? "degraded" : manifest.status,
      eligibilityExclusionReason: exclusion ?? undefined,
    });
  }
  return result;
}
