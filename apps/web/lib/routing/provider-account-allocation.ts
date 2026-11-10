import { createHash } from "node:crypto";
import { accountRuntimeKey } from "./provider-account-candidates";

type AccountIdentity = { providerId: string; providerConnectionId?: string };
const inFlight = new Map<string, number>();
const affinity = new Map<string, { account: string; expiresAt: number }>();
const AFFINITY_TTL_MS = 60 * 60 * 1000;
const MAX_AFFINITIES = 4096;
const key = (account: AccountIdentity) => accountRuntimeKey(account.providerId, account.providerConnectionId);

/** Process-local scheduling only; it grants no quota, permission or eligibility. */
export function reserveProviderAccount(account: AccountIdentity): () => void {
  if (!account.providerConnectionId) return () => {};
  const identity = key(account);
  inFlight.set(identity, (inFlight.get(identity) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (inFlight.get(identity) ?? 1) - 1;
    if (remaining > 0) inFlight.set(identity, remaining);
    else inFlight.delete(identity);
  };
}

export function accountAffinityKey(agentId: string | null | undefined, threadId: string | null | undefined): string | undefined {
  return threadId ? createHash("sha256").update(JSON.stringify([agentId ?? null, threadId])).digest("hex") : undefined;
}

export function rememberAccountAffinity(taskKey: string | undefined, account: AccountIdentity, nowMs = Date.now()): void {
  if (!taskKey || !account.providerConnectionId) return;
  affinity.delete(taskKey);
  affinity.set(taskKey, { account: key(account), expiresAt: nowMs + AFFINITY_TTL_MS });
  while (affinity.size > MAX_AFFINITIES) affinity.delete(affinity.keys().next().value!);
}

/** Caller compares only eligible siblings with equal model and fitness. */
export function compareAccountAllocation(a: AccountIdentity, b: AccountIdentity, taskKey?: string, nowMs = Date.now()): number {
  const remembered = taskKey ? affinity.get(taskKey) : undefined;
  if (remembered && remembered.expiresAt <= nowMs) affinity.delete(taskKey!);
  if (remembered && remembered.expiresAt > nowMs) {
    const delta = Number(key(b) === remembered.account) - Number(key(a) === remembered.account);
    if (delta) return delta;
  }
  return (inFlight.get(key(a)) ?? 0) - (inFlight.get(key(b)) ?? 0);
}
