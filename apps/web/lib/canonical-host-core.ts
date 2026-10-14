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
// This module is the pure, Next-free core. The Next.js wrapper,
// `enforceCanonicalHost`, lives in ./canonical-host.ts and is called from
// apps/web/proxy.ts. Keep this file free of `next/*` imports: scripts the
// portal image runs from /app/apps/web-src reach it through
// lib/auth/oauth-policy, and `next/server` does not resolve there
// (issue-grok-credentials-client.ts died on it; see
// scripts/check-web-src-script-imports.mjs).

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

/** Did this request arrive through the configured public hostname?
 *
 *  True when PUBLIC_URL is set and the Host or X-Forwarded-Host header names
 *  its host. Internal callers (Prometheus on `portal:3000`, loopback, LAN
 *  aliases) never match. Used to keep internal-only surfaces off the public
 *  name; it is a second layer behind the reachability ingress, never an
 *  authorization check. */
export function arrivedViaPublicHost(args: {
  host: string | null | undefined;
  forwardedHost: string | null | undefined;
  canonicalUrl: string | undefined;
}): boolean {
  if (!args.canonicalUrl) return false;
  const canonical = parseCanonicalHost(args.canonicalUrl);
  if (!canonical) return false;
  return [args.host, args.forwardedHost].some(
    (value) => typeof value === "string" && value.trim().toLowerCase() === canonical.host,
  );
}

/**
 * Is `origin` one of the install's configured canonical origins — PUBLIC_URL's
 * own origin, or a PUBLIC_URL_ALIASES host on PUBLIC_URL's scheme?
 *
 * Unlike `decideHostMatch`, an unset or malformed PUBLIC_URL is NOT a pass: a
 * caller asking this question is deciding whether to extend trust to an origin
 * (design §12.4.5, DCR on the canonical origin), so absence of configuration
 * answers "no" rather than failing open. Scheme, host and port must all match;
 * the scheme's default port is equivalent to no port.
 */
export function isConfiguredCanonicalOrigin(origin: string, config: CanonicalHostConfig): boolean {
  if (!config.canonicalUrl) return false;
  const canonical = parseCanonicalHost(config.canonicalUrl);
  if (!canonical) return false;
  let candidate: URL;
  try {
    candidate = new URL(origin);
  } catch {
    return false;
  }
  if (candidate.username !== "" || candidate.password !== "") return false;
  const canonicalScheme = new URL(canonical.origin).protocol;
  if (candidate.protocol !== canonicalScheme) return false;
  const candidateHost = candidate.host.toLowerCase();
  if (candidateHost === canonical.host) return true;
  return parseAliases(config.aliases).some((alias) => {
    try {
      return new URL(`${canonicalScheme}//${alias}`).host === candidateHost;
    } catch {
      return false;
    }
  });
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
