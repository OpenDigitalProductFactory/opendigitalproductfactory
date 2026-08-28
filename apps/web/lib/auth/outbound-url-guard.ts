// SSRF guard for outbound fetches whose URL comes from an untrusted caller.
//
// The MCP authorization server fetches a Client ID Metadata Document from a URL
// the CLIENT supplies as its `client_id` (SEP-991). That is a server-side
// request to an attacker-chosen address, which is textbook SSRF: without a
// guard, `client_id=https://127.0.0.1:9200/_all` or a cloud metadata endpoint
// turns the authorization endpoint into a probe for the operator's internal
// network. CodeQL flagged this as `js/request-forgery`, correctly.
//
// The guard is deny-by-default on address RANGE, not on string shape. Blocking
// the literal "localhost" is not enough: a hostname an attacker controls can
// resolve to 127.0.0.1, so the check has to happen against the RESOLVED
// addresses, and the resolved address is what the caller must then connect to.
//
// Residual risk stated honestly: this resolves and validates, then hands the
// original URL to fetch, which resolves again. A DNS entry that changes between
// the two lookups (DNS rebinding) can still slip through. Fully closing that
// requires pinning the connection to the validated IP, which Node's fetch does
// not expose. The remaining mitigations are a short timeout, `redirect: "error"`
// so a 302 cannot walk the request inward, and — the real one — CIMD fetching
// being opt-in rather than on by default (see oauth-policy.isCimdFetchEnabled).

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type OutboundUrlVerdict =
  | { allowed: true; url: URL; addresses: string[] }
  | { allowed: false; reason: string };

/** IPv4 ranges that must never be reachable from a caller-supplied URL. */
function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // unparseable: fail closed
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local — includes cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments / 192.0.2.0 TEST-NET
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** IPv6 equivalents, including IPv4-mapped forms that would otherwise sneak a
 *  blocked v4 address past a v6-shaped check. */
function isBlockedIpv6(ip: string): boolean {
  const v = ip.toLowerCase().split("%")[0]; // strip zone id
  if (v === "::" || v === "::1") return true; // unspecified, loopback
  if (v.startsWith("fe80")) return true; // link-local
  if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique-local
  if (v.startsWith("ff")) return true; // multicast
  // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compatible forms.
  const mapped = v.match(/(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedIpv4(ip);
  if (kind === 6) return isBlockedIpv6(ip);
  return true; // not an IP we can reason about: fail closed
}

/**
 * Validate a caller-supplied URL before fetching it.
 *
 * Requires https, refuses credentials in the URL, refuses non-default ports
 * (a metadata service on an odd port is a common target), and refuses any
 * hostname that resolves to a loopback, private, link-local or otherwise
 * reserved address.
 */
export async function verifyOutboundUrl(
  raw: string,
  options: { resolve?: (host: string) => Promise<string[]> } = {},
): Promise<OutboundUrlVerdict> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { allowed: false, reason: "not a valid URL" };
  }

  if (url.protocol !== "https:") {
    return { allowed: false, reason: "only https is permitted for an outbound document fetch" };
  }
  if (url.username || url.password) {
    return { allowed: false, reason: "credentials in the URL are not permitted" };
  }
  // A CIMD document is served from a normal web origin. Allowing an arbitrary
  // port widens the reachable surface to every internal service on the host.
  if (url.port && url.port !== "443") {
    return { allowed: false, reason: `non-default port ${url.port} is not permitted` };
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");

  // An IP literal never needs resolution — check it directly.
  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      return { allowed: false, reason: `address ${host} is in a blocked range` };
    }
    return { allowed: true, url, addresses: [host] };
  }

  let addresses: string[];
  try {
    const resolver =
      options.resolve ??
      (async (h: string) => (await lookup(h, { all: true })).map((r) => r.address));
    addresses = await resolver(host);
  } catch {
    return { allowed: false, reason: `could not resolve ${host}` };
  }

  if (addresses.length === 0) {
    return { allowed: false, reason: `${host} resolved to no addresses` };
  }
  // EVERY resolved address must be public: a hostname with one public and one
  // loopback record would otherwise be a coin-flip into the internal network.
  const blocked = addresses.find((a) => isBlockedAddress(a));
  if (blocked) {
    return { allowed: false, reason: `${host} resolves to blocked address ${blocked}` };
  }

  return { allowed: true, url, addresses };
}
