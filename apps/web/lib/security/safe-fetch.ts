// apps/web/lib/security/safe-fetch.ts
//
// BI-5E53A265 — SSRF defense for user-controlled URLs that flow to
// outbound fetch(). CodeQL flagged 4 true-positive sites
// (js/request-forgery / CWE-918) where `new URL(userInput)` was used
// as the ONLY validation before `fetch()`:
//
//   - calendar-sync.ts (feed URL — the worst, cloud-metadata exposure)
//   - github-fork.ts   (api.github.com path injection)
//   - platform-dev-config.ts (same shape as github-fork)
//   - mcp-server-health.ts (admin-configured URL, lower risk)
//
// The unified fix is a single sanitizer:
//
//   const url = assertSafeOutboundUrl(input, opts);
//   const res = await fetch(url.href, ...);
//
// The function throws on any failure (scheme not allowed, host not on
// allowlist, host resolves to a private network). Returning a `URL`
// instead of a string makes CodeQL's sanitizer modeling cleaner: the
// validated value carries a distinct type from the raw input.
//
// Anti-goals:
//   - Not a DNS-rebinding defense. A hostname that resolves to a public
//     IP at validation time could resolve to a private IP at fetch
//     time. Closing that gap requires re-resolving at fetch time and
//     pinning the IP — left as a follow-up. For the audited CWE-918
//     cases, the simpler check is already a large step up from "no
//     check at all."
//   - Not a content-type filter. Operators who want to reject specific
//     response shapes (e.g., HTML where iCal is expected) should layer
//     that on top.
//
// Tests: apps/web/lib/security/safe-fetch.test.ts — authored before
// this implementation per the kernel principle
// `security-fix-needs-regression-test-first`.

/**
 * Schemes permitted by default. http is intentionally excluded because
 * a feed URL or webhook target that ships over plain http is almost
 * always a misconfiguration; callers who genuinely need http (e.g.,
 * for a local-network-only flow) opt in explicitly.
 */
const DEFAULT_ALLOWED_SCHEMES: ReadonlyArray<string> = ["https:"];

/**
 * Hostnames that resolve (literally or by convention) to the loopback
 * or local network. Checked as exact string match before IP-range checks
 * so an attacker can't bypass via `localhost` instead of `127.0.0.1`.
 */
const LITERAL_PRIVATE_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
]);

/**
 * Test if a hostname looks like an IPv4 literal (4 dot-separated octets).
 * Returns the parsed octets or null.
 */
function parseIpv4(host: string): [number, number, number, number] | null {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((o) => o < 0 || o > 255)) return null;
  return octets as [number, number, number, number];
}

/**
 * Classify an IPv4 address. Returns a reason string if blocked, null
 * if public. The classes covered:
 *   - 0.0.0.0/8        unspecified / current network
 *   - 10.0.0.0/8       RFC1918 private
 *   - 127.0.0.0/8      loopback
 *   - 169.254.0.0/16   link-local (includes the 169.254.169.254 cloud
 *                      metadata address — the textbook SSRF target)
 *   - 172.16.0.0/12    RFC1918 private
 *   - 192.168.0.0/16   RFC1918 private
 *   - 100.64.0.0/10    RFC6598 carrier-grade NAT (treat as private)
 */
function classifyIpv4(octets: [number, number, number, number]): string | null {
  const [a, b] = octets;
  if (a === 0) return "0.0.0.0/8 (unspecified / current network)";
  if (a === 10) return "RFC1918 private (10.0.0.0/8)";
  if (a === 127) return "loopback (127.0.0.0/8)";
  if (a === 169 && b === 254) return "link-local (169.254.0.0/16) — includes cloud-metadata 169.254.169.254";
  if (a === 172 && b >= 16 && b <= 31) return "RFC1918 private (172.16.0.0/12)";
  if (a === 192 && b === 168) return "RFC1918 private (192.168.0.0/16)";
  if (a === 100 && b >= 64 && b <= 127) return "RFC6598 carrier-grade NAT (100.64.0.0/10)";
  return null;
}

/**
 * Classify an IPv6 hostname (host portion inside brackets, e.g. "::1").
 * Returns a reason string if blocked, null if not blocked. We are
 * intentionally permissive for unrecognised shapes — IPv6 has many
 * formats; the safe direction is to block the known-bad ones.
 */
function classifyIpv6(host: string): string | null {
  const normalized = host.toLowerCase();
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return "IPv6 loopback (::1)";
  }
  if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") {
    return "IPv6 unspecified (::)";
  }
  // fe80::/10 link-local
  if (/^fe[89ab]/i.test(normalized)) return "IPv6 link-local (fe80::/10)";
  // fc00::/7 unique-local (fc00–fdff)
  if (/^f[cd]/i.test(normalized)) return "IPv6 unique-local (fc00::/7)";
  return null;
}

/**
 * Test the hostname for known-private forms. Returns a reason if
 * blocked, null if it appears to be a public address.
 */
export function classifyOutboundHost(rawHost: string): string | null {
  // Node's URL.hostname preserves brackets around IPv6 (e.g. `[::1]`).
  // Strip them before classification so the IPv6 matchers see the bare
  // address. Single pass — host is lowercased after.
  const stripped = rawHost.startsWith("[") && rawHost.endsWith("]")
    ? rawHost.slice(1, -1)
    : rawHost;
  const host = stripped.toLowerCase();

  // String-literal private hosts (catches `localhost` directly).
  if (LITERAL_PRIVATE_HOSTS.has(host)) {
    return `private hostname literal (${host})`;
  }

  // mDNS / link-local resolution suffix.
  if (host.endsWith(".local")) {
    return "mDNS .local suffix (link-local discovery)";
  }

  // IPv4 literal.
  const ipv4 = parseIpv4(host);
  if (ipv4) {
    return classifyIpv4(ipv4);
  }

  // IPv6 literal — host has been de-bracketed above.
  if (host.includes(":")) {
    return classifyIpv6(host);
  }

  return null;
}

export type AssertSafeOutboundUrlOptions = {
  /** Schemes permitted. Default: ["https:"]. */
  allowedSchemes?: ReadonlyArray<"http:" | "https:">;
  /**
   * If set, the URL's hostname must match one of these (case-insensitive,
   * exact match — no subdomain wildcards). Default: no host restriction
   * (only the private-network and scheme checks apply).
   */
  allowedHosts?: ReadonlyArray<string>;
  /**
   * Block loopback, RFC1918, link-local, and metadata IPs. Default: true.
   * Operators who genuinely need to reach a private host (internal tooling,
   * dev mode) set this to false explicitly — never by accident.
   */
  blockPrivateNetworks?: boolean;
};

/**
 * Parse `input` as a URL and validate against the configured policy.
 * Throws on any failure with a message that names the specific rule
 * violated — operator-facing copy that explains the *why*, not just the
 * what.
 *
 * The return type is `URL` (not `string`) so the caller passes
 * `result.href` to `fetch`. This makes CodeQL's dataflow easier to
 * model as a sanitizer: the validated value has a distinct shape from
 * the raw input.
 */
export function assertSafeOutboundUrl(
  input: string,
  options: AssertSafeOutboundUrlOptions = {},
): URL {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("safe-fetch: URL must be a non-empty string");
  }
  if (/[\r\n]/.test(input)) {
    throw new Error("safe-fetch: URL must not contain newlines (header-injection vector)");
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`safe-fetch: not a parseable URL: ${input.slice(0, 200)}`);
  }

  const allowedSchemes = options.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES;
  if (!allowedSchemes.includes(url.protocol as "http:" | "https:")) {
    throw new Error(
      `safe-fetch: scheme "${url.protocol}" is not allowed. Allowed: ${allowedSchemes.join(", ")}`,
    );
  }

  if (options.allowedHosts !== undefined) {
    const lowerHost = url.hostname.toLowerCase();
    const allowed = options.allowedHosts.some((h) => h.toLowerCase() === lowerHost);
    if (!allowed) {
      throw new Error(
        `safe-fetch: host "${url.hostname}" is not on the allowlist. Allowed: ${
          options.allowedHosts.length ? options.allowedHosts.join(", ") : "(none)"
        }`,
      );
    }
  }

  // Default true — opt out is explicit.
  const blockPrivate = options.blockPrivateNetworks !== false;
  if (blockPrivate) {
    const reason = classifyOutboundHost(url.hostname);
    if (reason !== null) {
      throw new Error(
        `safe-fetch: host "${url.hostname}" is a private network address (${reason}). ` +
          `Outbound fetch to private/loopback/link-local hosts is blocked by default to prevent SSRF. ` +
          `If you genuinely need to reach this host, set blockPrivateNetworks: false in the call.`,
      );
    }
  }

  return url;
}
