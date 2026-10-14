import { createHash } from "node:crypto";

/** Authentication/entitlements belong to the exact account, never a sibling. */
export function accountCapacityScope(providerId: string, connectionId: string, credentialEntryId?: string | null, credentialUpdatedAt?: Date): string {
  return `account:${createHash("sha256").update(JSON.stringify([providerId, connectionId, credentialEntryId ?? null, ...(credentialUpdatedAt ? [credentialUpdatedAt.toISOString()] : [])])).digest("hex")}`;
}

/** Credentials alone do not establish separate upstream quota ownership. */
export function conservativeQuotaScope(providerId: string): string {
  // These consumer channels may share an upstream subscription. Until a
  // distinct budget is proven, treat them as one budget; this proves no lineage.
  return `provider:${providerId === "chatgpt" ? "codex" : providerId}`;
}

export function isAccountCapacityState(state: string): boolean {
  return ["reauth_required", "unsupported_plan", "billing_action_required"].includes(state);
}
