/**
 * MAC-address classification for discovery fingerprinting.
 *
 * OUI → vendor lookup (services/edge-node-go/internal/oui, surfaced on the ARP
 * observation as `vendor`/`vendorOui`) tells you the *registered* owner of a
 * MAC's first 24 bits. That is necessary but NOT sufficient to identify a
 * device, for two reasons the field has long known (spec §2, §5.2):
 *
 *  1. **Locally-administered / randomized MACs.** IEEE 802 reserves the
 *     second-least-significant bit of the first octet (the U/L bit, 0x02) to
 *     mean "locally administered." Privacy features (iOS/Android MAC
 *     randomization, RFC 7844 DHCP anonymity profiles) set it, so the OUI is
 *     synthetic — it identifies nobody. Such a MAC cannot be resolved by OUI
 *     alone and needs a corroborating non-OUI signal.
 *
 *  2. **Module / OEM-radio vendors.** Many finished devices embed a Wi-Fi/BLE
 *     module whose MAC carries the *module maker's* OUI (Espressif, Sichuan
 *     AI-Link, FN-Link), not the device brand's. "Espressif" is the chip, not
 *     the product — vendor ≠ device. These also need corroboration.
 *
 * This helper flags both so the rule evaluator (and the layer-1 coworker
 * investigation) can demand a second signal before resolving identity, instead
 * of trusting the OUI blindly.
 *
 * Pure, dependency-free, offline (spec §10) — no DB, no network.
 */

export type MacVendorRole = "device" | "module" | "unknown";

export type MacClassification = {
  /** Canonical 12-hex upper-case form, or null when the input is not a valid MAC. */
  normalized: string | null;
  /** First 6 hex (the OUI), or null when invalid. */
  oui: string | null;
  /** U/L bit set → locally administered (randomized / private / virtual). */
  locallyAdministered: boolean;
  /** I/G bit set → multicast/broadcast address (not an individual NIC). */
  multicast: boolean;
  /**
   * A privacy/randomized individual address: locally administered AND unicast.
   * The strongest "OUI is meaningless here" signal.
   */
  randomized: boolean;
  /** The matched module/OEM-radio vendor name, when the vendor is a known module maker. */
  moduleVendor: string | null;
  /** device = trustworthy brand OUI; module = OEM radio; unknown = can't say. */
  vendorRole: MacVendorRole;
  /**
   * False when OUI alone cannot resolve the device — i.e. the MAC is locally
   * administered, or its vendor is a module maker. A fingerprint rule should
   * require a corroborating non-OUI signal in these cases.
   */
  resolvableByOui: boolean;
};

/**
 * Known module / OEM-radio vendors whose OUI names a component, not the finished
 * device. Matched case-insensitively as a substring of the resolved vendor name.
 * Extend as the hive surfaces more (the layer-1 coworker can propose additions).
 */
const MODULE_VENDOR_PATTERNS: readonly { label: string; test: RegExp }[] = [
  { label: "Espressif", test: /espressif/i },
  { label: "LG Innotek", test: /lg[\s-]?innotek/i },
  { label: "Sichuan AI-Link", test: /ai[\s-]?link|sichuan/i },
  { label: "FN-Link", test: /fn[\s-]?link/i },
  { label: "Tuya", test: /\btuya\b/i },
];

export function normalizeMac(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const hex = raw.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length !== 12) {
    return null;
  }
  return hex;
}

/** The known module-vendor label for a vendor string, or null. */
export function matchModuleVendor(vendor: string | null | undefined): string | null {
  if (!vendor) {
    return null;
  }
  const match = MODULE_VENDOR_PATTERNS.find((entry) => entry.test.test(vendor));
  return match ? match.label : null;
}

export function classifyMac(mac: string | null | undefined, vendor?: string | null): MacClassification {
  const normalized = normalizeMac(mac);
  if (normalized === null) {
    return {
      normalized: null,
      oui: null,
      locallyAdministered: false,
      multicast: false,
      randomized: false,
      moduleVendor: matchModuleVendor(vendor),
      vendorRole: matchModuleVendor(vendor) ? "module" : "unknown",
      resolvableByOui: false,
    };
  }

  const firstOctet = parseInt(normalized.slice(0, 2), 16);
  const locallyAdministered = (firstOctet & 0x02) === 0x02;
  const multicast = (firstOctet & 0x01) === 0x01;
  const randomized = locallyAdministered && !multicast;
  const moduleVendor = matchModuleVendor(vendor);

  let vendorRole: MacVendorRole;
  if (moduleVendor) {
    vendorRole = "module";
  } else if (vendor && !locallyAdministered) {
    vendorRole = "device";
  } else {
    vendorRole = "unknown";
  }

  const resolvableByOui = !locallyAdministered && moduleVendor === null && Boolean(vendor);

  return {
    normalized,
    oui: normalized.slice(0, 6),
    locallyAdministered,
    multicast,
    randomized,
    moduleVendor,
    vendorRole,
    resolvableByOui,
  };
}
