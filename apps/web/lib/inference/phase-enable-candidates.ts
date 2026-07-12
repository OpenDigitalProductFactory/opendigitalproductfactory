// apps/web/lib/inference/phase-enable-candidates.ts
//
// One-click, phase-aware AI-readiness remediation (BI-1A75E068, findings F10/F11).
//
// When a build phase reports "no eligible AI endpoint", the operator used to see
// a dead text pointer ("Activate a provider … in Providers & Routing") and had to
// hunt through 22 providers for one that fits. This module answers the actionable
// question instead: given a blocked phase's routing contract, which currently-OFF
// provider WOULD satisfy it if enabled — and is enabling it a one-click toggle, or
// does the operator still have to supply credentials?
//
// The eligibility check REUSES the exact routing hard-filter (getExclusionReasonV2
// from pipeline-v2) against manifests built by the exact same profile→manifest
// mapping the live router uses (loadEnableCandidateManifests, status forced to
// "active"). No new heuristic: a candidate is "eligible-if-enabled" iff the real
// routing filter would admit it once its provider is active.

import type { EndpointManifest } from "@/lib/routing/types";
import type { RequestContract } from "@/lib/routing/request-contract";
import { getExclusionReasonV2 } from "@/lib/routing/pipeline-v2";
import { loadEnableCandidateManifests } from "@/lib/routing/loader";
import { getProviders } from "@/lib/inference/ai-provider-data";

/** What the operator must do to make this provider resolve the phase. */
export type EnableActionKind =
  /** Off but credentialed (or local) — the one-click enable toggle applies. */
  | "enable"
  /** Off AND missing/expired credentials the operator must supply first. */
  | "connect_credentials"
  /** Never configured — needs full setup in Providers & Routing. */
  | "set_up";

/** A currently-off provider evaluated as an enable-candidate for one phase. */
export interface EnableCandidateProvider {
  providerId: string;
  displayName: string;
  /** ModelProvider.status — expected to be off (disabled/inactive/unconfigured). */
  status: string;
  /** ModelProvider.authMethod; "none" means no credential is required (local). */
  authMethod: string | null;
  /** A credential row exists for this provider. */
  hasCredential: boolean;
  /** The saved OAuth token has expired. */
  credentialExpired: boolean;
  /**
   * Manifests (one per discovered model) this provider would expose, with status
   * pre-forced to "active" so the hard filter reflects the enabled state.
   */
  manifests: EndpointManifest[];
}

export interface EnableCandidate {
  providerId: string;
  displayName: string;
  action: EnableActionKind;
  /** Button/label copy, e.g. "Enable provider" / "Connect & enable". */
  actionLabel: string;
  /** True only for `enable` — safe to perform with the provider-enable toggle. */
  oneClick: boolean;
  /** Contract requirements this provider's model satisfies, e.g. ["tool use", "≥ 22,000 ctx"]. */
  satisfies: string[];
  /** Extra step the operator must take first (credentials/OAuth), or null. */
  note: string | null;
}

function classifyAction(
  p: EnableCandidateProvider,
): { kind: EnableActionKind; label: string; note: string | null } {
  const status = (p.status ?? "").toLowerCase();
  const requiresCredential = (p.authMethod ?? "").toLowerCase() !== "none";
  const credentialReady = !requiresCredential || (p.hasCredential && !p.credentialExpired);

  if (status === "unconfigured" || status === "") {
    return {
      kind: "set_up",
      label: "Set up provider",
      note: "Not set up yet — configure it in Providers & Routing, then enable.",
    };
  }
  if (credentialReady) {
    // Off, but credentials are in place (or none are needed) → one click enables it.
    return { kind: "enable", label: "Enable provider", note: null };
  }
  // Off AND missing/expired credentials → the operator must supply them first.
  return {
    kind: "connect_credentials",
    label: "Connect & enable",
    note: p.credentialExpired
      ? "Its saved sign-in has expired — reconnect it in Providers & Routing, then enable."
      : "Needs credentials you must supply — add them in Providers & Routing, then enable.",
  };
}

/** Human list of the hard requirements this provider now meets for the phase. */
function describeSatisfied(contract: RequestContract): string[] {
  const out: string[] = [];
  if (contract.requiresTools) out.push("tool use");
  if (
    contract.minContextTokens !== undefined &&
    contract.minContextTokens !== null &&
    contract.minContextTokens > 0
  ) {
    out.push(`≥ ${contract.minContextTokens.toLocaleString()} ctx`);
  }
  if (contract.requiresStrictSchema) out.push("structured output");
  out.push(`${contract.sensitivity} sensitivity`);
  return out;
}

/**
 * Pure: given a blocked phase's routing contract and the currently-off providers
 * (each with the manifests it would expose if enabled), return the providers
 * whose capabilities WOULD satisfy the contract, ordered one-click-first.
 *
 * A provider qualifies iff at least one of its models passes the SAME hard filter
 * the live router applies (getExclusionReasonV2 === null). Deterministic and
 * DB-free, so it is fully unit-testable.
 */
export function selectEnableCandidatesForContract(
  contract: RequestContract,
  providers: EnableCandidateProvider[],
): EnableCandidate[] {
  const candidates: EnableCandidate[] = [];
  for (const p of providers) {
    const passing = p.manifests.some((m) => getExclusionReasonV2(m, contract) === null);
    if (!passing) continue;
    const action = classifyAction(p);
    candidates.push({
      providerId: p.providerId,
      displayName: p.displayName,
      action: action.kind,
      actionLabel: action.label,
      oneClick: action.kind === "enable",
      satisfies: describeSatisfied(contract),
      note: action.note,
    });
  }
  return candidates.sort(
    (a, b) =>
      Number(b.oneClick) - Number(a.oneClick) || a.displayName.localeCompare(b.displayName),
  );
}

/**
 * Impure: load every currently-off provider that has at least one discovered
 * model, shaped as EnableCandidateProvider (manifests + credential state), so a
 * caller can score them against any number of blocked-phase contracts without
 * re-querying. Returns [] when no off-provider has a usable model.
 */
export async function loadPhaseEnableCandidateProviders(): Promise<EnableCandidateProvider[]> {
  const manifests = await loadEnableCandidateManifests();
  if (manifests.length === 0) return [];

  const byProvider = new Map<string, EndpointManifest[]>();
  for (const m of manifests) {
    const list = byProvider.get(m.providerId);
    if (list) list.push(m);
    else byProvider.set(m.providerId, [m]);
  }

  const providers = await getProviders();
  const now = Date.now();
  const out: EnableCandidateProvider[] = [];
  for (const pw of providers) {
    const mans = byProvider.get(pw.provider.providerId);
    if (!mans || mans.length === 0) continue;
    const expiresAt = pw.credential?.tokenExpiresAt
      ? new Date(pw.credential.tokenExpiresAt).getTime()
      : null;
    out.push({
      providerId: pw.provider.providerId,
      displayName: pw.provider.name,
      status: pw.provider.status,
      authMethod: pw.provider.authMethod ?? null,
      hasCredential: !!pw.credential,
      credentialExpired: expiresAt !== null && expiresAt < now,
      manifests: mans,
    });
  }
  return out;
}
