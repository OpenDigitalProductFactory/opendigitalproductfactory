// Resolve THIS installation's federation Authority URL — the address a peer is
// told to reach us at during enroll — WITHOUT requiring the operator to type it.
//
// Before this, the pairing actions called resolveAppBaseUrl(), which returns null
// in production unless PUBLIC_URL (or NEXT_PUBLIC_*) is set. A same-organization
// LAN operator then hit "base URL is not configured (set APP_URL)" and pairing
// failed — the manual-typing step this design eliminates.
//
// The reliable zero-typing source is the REQUEST HOST: the operator reached the
// portal at (e.g.) http://192.168.0.152:3000/platform/federation-links, so that
// Host header IS the LAN address a same-org peer can reach. We cannot derive it
// from os.networkInterfaces() — inside the portal container that returns the
// Docker bridge IP (172.x), not the host's reachable LAN IP.
//
// Precedence: explicit config wins (PUBLIC_URL / NEXT_PUBLIC_* via
// resolveAppBaseUrl — correct for reverse-proxy / public deployments), then the
// request Host header (correct for same-org LAN), then null (caller errors).

import { headers } from "next/headers";

import { resolveAppBaseUrl } from "@/lib/app-url";

/** Pure core: pick the self-authority URL from configured value or request host.
 *  Exported for direct unit testing (no next/headers dependency). */
export function deriveFederationAuthorityUrl(args: {
  /** resolveAppBaseUrl() result — explicit PUBLIC_URL / NEXT_PUBLIC_* config. */
  configuredBaseUrl: string | null;
  /** x-forwarded-host ?? host from the incoming request. */
  host: string | null | undefined;
  /** x-forwarded-proto from the incoming request, if any. */
  forwardedProto: string | null | undefined;
}): string | null {
  const { configuredBaseUrl, host, forwardedProto } = args;

  if (configuredBaseUrl && configuredBaseUrl.trim()) {
    return configuredBaseUrl.trim().replace(/\/+$/, "");
  }

  if (host && host.trim()) {
    // x-forwarded-proto may be a comma list (proxy chain); take the first hop.
    const proto = forwardedProto?.split(",")[0]?.trim() || "http";
    return `${proto}://${host.trim()}`.replace(/\/+$/, "");
  }

  return null;
}

/** True for a loopback host — localhost, 127.0.0.0/8, or ::1. A private LAN
 *  address (192.168.x, 10.x, 172.16-31.x) is NOT loopback: it is reachable by a
 *  peer on the same network, so it is a valid self-address to advertise. */
export function isLoopbackAuthorityHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost") return true;
  if (host.replace(/^\[|\]$/g, "") === "::1") return true;
  return host.startsWith("127.");
}

/** Guard the self-address we are about to advertise to a peer. A loopback
 *  self-URL is unreachable from any OTHER host, so advertising it to a remote
 *  (non-loopback) peer silently breaks the link — the peer records our address
 *  as its own localhost. We allow a loopback self-URL only when the peer is also
 *  loopback (both instances on one host — legitimate dev). Returns an operator-
 *  facing reason string when the pairing must be refused, else null. */
export function selfAuthorityUnreachableReason(args: {
  selfAuthorityUrl: string;
  peerAuthorityUrl: string;
}): string | null {
  const { selfAuthorityUrl, peerAuthorityUrl } = args;
  if (!isLoopbackAuthorityHost(selfAuthorityUrl)) return null;
  if (isLoopbackAuthorityHost(peerAuthorityUrl)) return null; // both on one host
  return (
    `This installation resolved its own address as ${selfAuthorityUrl}, which the ` +
    `peer at ${peerAuthorityUrl} cannot reach. Open this page at this installation's ` +
    `LAN address (for example http://192.168.x.x:3000) — the address you view it at ` +
    `is what the peer is told to use — or set PUBLIC_URL, then reconnect.`
  );
}

/** Resolve this install's federation Authority URL for enroll/invite/connect.
 *  Must be called from a request scope (server action / route) so the Host
 *  header is available. Returns null only when neither config nor a Host header
 *  is present. */
export async function resolveLocalFederationAuthorityUrl(): Promise<string | null> {
  const configuredBaseUrl = resolveAppBaseUrl();
  let host: string | null = null;
  let forwardedProto: string | null = null;
  try {
    const h = await headers();
    host = h.get("x-forwarded-host") ?? h.get("host");
    forwardedProto = h.get("x-forwarded-proto");
  } catch {
    // headers() throws outside a request scope (background job / unit test).
    // There is no Host header to read, so fall back to explicit config only —
    // the pre-existing behavior. The Host fallback applies only to the
    // request-scoped pairing actions, which is exactly where it is needed.
  }
  return deriveFederationAuthorityUrl({ configuredBaseUrl, host, forwardedProto });
}
