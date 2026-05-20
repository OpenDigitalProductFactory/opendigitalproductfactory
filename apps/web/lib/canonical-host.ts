// Pure host-matching logic for canonical-URL middleware.
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
// Kept pure and Next-free so it can be unit-tested without pulling in the
// edge runtime. The middleware (apps/web/middleware.ts) wires it up.

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
