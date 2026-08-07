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
