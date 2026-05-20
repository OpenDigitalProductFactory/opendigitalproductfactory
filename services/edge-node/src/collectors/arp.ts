// ARP-neighbor collector for the Edge Node's discovery.network capability.
//
// Reads the kernel's ARP cache (the host's record of L2 neighbors it has
// recently talked to) and emits one observation per resolved IP/MAC pair.
// This is the smallest, lowest-risk discovery collector — it does NOT
// generate any network traffic; it just reads what the host already
// knows. No raw sockets, no scanning, no extra Linux capabilities.
//
// Active scanning (nmap -sn subnet sweep, ICMP probes, arp-scan request
// frames) lands in the C2 follow-up. SNMP polling of network devices is
// C3. This file is C1 — passive read of the existing cache.
//
// Aligns with the server-side portal collectors at
// packages/db/src/discovery-collectors/arp-scan.ts so the Authority's
// normalization dedupes observations from both sources cleanly:
//
//   observedKey:  "arp:<ip>"    (IP-keyed; matches existing taxonomy)
//   itemType:     "host"
//   rawData.osiLayer:        3
//   rawData.osiLayerName:    "network"
//   rawData.discoveredVia:   "arp_table"   (vs "arp_scan" for the
//                                           active C2 collector)
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
//   § Edge Node capability envelope — capability.discovery.network

import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import * as os from "node:os";

import { lookupOui, shortVendor } from "../lib/mac-oui";
import type { ObservationItem } from "./host-info";

/**
 * One row from the ARP cache. Internal type; the collector flattens
 * this into ObservationItem on output.
 */
export type ArpEntry = {
  /** IPv4 address of the neighbor. */
  ip: string;
  /** MAC address in lower-case colon-separated form. */
  mac: string;
  /** Interface name (e.g. "eth0", "en0"). */
  iface: string;
};

/**
 * Output of an ARP-cache read attempt. `entries` is empty when the
 * cache has no resolved neighbors (legitimate state on a freshly
 * booted host that hasn't talked to anyone yet); `warnings` carries
 * non-fatal messages we want surfaced to the Authority.
 */
export type ArpCacheReadResult = {
  entries: ArpEntry[];
  warnings: string[];
};

/**
 * Adapter for tests — replaces filesystem + subprocess calls.
 *
 * On Linux we read /proc/net/arp; on macOS we shell out to `arp -an`
 * because there is no equivalent procfs surface. Both are abstracted
 * through this single adapter so tests don't depend on either.
 */
export type ArpAdapter = {
  platform: () => NodeJS.Platform;
  /** Read /proc/net/arp on Linux. Returns the raw file contents. */
  readProcNetArp: () => Promise<string>;
  /**
   * Run `arp -an` (or compatible) on macOS / fallback. Synchronous
   * because the underlying binary is fast (<10ms typical) and the
   * collector pattern is already sync-style. Returns stdout text.
   * Throws on non-zero exit; caller catches + records a warning.
   */
  execArpDashAn: () => string;
};

const DEFAULT_ADAPTER: ArpAdapter = {
  platform: os.platform,
  readProcNetArp: () => fs.readFile("/proc/net/arp", "utf8"),
  execArpDashAn: () =>
    execFileSync("arp", ["-an"], {
      encoding: "utf8",
      // Cap output so a runaway arp binary can't blow the agent up.
      maxBuffer: 1024 * 1024,
      // 5s is generous for an ARP-cache dump.
      timeout: 5_000,
    }),
};

// MACs we explicitly ignore. The all-zeros MAC means "ARP request
// outstanding but never resolved" (Flags=0x0 in /proc/net/arp); the
// all-FFs MAC is L2 broadcast which the kernel may show as a learned
// neighbor depending on the device driver but is never useful as an
// inventory item.
const SKIP_MACS = new Set(["00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff"]);

/**
 * Parse Linux /proc/net/arp contents.
 *
 * Format:
 *   IP address       HW type     Flags     HW address            Mask     Device
 *   192.168.1.1      0x1         0x2       aa:bb:cc:dd:ee:ff     *        eth0
 *   10.0.0.5         0x1         0x0       00:00:00:00:00:00     *        eth0
 *
 * Flags is a bitfield: 0x2 = ATF_COM (complete entry). Entries with
 * Flags=0x0 mean "ARP request outstanding"; we skip those because the
 * IP/MAC binding hasn't been confirmed.
 */
export function parseProcNetArp(content: string): ArpEntry[] {
  const entries: ArpEntry[] = [];
  const lines = content.split(/\r?\n/);
  // First line is the header; skip.
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "") continue;
    // Whitespace-split; tolerate variable spacing.
    const fields = line.split(/\s+/);
    if (fields.length < 6) continue;
    const ip = fields[0]!;
    const flags = fields[2]!;
    const mac = fields[3]!.toLowerCase();
    const iface = fields[5]!;
    // ATF_COM bit must be set for the entry to be considered valid.
    // parseInt handles the "0x2" prefix.
    const flagBits = Number.parseInt(flags, 16);
    if (!Number.isFinite(flagBits)) continue;
    if ((flagBits & 0x2) !== 0x2) continue;
    if (SKIP_MACS.has(mac)) continue;
    if (!isLikelyIpv4(ip) || !isLikelyMac(mac)) continue;
    entries.push({ ip, mac, iface });
  }
  return dedupeByIp(entries);
}

/**
 * Parse macOS `arp -an` output.
 *
 * Format:
 *   ? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]
 *   ? (192.168.1.20) at (incomplete) on en0 ifscope [ethernet]
 *
 * The "(incomplete)" form replaces the MAC when the resolution failed.
 * We skip those just like the Linux ATF_COM filter.
 *
 * macOS also pads MAC bytes (e.g. "a:b:c:d:e:f" instead of "0a:0b:..."
 * sometimes), so we normalize.
 */
export function parseArpDashAn(content: string): ArpEntry[] {
  const entries: ArpEntry[] = [];
  // RE captures: (1) IP, (2) MAC or "(incomplete)", (3) interface.
  const re =
    /\(([\d.]+)\)\s+at\s+([0-9a-fA-F:]+|\(incomplete\))\s+on\s+(\S+)/g;
  for (const m of content.matchAll(re)) {
    const ip = m[1]!;
    const macRaw = m[2]!;
    const iface = m[3]!;
    if (macRaw === "(incomplete)") continue;
    const mac = normalizeMac(macRaw);
    if (SKIP_MACS.has(mac)) continue;
    if (!isLikelyIpv4(ip) || !isLikelyMac(mac)) continue;
    entries.push({ ip, mac, iface });
  }
  return dedupeByIp(entries);
}

function isLikelyIpv4(s: string): boolean {
  const parts = s.split(".");
  if (parts.length !== 4) return false;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return false;
  }
  return true;
}

function isLikelyMac(s: string): boolean {
  return /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(s);
}

/**
 * Normalize MACs to lower-case, zero-padded, colon-separated. macOS
 * `arp -an` may emit single-hex-digit bytes ("a:b:c:..."); the rest of
 * the pipeline (and the existing portal collectors) expect the
 * canonical two-digit form.
 */
function normalizeMac(raw: string): string {
  return raw
    .toLowerCase()
    .split(":")
    .map((b) => (b.length === 1 ? `0${b}` : b))
    .join(":");
}

/**
 * Drop duplicate IPs. ARP caches can in theory list the same IP twice
 * (rare, e.g. across interfaces with proxy-ARP). Keep the first
 * occurrence — stable behavior across sweeps beats "newest wins".
 */
function dedupeByIp(entries: ArpEntry[]): ArpEntry[] {
  const seen = new Set<string>();
  const out: ArpEntry[] = [];
  for (const e of entries) {
    if (seen.has(e.ip)) continue;
    seen.add(e.ip);
    out.push(e);
  }
  return out;
}

/**
 * Read the ARP cache from the current host. Per-platform dispatch.
 * Errors are caught and returned as warnings rather than thrown —
 * the discovery sweep should never crash because one collector
 * tripped on a permission boundary or a missing file.
 */
export async function readArpCache(
  adapter: ArpAdapter = DEFAULT_ADAPTER,
): Promise<ArpCacheReadResult> {
  const platform = adapter.platform();
  if (platform === "linux") {
    try {
      const content = await adapter.readProcNetArp();
      return { entries: parseProcNetArp(content), warnings: [] };
    } catch (err) {
      return {
        entries: [],
        warnings: [
          `arp: /proc/net/arp read failed: ${(err as Error).message}`,
        ],
      };
    }
  }
  if (platform === "darwin") {
    try {
      const content = adapter.execArpDashAn();
      return { entries: parseArpDashAn(content), warnings: [] };
    } catch (err) {
      return {
        entries: [],
        warnings: [
          `arp: 'arp -an' failed: ${(err as Error).message}`,
        ],
      };
    }
  }
  // Phase 0 supports only darwin + linux native. win32 is the future
  // T3 native binary; until then this collector is a no-op there with
  // a warning so the operator sees we noticed the platform.
  return {
    entries: [],
    warnings: [
      `arp: collector skipped on platform=${platform} (Phase 0 supports linux + darwin only)`,
    ],
  };
}

/**
 * Build the items + relationships for the discovery-run envelope.
 *
 * Items: one per ARP entry, keyed `arp:<ip>` to match the server-side
 * portal collectors at packages/db/src/discovery-collectors/arp-scan.ts.
 * The Authority's normalization dedupes against rows from those
 * collectors when they emit the same key, so the inventory graph
 * stays consistent regardless of which agent reported the host.
 *
 * Relationships: empty for C1. Relationship emission requires
 * authoritative subnet context (which CIDR each neighbor belongs to),
 * which we get cleanly in the C2 active-sweep collector. Emitting
 * speculative subnet relationships from a passive cache read would
 * introduce attribution drift if the local NIC's primary subnet
 * doesn't match the neighbor's actual network.
 *
 * @param adapter — defaults to the real platform adapter; tests
 *                  override.
 */
export async function collectArpNeighbors(
  adapter: ArpAdapter = DEFAULT_ADAPTER,
): Promise<{
  items: ObservationItem[];
  relationships: never[];
  warnings: string[];
}> {
  const { entries, warnings } = await readArpCache(adapter);

  const items: ObservationItem[] = entries.map((entry) => {
    // Stamp the IEEE-registered manufacturer on every ARP item. This
    // is what turns lines like "LAN Host 192.168.0.42" into something
    // an operator can actually read — "Amazon Technologies Inc.",
    // "Reolink Innovation Limited", etc. The lookup is local-only;
    // no DNS, no HTTP, nothing leaves the host.
    const oui = lookupOui(entry.mac);
    const displayName = oui
      ? `${shortVendor(oui.vendor)} ${entry.ip}`
      : `LAN Host ${entry.ip}`;
    return {
      observedKey: `arp:${entry.ip}`,
      itemType: "host",
      name: displayName,
      // Confidence matches the server-side arp-scan collector (0.70):
      // ARP cache is a reasonable but not authoritative signal — it
      // tells us the kernel resolved the IP recently, not that the
      // host is currently up. nmap/SNMP active checks raise confidence
      // when they confirm in C2/C3.
      confidence: 0.7,
      rawData: {
        address: entry.ip,
        mac: entry.mac,
        iface: entry.iface,
        osiLayer: 3,
        osiLayerName: "network",
        protocolFamily: "ipv4",
        discoveredVia: "arp_table",
        ...(oui
          ? {
              vendor: oui.vendor,
              vendorOui: oui.oui,
              vendorShort: shortVendor(oui.vendor),
            }
          : {}),
      },
    };
  });

  return { items, relationships: [], warnings };
}
