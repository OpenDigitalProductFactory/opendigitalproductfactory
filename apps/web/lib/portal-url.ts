// Resolves the portal's externally-reachable base URL.
//
// Rationale: hardcoding AUTH_URL/APP_URL to a single value (e.g. localhost:3000)
// breaks LAN access — a remote browser hits the portal's LAN IP, logs in, then
// gets redirected to its own loopback. The right pattern (per Auth.js v5,
// Next.js 16, Gitea, Outline, etc.) is to trust the request's Host header and
// derive the URL at request time. AUTH_TRUST_HOST=true on the portal container
// makes Auth.js do this automatically; this helper does the same for any code
// that needs an absolute URL outside Auth.js's own paths.
//
// Resolution order:
//   1. PUBLIC_URL env var (explicit override; required for outbound async flows
//      like emails/webhooks where there's no in-flight request)
//   2. x-forwarded-host + x-forwarded-proto (behind a reverse proxy)
//   3. host header (direct connection)
//   4. http://localhost:3000 (last-resort fallback for boot-time call paths)
//
// See AGENTS.md §13 (Login & Local QA) and the portal-URL design notes.

import { headers } from "next/headers";

function normalize(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Derive the portal's externally-reachable base URL from the in-flight request.
 *  Must be called from a server component, route handler, or server action. */
export async function getPortalUrl(): Promise<string> {
  if (process.env.PUBLIC_URL) return normalize(process.env.PUBLIC_URL);

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "http://localhost:3000";

  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}
