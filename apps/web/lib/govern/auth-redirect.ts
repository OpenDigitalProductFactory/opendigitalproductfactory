import { normalizeReachableUrl } from "@/lib/reachable-url";

// Auth.js `redirect` callback logic, extracted as a pure function so it is
// unit-testable without booting NextAuth (BI-86165533).
//
// It mirrors Auth.js's default redirect policy — relative paths and same-origin
// absolute URLs are allowed, everything else falls back to the base — but first
// normalizes a bind-all host (0.0.0.0 / ::) to loopback. With `trustHost: true`
// and no `PUBLIC_URL`/`AUTH_URL`, Auth.js derives `baseUrl` from the request
// Host; on a default local install that can be the wildcard the server binds to,
// which would send the post-login redirect to an unloadable `http://0.0.0.0:3000`
// and leave the login form looking inert.
export function resolveAuthRedirect(url: string, baseUrl: string): string {
  const base = normalizeReachableUrl(baseUrl);

  // Relative callback path: resolve against the reachable base.
  if (url.startsWith("/")) return `${base}${url}`;

  const normalized = normalizeReachableUrl(url);
  try {
    // Only honor same-origin absolute redirects; otherwise fall back to base.
    if (new URL(normalized).origin === new URL(base).origin) return normalized;
  } catch {
    // Non-URL input — fall through to the safe base.
  }
  return base;
}
