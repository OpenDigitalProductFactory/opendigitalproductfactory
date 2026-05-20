// MAC OUI → vendor lookup.
//
// Every Ethernet MAC's first 24 bits identify the manufacturer via the
// IEEE-assigned OUI registry. With that mapping we can stamp a vendor
// label on every ARP-discovered device — turning anonymous lines like
// "LAN Host 192.168.0.42 (mac 00:1d:c0:de:fa:ce)" into "Reolink
// Innovation Limited" or "Amazon Technologies Inc." — without sending
// anything off-host.
//
// The full registry has ~39k entries (~1.2 MB compact TSV). We ship
// the whole thing rather than curate a subset, because a curated list
// would silently miss devices in operator environments we didn't
// anticipate.
//
// Data file: services/edge-node/data/oui.tsv
//   Format:  <6-hex-no-separator>\t<vendor name>\n
//   Source:  https://standards-oui.ieee.org/oui/oui.txt
//   Update:  scripts/build-oui-dataset.sh re-fetches + reformats.
//
// Load semantics: lazy, on first lookup. ~50 ms one-shot cost on the
// first ARP entry of the first sweep; subsequent lookups are O(1).
// Edge node startup stays fast.

import { readFileSync } from "node:fs";
import * as path from "node:path";

export type OuiEntry = {
  /** 6-hex-char OUI prefix (upper-case, no separators). */
  oui: string;
  /** Manufacturer name as registered with IEEE. */
  vendor: string;
};

/** Adapter for tests — replaces the FS read + path resolution. */
export type MacOuiAdapter = {
  readTsv: () => string;
};

const DEFAULT_DATA_PATH = path.resolve(__dirname, "..", "..", "data", "oui.tsv");

const DEFAULT_ADAPTER: MacOuiAdapter = {
  // Try the bundled location first; fall back to undefined so the
  // module gracefully returns null lookups when the data file is
  // missing (e.g. in older images that haven't picked up the COPY
  // change yet). Callers see "vendor unknown" rather than crashes.
  readTsv: () => {
    try {
      return readFileSync(DEFAULT_DATA_PATH, "utf8");
    } catch {
      return "";
    }
  },
};

let cache: Map<string, string> | null = null;
let lastAdapter: MacOuiAdapter | null = null;

/**
 * Normalize any reasonable MAC representation to the canonical
 * upper-case 12-hex-no-separator form: "aa:bb:cc:dd:ee:ff",
 * "aa-bb-cc-dd-ee-ff", "AABB.CCDD.EEFF", and "AABBCCDDEEFF" all map to
 * "AABBCCDDEEFF". Returns null on anything that doesn't look like a
 * MAC — we never try to recover from garbage.
 */
export function normalizeMac(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[\s:.\-]/g, "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(cleaned)) return null;
  return cleaned;
}

/** Reset the cached map. Test seam — production never calls this. */
export function _resetMacOuiCache(): void {
  cache = null;
  lastAdapter = null;
}

function ensureCache(adapter: MacOuiAdapter): Map<string, string> {
  if (cache && lastAdapter === adapter) return cache;
  const next = new Map<string, string>();
  const tsv = adapter.readTsv();
  if (tsv.length > 0) {
    // Parse line-by-line. Comments + blank lines are tolerated so the
    // generator script can prepend a "# Last updated YYYY-MM-DD" header
    // without breaking anything.
    const lines = tsv.split(/\r?\n/);
    for (const line of lines) {
      if (line.length === 0 || line.startsWith("#")) continue;
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      const oui = line.slice(0, tab).toUpperCase();
      if (!/^[0-9A-F]{6}$/.test(oui)) continue;
      const vendor = line.slice(tab + 1).trim();
      if (vendor.length === 0) continue;
      next.set(oui, vendor);
    }
  }
  cache = next;
  lastAdapter = adapter;
  return next;
}

/**
 * Look up the manufacturer for a MAC address. Returns null if the
 * MAC can't be parsed or the OUI isn't in the dataset.
 *
 * `mac` may be in any common separator form; case-insensitive.
 */
export function lookupOui(
  mac: string,
  adapter: MacOuiAdapter = DEFAULT_ADAPTER,
): OuiEntry | null {
  const normalized = normalizeMac(mac);
  if (!normalized) return null;
  const oui = normalized.slice(0, 6);
  const map = ensureCache(adapter);
  const vendor = map.get(oui);
  if (!vendor) return null;
  return { oui, vendor };
}

/**
 * Best-effort shortened vendor for display ("Apple, Inc." → "Apple",
 * "Amazon Technologies Inc." → "Amazon"). Strictly cosmetic; if a
 * caller needs the authoritative registered name they should read
 * `OuiEntry.vendor` directly.
 */
export function shortVendor(vendor: string): string {
  // Strip the legal-entity suffix block plus any trailing punctuation.
  // Matched from the end so we don't accidentally chop a brand name
  // that happens to contain "Inc" in the middle. Built-in patterns
  // cover the IEEE registry's common forms: "Apple, Inc.", "Foo Co.,
  // Ltd.", "Amazon Technologies Inc.", "HUAWEI TECHNOLOGIES CO.,LTD".
  const suffixPattern =
    /[\s,]*(?:Technologies|Innovation|TECHNOLOGIES)?[\s,]*(?:Inc\.?|LLC\.?|Ltd\.?|Limited|Corp(?:oration)?\.?|Co\.?,?\s*Ltd\.?|GmbH|S\.?A\.?|N\.?V\.?)[\s.,]*$/i;
  let out = vendor;
  // Apply twice so "Amazon Technologies Inc." also drops "Technologies".
  out = out.replace(suffixPattern, "");
  out = out.replace(suffixPattern, "");
  return out.replace(/[\s.,]+$/g, "").replace(/\s{2,}/g, " ").trim();
}
