// Minimal network-interface summary used at enrollment + heartbeat
// so the Authority's admin UI can show operators which host an Edge
// Node is on without forcing them to SQL-query the metadata blob.
//
// What this is NOT: a discovery collector. The discovery sweep
// already enumerates the same interfaces and emits them as
// observations (services/edge-node/src/collectors/host-info.ts).
// This is the small, attribution-level fingerprint that goes in
// EdgeNode.metadata.host so admin views, the verification runbook
// SQL, and the audit trail can identify the node by its address
// without parsing the full discovery payload.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
// Plan: docs/superpowers/plans/2026-05-12-edge-node-t2-multi-host-lan.md (T2.4)

import * as os from "node:os";

/**
 * Compact host fingerprint suitable for EdgeNode.metadata.host.
 *
 * Stays small (a few hundred bytes) so it's cheap to send every
 * heartbeat. The full network-interface table is in the discovery
 * sweep payload, not here.
 */
export type HostNetworkSummary = {
  /** Node's hostname per `os.hostname()`. */
  hostname: string;
  /**
   * Non-loopback, non-link-local IP addresses the host advertises on
   * its interfaces. Sorted: IPv4 first (most operators identify hosts
   * by their v4 address), then IPv6.
   *
   * "Real LAN-side IPs" per T2 § verification gate — explicitly NOT
   * 127.0.0.1, ::1, 169.254.*, or fe80::* link-local. Empty array
   * when the only interface is loopback (an Edge Node with no
   * external connectivity is suspicious, but we surface that to the
   * admin UI by showing "no LAN address" rather than crashing).
   */
  ipAddresses: string[];
};

/** Adapter for tests — replaces `os.hostname()` and `os.networkInterfaces()`. */
export type HostNetworkAdapter = {
  hostname: () => string;
  networkInterfaces: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;
};

const DEFAULT_ADAPTER: HostNetworkAdapter = {
  hostname: os.hostname,
  networkInterfaces: os.networkInterfaces,
};

/**
 * Decide whether an interface address counts as a "real LAN IP" for
 * the admin UI. Excludes loopback (127/8, ::1), link-local (169.254/16,
 * fe80::/10), and anything `os` marks as `internal: true`.
 *
 * Per-interface filtering happens here rather than at the SQL layer
 * so the metadata blob is small and ready-to-display.
 */
function isRealLanAddress(addr: os.NetworkInterfaceInfo): boolean {
  if (addr.internal) return false;
  // IPv4 link-local — autoconfigured when DHCP fails, never a routable LAN.
  if (addr.family === "IPv4" && addr.address.startsWith("169.254.")) return false;
  // IPv6 link-local — fe80::/10 prefix.
  if (
    addr.family === "IPv6" &&
    (addr.address.toLowerCase().startsWith("fe80:") ||
      addr.address.toLowerCase().startsWith("fe9") ||
      addr.address.toLowerCase().startsWith("fea") ||
      addr.address.toLowerCase().startsWith("feb"))
  ) {
    return false;
  }
  return true;
}

/**
 * Build the host-network summary for embedding in
 * EdgeNode.metadata.host. Sync; no I/O beyond `os` calls.
 */
export function collectHostNetworkSummary(
  adapter: HostNetworkAdapter = DEFAULT_ADAPTER,
): HostNetworkSummary {
  const ifaces = adapter.networkInterfaces();
  const ips: string[] = [];

  for (const addrs of Object.values(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (isRealLanAddress(addr)) {
        ips.push(addr.address);
      }
    }
  }

  // De-dupe + stable sort: IPv4 first, then IPv6, lexicographic within.
  // An interface bound to the same IP twice (e.g. `lo:0` aliases on
  // older Linux) shouldn't show up twice in the admin UI.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const ip of ips) {
    if (!seen.has(ip)) {
      seen.add(ip);
      deduped.push(ip);
    }
  }
  deduped.sort((a, b) => {
    const aV4 = !a.includes(":");
    const bV4 = !b.includes(":");
    if (aV4 !== bV4) return aV4 ? -1 : 1;
    return a.localeCompare(b);
  });

  return {
    hostname: adapter.hostname(),
    ipAddresses: deduped,
  };
}
