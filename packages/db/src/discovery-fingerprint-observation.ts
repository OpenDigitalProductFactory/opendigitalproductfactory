/**
 * Build a fingerprint observation from a discovered item's day-one signals
 * (spec §3c): the OUI vendor + locally-administered-MAC flag + hostname that
 * ARP + the embedded IEEE OUI library already emit today — no dependency on the
 * unbuilt edge-node detection engine (BI-9FE9D48D Slice 2).
 *
 * This is the shared contract between (a) the seed fingerprint rules, which
 * match against these normalizedEvidence paths, and (b) the discovery
 * normalizer, which calls this to produce an observation for matching. Keep the
 * field names stable — seed rules and the hive catalog reference them.
 *
 * Vendor/hostname strings are lower-cased so rule clauses can use case-stable
 * `contains` matches (the engine's regex comparator has no case-insensitive
 * flag). The OUI is upper-cased hex. classifyMac flags are carried through so a
 * rule (or the layer-1 coworker) can demand a corroborating signal for
 * randomized MACs / module vendors before resolving identity.
 */

import { classifyMac } from "./discovery-mac-classification";
import type { FingerprintRuleObservation } from "./discovery-fingerprint-rules";

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  return null;
}

function firstString(attrs: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = str(attrs[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

export type DeviceSignalInput = {
  /** The discovered item's display name (often the hostname or "Vendor IP"). */
  name?: string | null;
  /** Raw attributes off the discovered item (ARP/UniFi rawData). */
  attributes?: Record<string, unknown> | null;
};

/**
 * Produce a FingerprintRuleObservation, or null when there is no usable
 * day-one signal (no vendor, no OUI, no MAC, no hostname) to match on.
 */
export function buildDeviceFingerprintObservation(
  input: DeviceSignalInput,
): FingerprintRuleObservation | null {
  const attrs = input.attributes ?? {};
  const vendor = firstString(attrs, ["vendor", "manufacturer", "oui_vendor"]);
  const vendorShort = firstString(attrs, ["vendorShort", "vendor_short"]);
  const mac = firstString(attrs, ["mac", "macAddress", "mac_address"]);
  const ouiRaw = firstString(attrs, ["vendorOui", "oui"]);
  const hostname = firstString(attrs, ["hostname"]) ?? str(input.name);
  const observedName = firstString(attrs, ["operatorName", "displayName", "deviceName", "name"]) ?? str(input.name);

  const macInfo = classifyMac(mac, vendor ?? vendorShort);
  const oui = ouiRaw ? ouiRaw.replace(/[^0-9a-fA-F]/g, "").toUpperCase().slice(0, 6) : macInfo.oui;

  const evidenceFamilies: string[] = [];
  if (vendor || vendorShort || oui) {
    evidenceFamilies.push("mac_oui");
  }
  if (hostname) {
    evidenceFamilies.push("hostname");
  }
  if (observedName) {
    evidenceFamilies.push("observed_name");
  }

  if (evidenceFamilies.length === 0) {
    return null;
  }

  return {
    evidenceFamilies,
    normalizedEvidence: {
      vendor: vendor ? vendor.toLowerCase() : null,
      vendorShort: vendorShort ? vendorShort.toLowerCase() : null,
      oui,
      mac: macInfo.normalized,
      hostname: hostname ? hostname.toLowerCase() : null,
      observedName: observedName ? observedName.toLowerCase() : null,
      // MAC-classification flags — let a rule require a corroborating signal
      // before trusting the OUI on randomized MACs / module vendors.
      locallyAdministered: macInfo.locallyAdministered,
      randomized: macInfo.randomized,
      moduleVendor: macInfo.moduleVendor,
      vendorRole: macInfo.vendorRole,
      resolvableByOui: macInfo.resolvableByOui,
    },
  };
}
