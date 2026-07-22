// Sign-in redirect normalization (BI-86165533).
//
// Auth.js (`trustHost: true`, no explicit AUTH_URL) derives its base URL from
// the incoming request. In a self-hosted Docker deploy the portal process is
// bound to 0.0.0.0, and there are request paths (direct /api/auth/callback
// hits without a browser Host header, some proxy setups) where Auth.js ends up
// resolving its base URL to the *bind* address — `http://0.0.0.0:3000`.
//
// A relative `redirectTo: "/workspace"` then resolves to
// `http://0.0.0.0:3000/workspace`. 0.0.0.0 is a valid bind address but NOT a
// routable destination a browser can navigate to on Windows/macOS, so the
// post-login redirect silently fails: the browser stays on /login with no
// error and no console message — exactly the "inert login" symptom.
//
// `normalizeAuthRedirect` runs inside the NextAuth `redirect` callback and
// guarantees the final Location uses an operator-visible host: PUBLIC_URL when
// the operator has configured one, otherwise `localhost` (preserving scheme +
// port). It also preserves Auth.js's open-redirect guard — an absolute URL to
// a foreign origin collapses to the safe base.

/** Hostnames that are valid to *bind* to but are not routable *destinations*. */
const NON_ROUTABLE_BIND_HOSTS = new Set<string>([
  "0.0.0.0",
  "::",
  "[::]",
  "::0",
  "0000:0000:0000:0000:0000:0000:0000:0000",
]);

/** True when `host` (URL.hostname, no port) is a bind-only / unspecified address. */
export function isNonRoutableHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (NON_ROUTABLE_BIND_HOSTS.has(h)) return true;
  // URL.hostname strips brackets from IPv6 literals; catch the unspecified
  // address in both bracketed and bare forms.
  if (h === "::" || h === "[::]") return true;
  return false;
}

function tryParseUrl(value: string, base?: string): URL | null {
  try {
    return base ? new URL(value, base) : new URL(value);
  } catch {
    return null;
  }
}

/**
 * Resolve the operator-visible origin to redirect against.
 *
 * Precedence:
 *   1. A valid PUBLIC_URL origin (operator-declared canonical URL).
 *   2. The request-derived baseUrl, with a non-routable host rewritten to
 *      `localhost` (scheme + port preserved).
 */
export function resolveVisibleBase(baseUrl: string, publicUrl?: string | null): URL {
  const fromPublic = publicUrl && publicUrl.length > 0 ? tryParseUrl(publicUrl) : null;
  if (fromPublic && !isNonRoutableHost(fromPublic.hostname)) {
    return fromPublic;
  }

  const base = tryParseUrl(baseUrl);
  if (!base) {
    // Last-resort fallback — a syntactically valid, routable local origin.
    return new URL("http://localhost:3000");
  }
  if (isNonRoutableHost(base.hostname)) {
    base.hostname = "localhost";
  }
  return base;
}

/**
 * Normalize an Auth.js redirect target so the browser always lands on a
 * routable, operator-visible host.
 *
 * @param url      The redirect target Auth.js wants to send the user to. May be
 *                 relative (`/workspace`) or absolute (`http://0.0.0.0:3000/…`).
 * @param baseUrl  The Auth.js-derived base URL for this request.
 * @param publicUrl Operator-declared canonical URL (`process.env.PUBLIC_URL`).
 * @returns An absolute URL string safe to use as a redirect Location.
 */
export function normalizeAuthRedirect(args: {
  url: string;
  baseUrl: string;
  publicUrl?: string | null;
}): string {
  const { url, baseUrl, publicUrl } = args;
  const visibleBase = resolveVisibleBase(baseUrl, publicUrl);

  // Relative path (or protocol-relative) — resolve against the visible base.
  const resolved = tryParseUrl(url, visibleBase.href);
  if (!resolved) {
    return visibleBase.href;
  }

  // Rewrite a non-routable absolute host to the visible base host.
  if (isNonRoutableHost(resolved.hostname)) {
    resolved.protocol = visibleBase.protocol;
    resolved.hostname = visibleBase.hostname;
    resolved.port = visibleBase.port;
    return resolved.href;
  }

  // Open-redirect guard (mirrors Auth.js default): only allow same-origin
  // absolute targets; anything foreign collapses to the visible base.
  if (resolved.origin === visibleBase.origin) {
    return resolved.href;
  }
  return visibleBase.href;
}
