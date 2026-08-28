// Operator-settable policy for the MCP authorization server.
//
// Every value here is one of the open decisions in design §9. The defaults are
// this design's recommendations; each is overridable by environment so an
// operator can move it without a code change, and each is read through a
// function rather than a module constant so a test can vary it.
//
// Design: docs/superpowers/specs/2026-08-26-mcp-client-self-authentication-design.md §9

import { isLoopbackHostname } from "@/lib/auth/oauth-metadata";

function envFlag(name: string): boolean | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return null;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * §9.1 — Dynamic Client Registration default.
 *
 * Enabled on loopback only. Registration alone grants nothing (every token
 * still needs an authenticated human to consent), but an open `/register` on a
 * reachable install is a junk-row and phishing-surface vector: a self-
 * registered client picks its own `client_name`, which is why the consent
 * screen marks DCR clients as self-asserted.
 *
 * `DPF_OAUTH_DCR` forces it on or off regardless of origin.
 */
export function isDcrEnabled(origin: string | null): boolean {
  const forced = envFlag("DPF_OAUTH_DCR");
  if (forced !== null) return forced;
  if (!origin) return false;
  try {
    return isLoopbackHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** §9.2 — access-token lifetime. 1h recommended: shorter buys little on a
 *  local box and costs refresh traffic; longer widens the replay window. */
export function accessTokenTtlSeconds(): number {
  return envInt("DPF_OAUTH_ACCESS_TTL_SECONDS", 3600, 300, 86_400);
}

/** Refresh tokens are long-lived and ROTATE on every use (see the token
 *  endpoint): a replayed refresh token is detected because its successor
 *  already exists. */
export function refreshTokenTtlSeconds(): number {
  return envInt("DPF_OAUTH_REFRESH_TTL_SECONDS", 60 * 60 * 24 * 30, 3600, 60 * 60 * 24 * 365);
}

/** Authorization codes are single-use and short-lived. OAuth 2.1 recommends
 *  a maximum of 10 minutes; 60s is ample for a loopback redirect. */
export function authorizationCodeTtlSeconds(): number {
  return envInt("DPF_OAUTH_CODE_TTL_SECONDS", 120, 30, 600);
}

/**
 * §9.5 — PAT deprecation.
 *
 * Two independent switches, because they retire in order:
 *  - issuance closes first (nothing new is minted),
 *  - resolution survives until the horizon so no configured client breaks
 *    mid-flight.
 *
 * Both default OFF. Turning the first on is the operator starting the clock;
 * turning the second on is the horizon arriving. Defaulting either to ON would
 * break working installs on upgrade, which is precisely what the migration
 * surface exists to avoid.
 */
export function isPatIssuanceClosed(): boolean {
  return envFlag("DPF_MCP_PAT_ISSUANCE_CLOSED") === true;
}

export function isPatResolutionDisabled(): boolean {
  return envFlag("DPF_MCP_PAT_RESOLUTION_DISABLED") === true;
}

/** Client-credentials clients are operator-issued, so their tokens may be
 *  slightly longer-lived than a browser session's — but they are still short
 *  by PAT standards, which is the point of retiring the PAT. */
export function clientCredentialsTtlSeconds(): number {
  return envInt("DPF_OAUTH_CC_TTL_SECONDS", 3600, 300, 86_400);
}

/**
 * Outbound Client ID Metadata Document resolution (SEP-991).
 *
 * OFF by default. Resolving a CIMD client means fetching a URL the CLIENT
 * chose, which is a server-side request to an attacker-selected address. The
 * address guard in outbound-url-guard.ts blocks private and reserved ranges,
 * but the strongest control is not making the request at all on an install
 * that never needed it — and a fully-local install cannot use CIMD anyway,
 * because it cannot reach the public internet to fetch the document. DCR is
 * the path there.
 *
 * Turn this on only for an install deliberately exposed to the internet whose
 * clients authenticate by metadata document.
 */
export function isCimdFetchEnabled(): boolean {
  return envFlag("DPF_OAUTH_CIMD_FETCH") === true;
}
