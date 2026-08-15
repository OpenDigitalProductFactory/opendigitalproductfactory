import { isIP } from "node:net";

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

export function isLinkLocalFederationEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return false;
  }
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (host.endsWith(".local")) return true;
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
    const match172 = /^172\.(\d{1,3})\./.exec(host);
    if (match172 && Number(match172[1]) >= 16 && Number(match172[1]) <= 31) return true;
    return /^169\.254\./.test(host);
  }
  if (ipVersion !== 6) return false;
  const firstHextet = Number.parseInt(host.split(":", 1)[0] ?? "", 16);
  return (
    host === "::1" ||
    (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) ||
    (firstHextet >= 0xfc00 && firstHextet <= 0xfdff)
  );
}

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
    candidates.set(key, {
      ...candidate,
      source: "lan",
      endpoint,
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
