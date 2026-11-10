import { isFederationScopedEndpoint } from "@dpf/validators";

import { normalizeOrganizationRef } from "@/lib/install/estate-identity-contract";

const CANDIDATE_TTL_MS = 2 * 60_000;

export type AutomaticPairingReadiness =
  | "tls-validation-required"
  | "blocked-insecure-transport";

export interface NearbyFederationCandidateInput {
  discoveryId: string;
  endpoint: string;
  protocol: "1";
  capabilityDigest: string;
  pairPath: "/connect/pair";
  /**
   * The estate the peer advertises, when its discovery record carried one.
   *
   * Optional on purpose. An Edge Node that predates this field, or a peer that
   * has never been named, simply advertises nothing — and an absent ref makes
   * `evaluateOrganizationEnrollment` answer `manual-approval`, which is the
   * correct outcome rather than a regression. A self-asserted name grants no
   * trust by itself: the same decision independently requires the peer's
   * certificate chain to validate against the pinned organization root.
   */
  organizationRef?: string;
}

export interface NearbyFederationCandidate extends NearbyFederationCandidateInput {
  displayName?: string;
  source?: "lan" | "introducer";
  introducedBy?: string;
  relationshipHint?: string;
  observedAt: string;
  expiresAt: string;
  automaticPairing: AutomaticPairingReadiness;
}

interface StoredCandidate extends NearbyFederationCandidate {
  edgeNodeId: string;
}

const globalCandidateCache = globalThis as typeof globalThis & {
  __dpfNearbyFederationCandidates?: Map<string, StoredCandidate>;
};
const candidates =
  globalCandidateCache.__dpfNearbyFederationCandidates ??
  (globalCandidateCache.__dpfNearbyFederationCandidates = new Map());

/**
 * Whether an endpoint is inside the scope discovery may report.
 *
 * The rule itself lives in `@dpf/validators` because the Edge Node that PRODUCES
 * candidates has to apply the same one the Authority accepts by — a scanner and
 * an acceptor that disagreed about scope would either drop good peers or submit
 * batches the route refuses. Re-exported under the name this module has always
 * used so its callers are unaffected.
 */
export const isLinkLocalFederationEndpoint = isFederationScopedEndpoint;

function normalizedAuthorityUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function prune(now: Date): void {
  for (const [key, row] of candidates) {
    if (Date.parse(row.expiresAt) <= now.getTime()) candidates.delete(key);
  }
}

export function recordNearbyFederationCandidates(input: {
  edgeNodeId: string;
  observedAt: Date;
  candidates: NearbyFederationCandidateInput[];
  localAuthorityUrl?: string;
  now?: Date;
}): void {
  const now = input.now ?? new Date();
  prune(now);
  const local = input.localAuthorityUrl
    ? normalizedAuthorityUrl(input.localAuthorityUrl)
    : null;

  for (const candidate of input.candidates) {
    const endpoint = normalizedAuthorityUrl(candidate.endpoint);
    if (endpoint === local) continue;
    const protocol = new URL(endpoint).protocol;
    const key = `${candidate.discoveryId}\u0000${endpoint}`;
    const organizationRef = normalizeOrganizationRef(candidate.organizationRef);
    candidates.set(key, {
      ...candidate,
      source: "lan",
      endpoint,
      // Normalised on the way IN, with the same function the local ref uses, so
      // the two are already comparable by the time a decision reads them.
      ...(organizationRef ? { organizationRef } : { organizationRef: undefined }),
      edgeNodeId: input.edgeNodeId,
      observedAt: input.observedAt.toISOString(),
      expiresAt: new Date(now.getTime() + CANDIDATE_TTL_MS).toISOString(),
      automaticPairing:
        protocol === "https:"
          ? "tls-validation-required"
          : "blocked-insecure-transport",
    });
  }
}

export function listNearbyFederationCandidates(
  now: Date = new Date(),
): NearbyFederationCandidate[] {
  prune(now);
  return [...candidates.values()]
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
    .map(({ edgeNodeId: _edgeNodeId, ...candidate }) => candidate);
}

export function _resetNearbyFederationCandidates(): void {
  candidates.clear();
}
