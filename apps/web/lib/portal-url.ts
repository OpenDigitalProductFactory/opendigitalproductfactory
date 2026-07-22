// Resolves the portal's externally-reachable base URL.
//
// Two distinct contexts need this, with different correctness requirements:
//
// 1. Per-request (in-app redirects, response URL construction): the right
//    answer is whatever Host the browser used, so a remote LAN client and a
//    localhost client both get redirected back to themselves. Use
//    getPortalUrl() — it reads request headers via next/headers.
//
// 2. Stable / non-request (OAuth provider callback registration, outbound
//    emails, webhooks, server-startup tasks): the URL must NOT vary per
//    request. OAuth providers only accept exact pre-registered callbacks;
//    a Host-derived URL would mean every LAN client tries to use a callback
//    URL that wasn't registered. Use getStablePortalUrl() — env-driven only.
//
// Resolution order is the same chain in both helpers, but the request-scoped
// helper inserts header derivation as a middle step. The env override
// (PUBLIC_URL) wins in both.

import { headers } from "next/headers";
import { rewriteUnspecifiedNetloc } from "@/lib/reachable-url";

const DEFAULT_FALLBACK = "http://localhost:3000";

function normalize(url: string): string {
  return url.replace(/\/+$/, "");
}

/** The stable, non-request-scoped portal URL.
 *
 *  Use for: OAuth provider redirect URIs (must match what's registered with
 *  the provider), outbound emails, webhook payloads, server-startup tasks.
 *
 *  Resolution: PUBLIC_URL env -> last-resort localhost fallback. Never
 *  varies per request. */
export function getStablePortalUrl(): string {
  if (process.env.PUBLIC_URL) return normalize(process.env.PUBLIC_URL);
  return DEFAULT_FALLBACK;
}

/** The per-request portal URL, derived from incoming Host headers.
 *
 *  Use for: redirects inside route handlers / server actions / server
 *  components — anywhere there's an in-flight request and you want the
 *  response to point back to the same host the browser used.
 *
 *  Resolution: PUBLIC_URL env -> x-forwarded-host + x-forwarded-proto ->
 *  host header -> last-resort localhost fallback. */
export async function getPortalUrl(): Promise<string> {
  if (process.env.PUBLIC_URL) return normalize(process.env.PUBLIC_URL);

  const h = await headers();
  const rawHost = h.get("x-forwarded-host") ?? h.get("host");
  if (!rawHost) return DEFAULT_FALLBACK;

  // A bind-all Host (0.0.0.0 / ::) is not browser-reachable — rewrite it to
  // loopback BEFORE picking the protocol, so the derived URL loads and is
  // treated as local http (BI-86165533).
  const host = rewriteUnspecifiedNetloc(rawHost);

  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}
