// Provider-credential source (BI-282C39D5, Phase 2) — an enabled AI provider
// whose saved OAuth sign-in has EXPIRED, projected as a proactive "reconnect me"
// attention item.
//
// WHY THIS EXISTS: an expired credential (was connected, sign-in lapsed) makes a
// provider `needs_credentials` (provider-routing-eligibility.ts case 4). In the
// AI-readiness summary that keeps the Model-Supply domain at "attention", NOT
// "blocked" — and projectAiReadinessAttentionItems only projects "blocked"
// domains. So the incident this closes (a working Claude/GPT sign-in silently
// expires while a local model still exists) surfaced NO proactive signal: the
// operator only found out when a coworker turn died. This source fires the moment
// the token is past its expiry, so the Needs-you inbox names it BEFORE a turn
// fails, with the same one-click reconnect the failure message points at (#2965).
//
// SCOPED ON PURPOSE: only a *previously-connected, now-expired* credential is an
// alert. A never-configured provider is opt-in, not broken, so it is deliberately
// NOT projected here (it stays soft "attention" in readiness). Read-only
// projection over getProviders(); the credential lifecycle stays owned by the
// provider-oauth flow.

import { getProviders } from "@/lib/ai-provider-data";
import type { AttentionItem } from "../types";

/** Reconnect surface — the same target the honest failure message points at. */
export const PROVIDER_RECONNECT_ROUTE = "/platform/ai/providers";

export type ExpiredCredentialProvider = {
  providerId: string;
  name: string;
  /** ISO of when the saved token expired (past), for the age tie-break. */
  expiredAtIso: string;
};

/** Pure projection: one provider whose saved sign-in has expired → attention item. */
export function expiredCredentialToAttentionItem(
  provider: ExpiredCredentialProvider,
): AttentionItem {
  return {
    id: `provider-credential:${provider.providerId}`,
    source: "provider-credential",
    title: `Reconnect ${provider.name}`,
    context:
      `${provider.name}'s saved sign-in has expired, so routing can no longer use it. ` +
      `Reconnect it to restore this AI provider — waiting won't clear it.`,
    // An expired token is a fact, not a scored judgment call.
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none", // ordered by risk → age, like the other keystone sources
      residueReason: "needs-credential",
      blastRadius: provider.name,
      decideEffort: "one-tap",
      irreversible: false,
    },
    createdAtIso: provider.expiredAtIso,
    actions: [
      { kind: "open-in-context", label: "Reconnect provider", href: PROVIDER_RECONNECT_ROUTE },
    ],
    deepLink: PROVIDER_RECONNECT_ROUTE,
    audience: { operator: true },
  };
}

/**
 * Filter provider rows to those whose credential has EXPIRED — the same signal
 * the readiness summary uses (tokenExpiresAt in the past), plus an explicit
 * credential status of "expired" (set when a refresh fails). Pure over the row
 * shape so it unit-tests without prisma. `now` is injectable for determinism.
 */
export function selectExpiredCredentialProviders(
  rows: ReadonlyArray<{
    provider: { providerId: string; name: string; status: string; authMethod?: string | null; endpointType?: string | null };
    credential: { tokenExpiresAt?: string | Date | null; status?: string | null } | null;
  }>,
  now: Date = new Date(),
): ExpiredCredentialProvider[] {
  const nowMs = now.getTime();
  const items: ExpiredCredentialProvider[] = [];
  for (const row of rows) {
    const p = row.provider;
    if ((p.endpointType ?? "").toLowerCase() === "service") continue; // not a routing target
    const active = p.status === "active" || p.status === "degraded";
    const requiresCredential = (p.authMethod ?? "").toLowerCase() !== "none";
    if (!active || !requiresCredential || !row.credential) continue;

    const expiry = row.credential.tokenExpiresAt;
    const expiryMs = expiry ? new Date(expiry).getTime() : null;
    const expiredByToken = expiryMs != null && Number.isFinite(expiryMs) && expiryMs < nowMs;
    const expiredByStatus = (row.credential.status ?? "").toLowerCase() === "expired";
    if (!expiredByToken && !expiredByStatus) continue;

    items.push({
      providerId: p.providerId,
      name: p.name,
      // Prefer the concrete expiry timestamp; fall back to now when only the
      // status flag marks it expired (no timestamp to age against).
      expiredAtIso: expiredByToken ? new Date(expiryMs!).toISOString() : now.toISOString(),
    });
  }
  return items;
}

/**
 * Load providers whose saved sign-in has expired, as attention items. Thin async
 * wrapper over getProviders() + the pure filter above. Best-effort: any failure
 * yields no items (the aggregate records the source as failed, never throws).
 */
export async function loadProviderCredentialItems(): Promise<AttentionItem[]> {
  const rows = await getProviders();
  return selectExpiredCredentialProviders(rows).map(expiredCredentialToAttentionItem);
}
