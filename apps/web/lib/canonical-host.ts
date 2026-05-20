// Canonical-URL host matching + enforcement.
//
// Decides whether an incoming request's Host header matches the operator's
// configured canonical URL (PUBLIC_URL) or one of the configured aliases
// (PUBLIC_URL_ALIASES). When canonical is unset, every host is accepted —
// this is the Gitea `PUBLIC_URL_DETECTION=auto` "bootstrap before DNS"
// pattern, required for local dev and pre-deployment configuration.
//
// Aliases come from Home Assistant's `internal_url` concept: even after an
// admin sets a public canonical URL, LAN clients may still need to reach
// the install at the LAN IP without being bounced to the public name.
//
// `decideHostMatch` is the pure, Next-free core; `enforceCanonicalHost` is
// the Next.js wrapper called from apps/web/proxy.ts (Next 16's edge
// middleware entry point — renamed from middleware.ts in Next 16).

export type CanonicalHostConfig = {
  /** `process.env.PUBLIC_URL` — full URL string including scheme. */
  canonicalUrl: string | undefined;
  /** `process.env.PUBLIC_URL_ALIASES` — raw comma-separated host:port list. */
  aliases: string;
};

export type HostMatch =
  | {
      kind: "passthrough";
      reason:
        | "no-canonical-configured"
        | "host-matches-canonical"
        | "host-matches-alias"
        | "no-host-header";
    }
  | { kind: "redirect"; targetUrl: string };

function parseCanonicalHost(canonicalUrl: string): { host: string; origin: string } | null {
  try {
    const url = new URL(canonicalUrl);
    // url.host already includes port when explicit and omits default ports.
    // url.origin gives us scheme://host[:port] without trailing slash.
    if (!url.host) return null;
    return { host: url.host.toLowerCase(), origin: url.origin };
  } catch {
    return null;
  }
}

function parseAliases(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/** Decide whether a request should pass through unchanged or be redirected
 *  to the canonical origin. See module comment for rules. */
export function decideHostMatch(args: {
  host: string | null | undefined;
  path: string;
  search: string;
  config: CanonicalHostConfig;
}): HostMatch {
  const { host, path, search, config } = args;

  if (!config.canonicalUrl || config.canonicalUrl.length === 0) {
    return { kind: "passthrough", reason: "no-canonical-configured" };
  }

  const canonical = parseCanonicalHost(config.canonicalUrl);
  if (!canonical) {
    // Malformed PUBLIC_URL — fail open so a typo doesn't lock the operator
    // out. Logged at the middleware layer (not here, to keep this pure).
    return { kind: "passthrough", reason: "no-canonical-configured" };
  }

  if (!host) {
    return { kind: "passthrough", reason: "no-host-header" };
  }

  const requestHost = host.toLowerCase();

  if (requestHost === canonical.host) {
    return { kind: "passthrough", reason: "host-matches-canonical" };
  }

  const aliases = parseAliases(config.aliases);
  if (aliases.includes(requestHost)) {
    return { kind: "passthrough", reason: "host-matches-alias" };
  }

  return { kind: "redirect", targetUrl: `${canonical.origin}${path}${search}` };
}

// ─── Next.js wrapper ──────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";

const HEALTH_PROBE_PATHS = new Set(["/api/health", "/api/healthz", "/api/ready"]);

/** Enforce canonical-host policy on an incoming Next request.
 *
 *  Returns a 301 redirect response (with `Clear-Site-Data: "storage"`) when
 *  the request host does not match PUBLIC_URL or PUBLIC_URL_ALIASES, and
 *  `null` when the request should pass through unchanged.
 *
 *  Health-probe paths (`/api/health`, `/api/healthz`, `/api/ready`) are
 *  always excluded — load balancers hit these on the LAN IP and a redirect
 *  would fail the probe.
 *
 *  Header is set on the response object after construction (not via init
 *  options) — Next can strip headers during redirect normalization, and
 *  the Clear-Site-Data value MUST be the quoted string `"storage"` per
 *  the W3C spec (directives are quoted-string values, not bare tokens). */
export function enforceCanonicalHost(
  req: Pick<NextRequest, "headers" | "nextUrl">,
): NextResponse | null {
  const { pathname, search } = req.nextUrl;

  if (HEALTH_PROBE_PATHS.has(pathname)) return null;

  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? null;

  const decision = decideHostMatch({
    host,
    path: pathname,
    search,
    config: {
      canonicalUrl: process.env.PUBLIC_URL,
      aliases: process.env.PUBLIC_URL_ALIASES ?? "",
    },
  });

  if (decision.kind === "passthrough") return null;

  const response = NextResponse.redirect(decision.targetUrl, 301);
  response.headers.set("Clear-Site-Data", '"storage"');
  return response;
}
