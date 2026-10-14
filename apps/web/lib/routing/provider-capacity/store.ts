import { prisma, type Prisma } from "@dpf/db";

import type { ProviderCapacityClassification } from "./types";
import { accountCapacityScope, isAccountCapacityState } from "./scopes";
import { accountRuntimeKey } from "../provider-account-candidates";
import { capacityRoutingExclusionReason, type CapacitySnapshot } from "../capacity-routing-exclude";

export type ProviderCapacitySource = "api" | "cli" | "opencode" | "oauth" | "manual";
export type CapacityAccountIdentity = { connectionId: string; credentialEntryId: string | null; credentialUpdatedAt?: Date };

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
    select: { providerId: true, scopeKey: true, state: true, retryAt: true, lastObservedAt: true,
      providerConnection: { select: { connectionId: true, providerId: true, credentialEntryId: true, credentialEntry: { select: { updatedAt: true } } } } },
  });
  const map = new Map<string, CapacitySnapshot>();
  for (const [providerId, row] of indexProviderCapacityByProvider(rows)) {
    map.set(providerId, { state: row.state, retryAtMs: row.retryAt?.getTime() ?? null, observedAtMs: row.lastObservedAt?.getTime() ?? null });
  }
  for (const row of rows) {
    const snapshot = { state: row.state, retryAtMs: row.retryAt?.getTime() ?? null, observedAtMs: row.lastObservedAt?.getTime() ?? null };
    const account = row.providerConnection;
    if (account && row.scopeKey === accountCapacityScope(account.providerId, account.connectionId, account.credentialEntryId, account.credentialEntry?.updatedAt)) {
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
  const accountLocal = isAccountCapacityState(String(data.state)) || data.state === "available";
  const scopeKey = accountCapacityScope(input.providerId, input.account.connectionId, input.account.credentialEntryId, input.account.credentialUpdatedAt);
  const row = await prisma.providerCapacityStatus.upsert({
    where: accountLocal ? { scopeKey } : { providerId: input.providerId },
    create: { providerId: accountLocal ? null : input.providerId, ...(accountLocal ? { scopeKey } : {}), ...data },
    update: data,
  });
  // A stale attempt cannot attach observations to replacement credentials.
  await prisma.aiProviderConnection.updateMany({
    where: { connectionId: input.account.connectionId, providerId: input.providerId,
      credentialEntryId: input.account.credentialEntryId,
      ...(input.account.credentialUpdatedAt ? { credentialEntry: { is: { updatedAt: input.account.credentialUpdatedAt } } } : {}),
      status: { in: ["active", "degraded"] } },
    data: accountLocal ? { capacityStatusId: row.id } : { quotaStatusId: row.id },
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
