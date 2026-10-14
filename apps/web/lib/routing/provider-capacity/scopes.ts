import { createHash } from "node:crypto";

/** Authentication/entitlements belong to the exact account, never a sibling. */
export function accountCapacityScope(providerId: string, accountId: string): string {
  return `account:${createHash("sha256").update(JSON.stringify([providerId, accountId])).digest("hex")}`;
}

/** One-way revision of encrypted storage, never plaintext credentials. */
export function capacityCredentialRevision(credential: { id: string; updatedAt: Date; secretRef: string | null; clientSecret: string | null; cachedToken: string | null; refreshToken: string | null }): string {
  return createHash("sha256").update(JSON.stringify([credential.id, credential.updatedAt.toISOString(), credential.secretRef, credential.clientSecret, credential.cachedToken, credential.refreshToken])).digest("hex");
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
