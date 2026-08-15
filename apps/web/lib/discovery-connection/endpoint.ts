export type DiscoveryCollectorType = "unifi" | "snmp" | "arp_scan";

export type DiscoveryEndpointResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

const HOST_ERROR = "Enter a valid IP address or hostname, for example 192.168.0.1.";
const SUBNET_ERROR = "Enter a subnet in CIDR notation, for example 192.168.0.0/24.";
const UNIFI_ERROR = "Enter the gateway host or IP address, for example 192.168.0.1.";

function containsControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isIpv4Octet(value: string): boolean {
  if (value.length === 0 || value.length > 3) return false;
  for (const char of value) {
    if (char < "0" || char > "9") return false;
  }
  const number = Number(value);
  return number >= 0 && number <= 255;
}

export function isIpv4Address(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every(isIpv4Octet);
}

export function isIpv4Cidr(value: string): boolean {
  const [ip, prefix, extra] = value.split("/");
  if (!ip || !prefix || extra !== undefined || !isIpv4Address(ip)) return false;
  const number = Number(prefix);
  return Number.isInteger(number) && number >= 16 && number <= 32;
}

function canonicalizeIpv4Cidr(value: string): string {
  const [ip, prefixText] = value.split("/");
  const prefix = Number(prefixText);
  const address = ip.split(".").reduce((result, octet) => (
    ((result << 8) | Number(octet)) >>> 0
  ), 0);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (address & mask) >>> 0;
  const octets = [24, 16, 8, 0].map((shift) => (network >>> shift) & 0xff);
  return `${octets.join(".")}/${prefix}`;
}

function isUnsafeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "0.0.0.0" || host === "255.255.255.255" || host === "169.254.169.254") {
    return true;
  }
  if (host === "::" || host === "[::]" || host === "::1" || host === "[::1]") return true;
  if (host.includes(":")) {
    const unbracketed = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
    return !(unbracketed.startsWith("fc") || unbracketed.startsWith("fd") || unbracketed.startsWith("fe80:"));
  }
  if (isIpv4Address(host)) {
    const [first, second] = host.split(".").map(Number);
    const isPrivate = first === 10
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168);
    return !isPrivate;
  }

  // Manual recovery is intentionally LAN-only. Single-label mDNS/DNS names
  // and standardized local suffixes stay usable; public FQDNs do not become
  // arbitrary server-side probe targets.
  return host.includes(".")
    && !host.endsWith(".local")
    && !host.endsWith(".lan")
    && !host.endsWith(".home.arpa");
}

function normalizeHttpEndpoint(raw: string): DiscoveryEndpointResult {
  const trimmed = raw.trim();
  if (!trimmed || containsControlCharacter(trimmed)) return { ok: false, error: UNIFI_ERROR };

  const hasScheme = trimmed.includes("://");
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: UNIFI_ERROR };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Use an HTTP or HTTPS gateway address." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "Do not include a username or password in the gateway address." };
  }
  if (!parsed.hostname || isUnsafeHost(parsed.hostname)) {
    return { ok: false, error: "That address cannot be used as a gateway target." };
  }
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    return { ok: false, error: "Enter only the gateway host and optional port, without a page path." };
  }

  parsed.protocol = "https:";
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return { ok: true, value: parsed.href.endsWith("/") ? parsed.href.slice(0, -1) : parsed.href };
}

function normalizeHost(raw: string): DiscoveryEndpointResult {
  const trimmed = raw.trim();
  if (!trimmed || containsControlCharacter(trimmed)) return { ok: false, error: HOST_ERROR };

  let parsed: URL;
  try {
    parsed = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
  } catch {
    return { ok: false, error: HOST_ERROR };
  }
  if (!parsed.hostname || parsed.username || parsed.password || isUnsafeHost(parsed.hostname)) {
    return { ok: false, error: HOST_ERROR };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: HOST_ERROR };
  }

  return {
    ok: true,
    value: parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname,
  };
}

export function normalizeDiscoveryEndpoint(
  raw: string,
  collectorType: DiscoveryCollectorType,
): DiscoveryEndpointResult {
  if (collectorType === "unifi") return normalizeHttpEndpoint(raw);
  if (collectorType === "snmp") return normalizeHost(raw);

  const value = raw.trim();
  if (!isIpv4Cidr(value)) return { ok: false, error: SUBNET_ERROR };
  const [network] = value.split("/");
  if (isUnsafeHost(network)) {
    return {
      ok: false,
      error: "Enter a private-network subnet in CIDR notation, for example 192.168.0.0/24.",
    };
  }
  return { ok: true, value: canonicalizeIpv4Cidr(value) };
}

function toIpv4Subnet(address: string): string | null {
  const hostResult = normalizeHost(address);
  if (!hostResult.ok) return null;
  const host = hostResult.value.split(":")[0];
  if (!isIpv4Address(host)) return null;
  const parts = host.split(".");
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

export function endpointForCollector(
  collectorType: DiscoveryCollectorType,
  address: string,
): string | null {
  if (collectorType === "arp_scan") return toIpv4Subnet(address);
  const result = normalizeDiscoveryEndpoint(address, collectorType);
  return result.ok ? result.value : null;
}

export function discoveryConnectionKey(
  collectorType: DiscoveryCollectorType,
  endpoint: string,
): string {
  const withoutScheme = endpoint.startsWith("https://")
    ? endpoint.slice(8)
    : endpoint.startsWith("http://")
      ? endpoint.slice(7)
      : endpoint;
  return `${collectorType}:${withoutScheme}`;
}
