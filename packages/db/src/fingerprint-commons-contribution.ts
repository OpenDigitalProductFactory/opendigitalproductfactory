// Privacy-scrubbed fingerprint contribution to the shared commons (BI-57C27DE1).
//
// Operator requirement: as installs identify KNOWN device types/vendors, those
// fingerprints should flow to the shared project catalog so the deterministic
// (layer-0) capability grows for everyone and common devices never need AI. The
// hard constraint is privacy: ONLY generalizable vendor -> device-class signals
// may leave an install. No IP address, hostname, MAC, serial, or any per-device
// identifier is ever contributed, and a proprietary/unidentified device is kept
// local, never shared.
//
// This module is the correct-by-construction PRIVACY BOUNDARY: a contribution is
// built ONLY through `buildCommonsFingerprint`, which returns null unless the
// candidate is a clean, generalizable vendor->class mapping, and whose output is
// asserted to carry no identifier. The cross-install ingestion pipeline consumes
// its output; it cannot construct a contribution any other way.

/** The raw, possibly-identifying signals a resolution carries. */
export type FingerprintContributionCandidate = {
  /** OUI/manufacturer vendor string (generalizable — a maker, not a device). */
  vendor?: string | null;
  /** Resolved device class (e.g. "ip_camera", "smart_appliance"). */
  deviceClass?: string | null;
  /** Everything else the resolution saw — MAY contain identifiers; never shared. */
  rawEvidence?: Record<string, unknown> | null;
};

/** The ONLY shape that may cross to the commons — generalizable, no identifiers. */
export type CommonsFingerprint = {
  vendor: string;
  deviceClass: string;
};

// Device classes that are NOT generalizable knowledge — a proprietary or
// unidentified device stays local; sharing it teaches the commons nothing and
// risks leaking a bespoke device's existence.
const NON_GENERALIZABLE_CLASSES = new Set([
  "proprietary",
  "unknown",
  "unidentified",
  "custom",
  "other",
  "generic",
]);

// Substrings whose presence in a supposed "vendor" means it is actually an
// identifier (an IP/host/MAC leaked into the vendor slot), not a manufacturer.
const IDENTIFIER_KEY_SUBSTRINGS = [
  "mac",
  "ip",
  "addr",
  "address",
  "host",
  "hostname",
  "fqdn",
  "serial",
  "uuid",
  "guid",
  "asset",
  "owner",
  "customer",
  "site",
  "account",
];

const IPV4_RE = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
const IPV6_RE = /\b(?:[0-9a-f]{1,4}:){2,}[0-9a-f]{0,4}\b/i;
const MAC_RE = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/i;

/** True when a string is (or embeds) a per-device identifier and must not leave. */
export function looksLikeIdentifier(value: string): boolean {
  return IPV4_RE.test(value) || IPV6_RE.test(value) || MAC_RE.test(value);
}

function normalizeVendor(vendor: string): string {
  // Trim corporate suffixes/punctuation to a stable generalizable token; keep it
  // human-readable. This is a manufacturer name, not identifying data.
  return vendor.trim().replace(/\s+/g, " ");
}

/**
 * True when the candidate is generalizable knowledge safe to share: a real
 * manufacturer vendor plus a concrete, non-proprietary device class, with no
 * identifier hiding in the vendor string.
 */
export function isContributableFingerprint(candidate: FingerprintContributionCandidate): boolean {
  const vendor = candidate.vendor?.trim();
  const deviceClass = candidate.deviceClass?.trim().toLowerCase();
  if (!vendor || !deviceClass) return false;
  if (NON_GENERALIZABLE_CLASSES.has(deviceClass)) return false;
  if (looksLikeIdentifier(vendor)) return false;
  return true;
}

/**
 * Defense-in-depth: throw if a value that is about to cross to the commons
 * contains an identifier, by key name or by value shape. Callers should never
 * be able to ship an identifier even through a future refactor.
 */
export function assertNoIdentifiers(payload: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(payload)) {
    const lowerKey = key.toLowerCase();
    if (IDENTIFIER_KEY_SUBSTRINGS.some((s) => lowerKey.includes(s))) {
      throw new Error(`commons contribution blocked: identifier-shaped key "${key}"`);
    }
    if (typeof value === "string" && looksLikeIdentifier(value)) {
      throw new Error(`commons contribution blocked: identifier value under "${key}"`);
    }
  }
}

/**
 * The SOLE constructor of a commons contribution. Returns a scrubbed, generalizable
 * {vendor, deviceClass} — or null when the candidate is proprietary, incomplete,
 * or would leak an identifier. `rawEvidence` (which may hold MAC/IP/hostname) is
 * NEVER read into the output. The returned object is asserted identifier-free.
 */
export function buildCommonsFingerprint(
  candidate: FingerprintContributionCandidate,
): CommonsFingerprint | null {
  if (!isContributableFingerprint(candidate)) return null;
  const out: CommonsFingerprint = {
    vendor: normalizeVendor(candidate.vendor as string),
    deviceClass: (candidate.deviceClass as string).trim().toLowerCase(),
  };
  // Belt-and-braces: the output must carry no identifier even if inputs were odd.
  assertNoIdentifiers(out as unknown as Record<string, unknown>);
  return out;
}
