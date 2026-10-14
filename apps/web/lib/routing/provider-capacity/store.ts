import { prisma, type Prisma } from "@dpf/db";

import type { ProviderCapacityClassification } from "./types";
import { accountCapacityScope, capacityCredentialRevision, isAccountCapacityState } from "./scopes";
import { accountRuntimeKey } from "../provider-account-candidates";
import { capacityRoutingExclusionReason, type CapacitySnapshot } from "../capacity-routing-exclude";

export type ProviderCapacitySource = "api" | "cli" | "opencode" | "oauth" | "manual";
export type CapacityAccountIdentity = { accountId: string; connectionId: string; credentialEntryId: string | null; credentialUpdatedAt: Date; credentialRevision: string };

export function capacityAccountIdentity(account: { id: string; connectionId: string; credentialEntryId: string | null; credentialEntry: { id: string; updatedAt: Date; secretRef: string | null; clientSecret: string | null; cachedToken: string | null; refreshToken: string | null } | null }): CapacityAccountIdentity | undefined {
  return account.credentialEntry ? { accountId: account.id, connectionId: account.connectionId, credentialEntryId: account.credentialEntryId,
    credentialUpdatedAt: account.credentialEntry.updatedAt, credentialRevision: capacityCredentialRevision(account.credentialEntry) } : undefined;
}

/** Conservative quota grouping proves no shared authentication or grant lineage. */
export function indexProviderCapacityByProvider<T extends { providerId: string | null; state: string; retryAt: Date | null; lastObservedAt?: Date | null }>(rows: readonly T[], nowMs = Date.now()): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) if (row.providerId) map.set(row.providerId, row);
  for (const row of rows) {
    if (!["codex", "chatgpt"].includes(row.providerId ?? "") || !["quota_resets_at", "rate_limited"].includes(row.state)
      || !capacityRoutingExclusionReason({ state: row.state, retryAtMs: row.retryAt?.getTime(), observedAtMs: row.lastObservedAt?.getTime() }, nowMs)) continue;
    for (const providerId of ["codex", "chatgpt"]) {
      const current = map.get(providerId);
      if (!current || !["quota_resets_at", "rate_limited"].includes(current.state)
        || (row.retryAt?.getTime() ?? Infinity) > (current.retryAt?.getTime() ?? Infinity)) map.set(providerId, row);
    }
  }
  return map;
}

export function capacityProviderIds(providerIds: readonly string[]): string[] {
  return [...new Set([...providerIds, ...(providerIds.some(id => id === "codex" || id === "chatgpt") ? ["codex", "chatgpt"] : [])])];
}

/** One projection feeds routing; account-local observations never become global. */
export async function loadProviderCapacitySnapshots(): Promise<Map<string, CapacitySnapshot>> {
  const rows = await prisma.providerCapacityStatus.findMany({
    select: { providerId: true, scopeKey: true, observedCredentialRevision: true, state: true, retryAt: true, lastObservedAt: true,
      ownedAccount: { select: { id: true, connectionId: true, providerId: true, status: true, credentialEntryId: true, credentialEntry: { select: { id: true, status: true, updatedAt: true, secretRef: true, clientSecret: true, cachedToken: true, refreshToken: true } } } } },
  });
  const map = new Map<string, CapacitySnapshot>();
  for (const [providerId, row] of indexProviderCapacityByProvider(rows)) {
    map.set(providerId, { state: row.state, retryAtMs: row.retryAt?.getTime() ?? null, observedAtMs: row.lastObservedAt?.getTime() ?? null });
  }
  for (const row of rows) {
    const snapshot = { state: row.state, retryAtMs: row.retryAt?.getTime() ?? null, observedAtMs: row.lastObservedAt?.getTime() ?? null };
    const account = row.ownedAccount;
    if (account && ["active", "degraded"].includes(account.status) && account.credentialEntry?.status === "ok"
      && row.scopeKey === accountCapacityScope(account.providerId, account.id)
      && row.observedCredentialRevision === capacityCredentialRevision(account.credentialEntry)) {
      map.set(accountRuntimeKey(account.providerId, account.connectionId), snapshot);
    }
  }
  return map;
}

async function persistScopedCapacity(input: {
  providerId: string; account?: CapacityAccountIdentity;
}, data: Omit<Prisma.ProviderCapacityStatusUncheckedCreateInput, "providerId" | "scopeKey">): Promise<void> {
  if (!input.account) {
    await prisma.providerCapacityStatus.upsert({ where: { providerId: input.providerId }, create: { providerId: input.providerId, ...data }, update: data });
    return;
  }
  const identity = input.account;
  await prisma.$transaction(async tx => {
    // Lock account then credential together before ANY health or quota write.
    // Replacement/deletion waits until this short transaction commits; no network.
    const current = await tx.$queryRaw<Array<{ id: string; credentialId: string; updatedAt: Date; secretRef: string | null; clientSecret: string | null; cachedToken: string | null; refreshToken: string | null }>>`
      SELECT a.id, c.id AS "credentialId", c."updatedAt", c."secretRef", c."clientSecret", c."cachedToken", c."refreshToken"
      FROM "AiProviderConnection" a JOIN "CredentialEntry" c ON c.id=a."credentialEntryId"
      WHERE a.id=${identity.accountId} AND a."connectionId"=${identity.connectionId}
        AND a."providerId"=${input.providerId} AND a."credentialEntryId"=${identity.credentialEntryId}
        AND a.status IN ('active','degraded') AND c.status='ok' AND c."updatedAt"=${identity.credentialUpdatedAt}
      FOR UPDATE OF a, c`;
    const credential = current[0];
    if (!credential || capacityCredentialRevision({ ...credential, id: credential.credentialId }) !== identity.credentialRevision) return;
    const accountLocal = isAccountCapacityState(String(data.state)) || data.state === "available";
    const scopeKey = accountCapacityScope(input.providerId, identity.accountId);
    const revision = accountLocal ? { observedCredentialRevision: identity.credentialRevision } : {};
    const row = await tx.providerCapacityStatus.upsert({
    where: accountLocal ? { scopeKey } : { providerId: input.providerId },
    create: { providerId: accountLocal ? null : input.providerId, ...(accountLocal ? { scopeKey, ownedAccountId: identity.accountId } : {}), ...data, ...revision },
    update: { ...data, ...revision },
  });
    const attached = await tx.aiProviderConnection.updateMany({
    where: { id: identity.accountId, connectionId: identity.connectionId, providerId: input.providerId,
      credentialEntryId: identity.credentialEntryId,
      credentialEntry: { is: { updatedAt: identity.credentialUpdatedAt } },
      status: { in: ["active", "degraded"] } },
    data: accountLocal ? { capacityStatusId: row.id } : { quotaStatusId: row.id },
  });
    if (attached.count !== 1) throw new Error("Account capacity ownership changed inside transaction");
  });
}

export async function recordProviderCapacityStatus(input: {
  providerId: string;
  account?: CapacityAccountIdentity;
  classification: ProviderCapacityClassification;
  source: ProviderCapacitySource;
  observedAt?: Date;
  rawSnippet?: string;
}): Promise<void> {
  const observedAt = input.observedAt ?? new Date();
  const data = {
    state: input.classification.state,
    action: input.classification.action,
    retryAt: input.classification.retryAt ?? null,
    retryAfterSeconds: input.classification.retryAfterSeconds ?? null,
    providerCode: input.classification.providerCode ?? null,
    safeSummary: input.classification.safeSummary,
    confidence: input.classification.confidence,
    isHumanActionRequired: input.classification.isHumanActionRequired,
    lastObservedAt: observedAt,
    source: input.source,
    rawSnippet: input.rawSnippet?.slice(0, 500) ?? null,
  };

  await persistScopedCapacity(input, data);
}

export async function clearProviderCapacityStatus(input: {
  providerId: string;
  account?: CapacityAccountIdentity;
  source: ProviderCapacitySource;
  observedAt?: Date;
}): Promise<void> {
  const observedAt = input.observedAt ?? new Date();
  const data = {
    state: "available",
    action: "none",
    retryAt: null,
    retryAfterSeconds: null,
    providerCode: null,
    safeSummary: "Provider is available.",
    confidence: "exact",
    isHumanActionRequired: false,
    lastObservedAt: observedAt,
    lastSuccessAt: observedAt,
    source: input.source,
    rawSnippet: null,
  };

  await persistScopedCapacity(input, data);
}
