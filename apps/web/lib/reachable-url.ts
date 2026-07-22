// Bind-all / unspecified host normalization (BI-86165533).
//
// `0.0.0.0` (IPv4) and `::` (IPv6) are the addresses a server LISTENS on — the
// "all interfaces" wildcard — never an address a browser can navigate TO. When a
// redirect URL is built from the request's Host header (Auth.js `trustHost`, our
// per-request `getPortalUrl`) and that Host is the wildcard, the browser is sent
// to `http://0.0.0.0:3000/...`, which simply does not load: the page appears
// inert with no error. On a default local install where `PUBLIC_URL`/`AUTH_URL`
// are unset there is nothing to override it, so we normalize the wildcard to the
// loopback name (`localhost`) at the point a reachable URL is needed.
//
// Pure string helpers only — no `next/headers`, no runtime deps — so they are
// trivially unit-testable and safe to import from both edge and node contexts.

const UNSPECIFIED_HOSTNAMES = new Set([
  "0.0.0.0",
  "::",
  "0:0:0:0:0:0:0:0",
]);

function stripBrackets(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "");
}

/** True when `hostname` is a bind-all / unspecified address that a browser
 *  cannot reach (`0.0.0.0`, `::`), with or without IPv6 brackets. */
export function isUnspecifiedHostname(hostname: string): boolean {
  return UNSPECIFIED_HOSTNAMES.has(stripBrackets(hostname));
}

/** Rewrite a `host` or `host:port` netloc to loopback when its host is a
 *  bind-all address. Preserves the port. Leaves any real host untouched. */
export function rewriteUnspecifiedNetloc(netloc: string): string {
  const match = netloc.match(/^(\[[^\]]+\]|[^:]+)(:\d+)?$/);
  if (!match) return netloc;
  const host = match[1];
  const port = match[2] ?? "";
  return isUnspecifiedHostname(host) ? `localhost${port}` : netloc;
}

/** Rewrite a full URL's host to loopback when it is a bind-all address, so the
 *  URL points at a page the browser can actually load. Non-URL input and real
 *  hosts are returned unchanged. */
export function normalizeReachableUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (isUnspecifiedHostname(parsed.hostname)) {
      parsed.hostname = "localhost";
      // toString() re-adds a trailing slash for an origin-only URL; strip it so
      // an origin stays an origin.
      return parsed.toString().replace(/\/+$/, url.endsWith("/") ? "/" : "");
    }
    return url;
  } catch {
    return url;
  }
}
