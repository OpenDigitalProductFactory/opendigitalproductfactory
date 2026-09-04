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
//
// BI-DB6A75D4 — the above was necessary but not sufficient, and the incident it
// was written for recurred verbatim. selectExpiredCredentialProviders only looks
// at active/degraded providers, but routing/fallback.ts DISABLES a non-local
// provider once its credentials genuinely fail. So the moment the failure the
// detector exists for actually lands, the provider leaves the set the detector
// scans and no item is ever projected. Observed live: `anthropic-sub` sat
// status=disabled for four days with zero operator signal (AI-readiness only
// projects "blocked" domains, and a healthy local model keeps Model Supply out
// of "blocked"; no other source reads provider status). The founder found out
// when a coworker turn degraded to the bundled local model and failed.
//
// selectDisabledConnectedProviders below closes that: a provider that routing
// disabled, which HAS a stored credential (i.e. was previously connected), is a
// reconnect alert. "inactive" is deliberately NOT included — that is an operator
// choice to turn a provider off, not a failure.

import { getProviders } from "@/lib/ai-provider-data";
import { AI_PROVIDER_CONNECTIONS_ROUTE } from "@/lib/ai-provider-routes";
import type { prisma } from "@dpf/db";
import {
  detectProviderSuitabilityDrift,
  type ObservedProviderPosture,
  type ProviderSuitabilityDriftSignal,
} from "@/lib/routing/provider-suitability/telemetry";
import type { AttentionItem } from "../types";

/** Reconnect surface — the same target the honest failure message points at. */
export const PROVIDER_RECONNECT_ROUTE = AI_PROVIDER_CONNECTIONS_ROUTE;

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

/** A previously-connected provider that routing has since disabled (BI-DB6A75D4). */
export type DisabledConnectedProvider = {
  providerId: string;
  name: string;
  /** ISO for the age tie-break: the credential expiry when known, else `now`. */
  detectedAtIso: string;
};

/**
 * Pure projection: a provider routing disabled while a credential is on file →
 * reconnect item. Distinct copy from the expired-credential lane because the
 * cause differs: we know routing turned it off, not that the token lapsed.
 */
export function disabledConnectedProviderToAttentionItem(
  provider: DisabledConnectedProvider,
): AttentionItem {
  return {
    id: `provider-credential:${provider.providerId}`,
    source: "provider-credential",
    title: `Reconnect ${provider.name}`,
    context:
      `${provider.name} was turned off automatically after its sign-in stopped working, ` +
      `so the AI workforce can no longer use it. Reconnect it to restore this AI provider — ` +
      `waiting won't clear it.`,
    // Routing disabled it on an observed credential failure — a fact, not a judgment call.
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "needs-credential",
      blastRadius: provider.name,
      decideEffort: "one-tap",
      irreversible: false,
    },
    createdAtIso: provider.detectedAtIso,
    actions: [
      { kind: "open-in-context", label: "Reconnect provider", href: PROVIDER_RECONNECT_ROUTE },
    ],
    deepLink: PROVIDER_RECONNECT_ROUTE,
    audience: { operator: true },
  };
}

/**
 * Filter provider rows to those routing has DISABLED while a credential is still
 * on file — the previously-connected-then-failed case that
 * `selectExpiredCredentialProviders` structurally cannot see (BI-DB6A75D4).
 *
 * Deliberate scoping, mirroring the expired lane:
 *  - `inactive` is NOT included — an operator turning a provider off is a choice.
 *  - no credential row → never connected → opt-in, not an alert.
 *  - `authMethod: "none"` (local engines) need no reconnect.
 *  - `endpointType: "service"` is not a routing target.
 *
 * Pure over the row shape so it unit-tests without prisma; `now` is injectable.
 */
export function selectDisabledConnectedProviders(
  rows: ReadonlyArray<{
    provider: { providerId: string; name: string; status: string; authMethod?: string | null; endpointType?: string | null };
    credential: { tokenExpiresAt?: string | Date | null; status?: string | null } | null;
  }>,
  now: Date = new Date(),
): DisabledConnectedProvider[] {
  const items: DisabledConnectedProvider[] = [];
  for (const row of rows) {
    const p = row.provider;
    if ((p.endpointType ?? "").toLowerCase() === "service") continue; // not a routing target
    if (p.status !== "disabled") continue;
    const requiresCredential = (p.authMethod ?? "").toLowerCase() !== "none";
    if (!requiresCredential || !row.credential) continue;

    // Age against the token expiry when we have one, so an older lapse sorts
    // ahead of a newer one; otherwise the disable is only observable as of now.
    const expiry = row.credential.tokenExpiresAt;
    const expiryMs = expiry ? new Date(expiry).getTime() : null;
    const usableExpiry = expiryMs != null && Number.isFinite(expiryMs) && expiryMs < now.getTime();

    items.push({
      providerId: p.providerId,
      name: p.name,
      detectedAtIso: usableExpiry ? new Date(expiryMs!).toISOString() : now.toISOString(),
    });
  }
  return items;
}

/**
 * Load providers needing a reconnect, as attention items: saved sign-in expired
 * (still routable) OR routing disabled it after a credential failure
 * (BI-DB6A75D4). Thin async wrapper over getProviders() + the pure filters above.
 * Best-effort: any failure yields no items (the aggregate records the source as
 * failed, never throws).
 *
 * The two lanes are mutually exclusive by construction — the expired lane
 * requires active/degraded, this one requires disabled — but they share an item
 * id, so dedupe by id keeps one row per provider if that ever stops holding.
 */
/** A cloud provider that is active but cleared for nothing any turn uses. */
export type UnclearedCloudProvider = {
  providerId: string;
  name: string;
  detectedAtIso: string;
};

/**
 * Pure projection: an ACTIVE cloud provider whose clearance does not include
 * `internal` → it can serve no real turn (BI-575F0046).
 *
 * This is the state a fresh install lands in and the one no source detected.
 * `deriveActivationClearance` grants a newly connected cloud account `["public"]`
 * until its trust evidence is reviewed, and no route is ever `public` —
 * ROUTE_SENSITIVITY floors at `internal`. So the provider is listed, healthy,
 * authenticated and eligible for nothing, and the workspace home stops showing
 * the local-only notice precisely because a provider now exists.
 *
 * Distinct from the expired-credential and disabled-provider lanes: nothing has
 * failed here. Reconnecting would not help, so the copy must not suggest it.
 */
export function selectUnclearedCloudProviders(
  rows: ReadonlyArray<{
    provider: {
      providerId: string;
      name: string;
      status: string;
      endpointType?: string | null;
      sensitivityClearance?: readonly string[] | null;
    };
  }>,
  now: Date = new Date(),
): UnclearedCloudProvider[] {
  const items: UnclearedCloudProvider[] = [];
  for (const row of rows) {
    const p = row.provider;
    if ((p.endpointType ?? "").toLowerCase() === "service") continue; // not a routing target
    if (p.providerId === "local" || p.providerId === "ollama") continue; // never leaves the box
    if (p.status !== "active") continue;
    if ((p.sensitivityClearance ?? []).includes("internal")) continue;

    items.push({ providerId: p.providerId, name: p.name, detectedAtIso: now.toISOString() });
  }
  return items;
}

export function unclearedCloudProviderToAttentionItem(
  provider: UnclearedCloudProvider,
): AttentionItem {
  const href = `/platform/ai/providers/${encodeURIComponent(provider.providerId)}`;
  return {
    id: `provider-uncleared:${provider.providerId}`,
    source: "provider-credential",
    title: `${provider.name} is connected but not yet doing any work`,
    context:
      `Signing in proved the connection works. It has not yet recorded how that account handles ` +
      `your business data, so your team keeps working on the built-in local AI instead. ` +
      `Confirming that takes about a minute and puts ${provider.name} to work on everyday tasks.`,
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "coverage-gap",
      blastRadius: provider.name,
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: provider.detectedAtIso,
    actions: [{ kind: "open-in-context", label: "Confirm data handling", href }],
    deepLink: href,
    audience: { operator: true },
  };
}

export async function loadProviderCredentialItems(): Promise<AttentionItem[]> {
  const rows = await getProviders();
  const items = [
    ...selectExpiredCredentialProviders(rows).map(expiredCredentialToAttentionItem),
    ...selectDisabledConnectedProviders(rows).map(disabledConnectedProviderToAttentionItem),
    ...selectUnclearedCloudProviders(rows).map(unclearedCloudProviderToAttentionItem),
  ];
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

export function suitabilityDriftToAttentionItem(signal: ProviderSuitabilityDriftSignal): AttentionItem {
  const restrictedBlock = signal.severity === "block-restricted"
    ? " Restricted routing stays blocked until this is resolved."
    : " Restricted routing may require review until this is resolved.";
  const href = `/platform/ai/providers/${encodeURIComponent(signal.providerId)}`;
  return {
    id: `provider-suitability:${signal.providerConnectionId}:${signal.kind}`,
    source: "provider-credential",
    title: `Review ${signal.providerName} trust evidence`,
    context: `${signal.summary} ${signal.nextAction}${restrictedBlock}`,
    decisionClass: { scorability: "unscorable" },
    riskClass: signal.severity === "block-restricted" ? "high-risk" : "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "coverage-gap",
      blastRadius: signal.providerName,
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: signal.detectedAt,
    actions: [{ kind: "open-in-context", label: "Review provider", href }],
    deepLink: href,
    audience: { operator: true },
  };
}

type Db = typeof prisma;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function observedAuthMethod(value: string | null): string {
  if (value === "api_key") return "api-key";
  if (value === "oauth2_authorization_code") return "oauth";
  if (value === "oauth2_client_credentials") return "workload-identity";
  if (value === "none") return "local";
  return "unknown";
}

function observedExecutionChannel(provider: {
  category: string;
  cliEngine: string | null;
  authMethod: string | null;
  catalogEntry: unknown;
}): string {
  const trust = object(object(provider.catalogEntry).trustCatalog);
  if (trust.externalEgress === "none" || provider.category === "local") return "local-runtime";
  if (provider.category === "router") return "hosted-router";
  if (provider.cliEngine && provider.authMethod === "oauth2_authorization_code") return "subscription-cli";
  return "direct-api";
}

function catalogReviewedAt(catalogEntry: unknown): string | null {
  const trust = object(object(catalogEntry).trustCatalog);
  return string(trust.reviewedAt) ?? string(trust.lastVerifiedAt);
}

function receiptPosture(value: unknown): (ObservedProviderPosture & { providerId?: string }) | null {
  const receipt = object(value);
  if (receipt.schemaVersion !== "provider-suitability-route-receipt/v1") return null;
  return {
    providerId: string(receipt.selectedProviderId) ?? undefined,
    executionChannel: string(receipt.executionChannel) ?? undefined,
    accountClass: string(receipt.accountClass) ?? undefined,
    endpoint: string(object(receipt.obligations).requiredBaseUrl) ?? undefined,
  };
}

/**
 * Project account-scoped evidence and observed route receipts into the existing
 * provider attention lane. This is advisory only; the compiler remains the
 * enforcement owner and expired/rejected evidence already fails closed there.
 */
export async function loadProviderSuitabilityDriftItems(
  db: Db,
  now: Date = new Date(),
): Promise<AttentionItem[]> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [connections, routes] = await Promise.all([
    db.aiProviderConnection.findMany({
      where: { status: { not: "disabled" } },
      include: {
        provider: {
          select: {
            name: true,
            category: true,
            cliEngine: true,
            authMethod: true,
            baseUrl: true,
            credentialOwnerMode: true,
            catalogEntry: true,
          },
        },
        supplierContract: { select: { endDate: true } },
        trustEvidence: {
          where: { claimKey: { not: null } },
          select: { claimKey: true, status: true, expiresAt: true },
        },
      },
    }),
    db.routeDecisionLog.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      select: { selectedEndpointId: true, excludedTrace: true, suitabilityReceipt: true },
      take: 500,
    }),
  ]);

  const latestReceipt = new Map<string, ObservedProviderPosture>();
  const failures = new Map<string, number>();
  for (const route of routes) {
    const receipt = receiptPosture(route.suitabilityReceipt);
    if (receipt?.providerId && !latestReceipt.has(receipt.providerId)) latestReceipt.set(receipt.providerId, receipt);
    if (route.selectedEndpointId !== "none") continue;
    const excluded = Array.isArray(route.excludedTrace) ? route.excludedTrace : [];
    for (const candidate of excluded) {
      const providerId = string(object(candidate).providerId);
      if (providerId) failures.set(providerId, (failures.get(providerId) ?? 0) + 1);
    }
  }

  return connections.flatMap((connection) => {
    const contract = object(connection.contractEvidence);
    const entitlements = object(connection.entitlements);
    const regionalEvidence = connection.trustEvidence
      .filter((evidence) => evidence.claimKey === "regional-processing" || evidence.claimKey === "enabled-regions")
      .map((evidence) => evidence.expiresAt)
      .filter((value): value is Date => Boolean(value))
      .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
    const signals = detectProviderSuitabilityDrift({
      providerConnectionId: connection.connectionId,
      providerId: connection.providerId,
      providerName: connection.label || connection.provider.name,
      catalogReviewedAt: catalogReviewedAt(connection.provider.catalogEntry),
      attestedAt: connection.lastReviewedAt?.toISOString() ?? null,
      contractExpiresAt: connection.supplierContract?.endDate?.toISOString() ?? null,
      regionalEntitlementExpiresAt: regionalEvidence?.toISOString() ?? null,
      evidenceClaims: connection.trustEvidence.map((evidence) => ({
        claimKey: evidence.claimKey ?? "unknown",
        status: evidence.status === "active" && evidence.expiresAt && evidence.expiresAt <= now ? "expired" : evidence.status,
      })),
      repeatedRouteFailures: failures.get(connection.providerId) ?? 0,
      attested: {
        executionChannel: connection.executionChannel,
        accountClass: connection.accountClass,
        planLimit: string(contract.contractPlanName) ?? undefined,
        endpoint: string(entitlements.requiredBaseUrl) ?? undefined,
        credentialKind: connection.authMethod,
      },
      observed: {
        ...latestReceipt.get(connection.providerId),
        executionChannel: observedExecutionChannel(connection.provider),
        planLimit: connection.provider.credentialOwnerMode ?? undefined,
        endpoint: connection.provider.baseUrl ?? undefined,
        credentialKind: observedAuthMethod(connection.provider.authMethod),
      },
      now,
    });
    return signals.map(suitabilityDriftToAttentionItem);
  });
}
