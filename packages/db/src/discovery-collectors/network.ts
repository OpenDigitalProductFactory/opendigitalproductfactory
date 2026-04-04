import os from "node:os";
import { spawnSync } from "node:child_process";

import type { CollectorContext, CollectorOutput } from "../discovery-types";

// ─── Dependency Injection Types ────────────────────────────────────────────

export type NetworkDeps = {
  networkInterfaces: typeof os.networkInterfaces;
  execCommand: (cmd: string, args: string[]) => string;
  fetchFn: typeof fetch;
  prometheusUrl: string;
};

function defaultExecCommand(cmd: string, args: string[]): string {
  const result = spawnSync(cmd, args, { encoding: "utf8", timeout: 5_000 });
  return result.status === 0 ? result.stdout : "";
}

const defaultDeps: NetworkDeps = {
  networkInterfaces: os.networkInterfaces,
  execCommand: defaultExecCommand,
  fetchFn: globalThis.fetch,
  prometheusUrl: process.env.PROMETHEUS_URL ?? "http://prometheus:9090",
};

// ─── IPv4 Helpers ──────────────────────────────────────────────────────────

function ipToNumber(ip: string): number {
  return ip.split(".").reduce((n, octet) => (n << 8) | Number(octet), 0) >>> 0;
}

function cidrFromNetmask(netmask: string): number {
  return netmask
    .split(".")
    .reduce(
      (bits, octet) =>
        bits + (Number(octet) >>> 0).toString(2).replace(/0/g, "").length,
      0,
    );
}

function subnetAddress(address: string, netmask: string): string {
  const addrParts = address.split(".").map(Number);
  const maskParts = netmask.split(".").map(Number);
  return addrParts.map((a, i) => a & maskParts[i]).join(".");
}

export function isInSubnet(ip: string, network: string, cidr: number): boolean {
  const ipNum = ipToNumber(ip);
  const netNum = ipToNumber(network);
  const mask = cidr === 0 ? 0 : ((0xffffffff << (32 - cidr)) >>> 0);
  return (ipNum & mask) === (netNum & mask);
}

// ─── Gateway Discovery ─────────────────────────────────────────────────────

export function discoverGateway(deps: NetworkDeps): string | null {
  let output = deps.execCommand("ip", ["route"]);
  if (output) {
    const match = output.match(/default via (\d+\.\d+\.\d+\.\d+)/);
    if (match) return match[1];
  }
  output = deps.execCommand("route", ["print", "0.0.0.0"]);
  if (output) {
    const match = output.match(/0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)/);
    if (match) return match[1];
  }
  output = deps.execCommand("netstat", ["-rn"]);
  if (output) {
    const match = output.match(/default\s+(\d+\.\d+\.\d+\.\d+)/);
    if (match) return match[1];
  }
  return null;
}

// ─── ARP Neighbor Discovery ────────────────────────────────────────────────

type ArpNeighbor = { ip: string; mac: string };

export function discoverArpNeighbors(deps: NetworkDeps): ArpNeighbor[] {
  let output = deps.execCommand("ip", ["neigh"]);
  if (output) {
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+.*lladdr\s+([\da-fA-F:]+)/);
        return match ? { ip: match[1], mac: match[2] } : null;
      })
      .filter((n): n is ArpNeighbor => n != null);
  }
  output = deps.execCommand("arp", ["-a"]);
  if (output) {
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([\da-fA-F:-]+)/);
        return match ? { ip: match[1], mac: match[2].replace(/-/g, ":") } : null;
      })
      .filter((n): n is ArpNeighbor => n != null)
      .filter((n) => n.mac !== "ff:ff:ff:ff:ff:ff");
  }
  return [];
}

// ─── Prometheus Host Network Discovery ─────────────────────────────────────
// Queries node-exporter metrics via Prometheus to discover the REAL host
// network interfaces, not the container's. node-exporter runs on the host
// network (network_mode: host) so it sees physical/VM interfaces.

type PromHostInterface = {
  device: string;
  address?: string;
  operstate: string;
  mac?: string;
  speed?: number;
  source?: "windows_exporter" | "node_exporter";
};

async function discoverHostInterfacesFromPrometheus(
  deps: NetworkDeps,
): Promise<PromHostInterface[]> {
  // Try windows_exporter first (real Windows host interfaces)
  const windowsInterfaces = await queryWindowsNetInterfaces(deps);
  if (windowsInterfaces.length > 0) return windowsInterfaces;

  // Fall back to node_exporter (Linux host or WSL2 VM)
  return queryNodeExporterInterfaces(deps);
}

/** Query windows_exporter's windows_net_bytes_total for real Windows NICs. */
async function queryWindowsNetInterfaces(
  deps: NetworkDeps,
): Promise<PromHostInterface[]> {
  try {
    const res = await deps.fetchFn(
      `${deps.prometheusUrl}/api/v1/query?query=windows_net_bytes_total`,
      { signal: AbortSignal.timeout(3_000) },
    );
    if (!res.ok) return [];

    const json = await res.json() as {
      data?: {
        result?: Array<{
          metric: { nic?: string; instance?: string };
          value: [number, string];
        }>;
      };
    };

    const results = json.data?.result ?? [];
    if (results.length === 0) return [];

    // Deduplicate by NIC name
    const seen = new Set<string>();
    const ifaces: PromHostInterface[] = [];
    for (const r of results) {
      const nic = r.metric.nic;
      if (!nic || seen.has(nic)) continue;
      if (isWindowsVirtualInterface(nic)) continue;
      seen.add(nic);
      ifaces.push({
        device: nic,
        operstate: "up",
        source: "windows_exporter",
      });
    }
    return ifaces;
  } catch {
    return [];
  }
}

/** Query node_exporter's node_network_info for Linux host NICs. */
async function queryNodeExporterInterfaces(
  deps: NetworkDeps,
): Promise<PromHostInterface[]> {
  try {
    const res = await deps.fetchFn(
      `${deps.prometheusUrl}/api/v1/query?query=node_network_info`,
      { signal: AbortSignal.timeout(3_000) },
    );
    if (!res.ok) return [];

    const json = await res.json() as {
      data?: {
        result?: Array<{
          metric: {
            device?: string;
            operstate?: string;
            address?: string;
            speed?: string;
          };
        }>;
      };
    };

    return (json.data?.result ?? [])
      .filter((r) => r.metric.device && r.metric.operstate !== "down")
      .filter((r) => !isLinuxVirtualInterface(r.metric.device!))
      .map((r) => ({
        device: r.metric.device!,
        operstate: r.metric.operstate ?? "unknown",
        mac: r.metric.address,
        speed: r.metric.speed ? Number(r.metric.speed) : undefined,
        source: "node_exporter" as const,
      }));
  } catch {
    return [];
  }
}

/** Filter out Docker/virtual/loopback interfaces on Linux. */
function isLinuxVirtualInterface(name: string): boolean {
  return /^(lo|veth|br-|docker|cni|flannel|cali|tunl|virbr)/.test(name);
}

/** Filter out Hyper-V/Docker/loopback virtual adapters on Windows. */
function isWindowsVirtualInterface(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("isatap")
    || lower.includes("teredo")
    || lower === "loopback pseudo-interface 1";
}

// ─── Collector ─────────────────────────────────────────────────────────────

export async function collectNetworkDiscovery(
  ctx?: CollectorContext,
  deps: NetworkDeps = defaultDeps,
): Promise<CollectorOutput> {
  const source = ctx?.sourceKind ?? "network";
  const items: CollectorOutput["items"] = [];
  const relationships: CollectorOutput["relationships"] = [];
  const warnings: string[] = [];
  const seenSubnets = new Set<string>();

  // ── Strategy: try Prometheus first (real host network), fall back to local ──
  const promInterfaces = await discoverHostInterfacesFromPrometheus(deps);
  const usePrometheus = promInterfaces.length > 0;

  if (usePrometheus) {
    // Use node-exporter data for real host interfaces
    for (const iface of promInterfaces) {
      const ifaceRef = `net-iface:${iface.device}`;
      items.push({
        sourceKind: source,
        itemType: "network_interface",
        name: `${iface.device}${iface.mac ? ` (${iface.mac})` : ""}`,
        externalRef: ifaceRef,
        naturalKey: `iface:host:${iface.device}`,
        confidence: 0.90,
        attributes: {
          interfaceName: iface.device,
          mac: iface.mac,
          operstate: iface.operstate,
          speed: iface.speed,
          osiLayer: 3,
          osiLayerName: "network",
          protocolFamily: "ethernet",
          discoveredVia: iface.source ?? "prometheus",
        },
      });
    }
  }

  // ── Local interfaces (container-local or native host when not in Docker) ──
  const ifaces = deps.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.internal) continue;
      if (addr.family !== "IPv4") continue;

      const ifaceRef = `net-iface:${name}:${addr.address}`;
      items.push({
        sourceKind: source,
        itemType: "network_interface",
        name: `${name} (${addr.address})`,
        externalRef: ifaceRef,
        naturalKey: `iface:${name}:${addr.address}`,
        confidence: usePrometheus ? 0.70 : 0.95, // Lower confidence if we know this is container-local
        attributes: {
          interfaceName: name,
          address: addr.address,
          netmask: addr.netmask,
          mac: addr.mac,
          family: addr.family,
          osiLayer: 3,
          osiLayerName: "network",
          networkAddress: addr.address,
          protocolFamily: "ipv4",
          discoveredVia: "local_os",
        },
      });

      // Derive subnet
      const network = subnetAddress(addr.address, addr.netmask);
      const cidr = cidrFromNetmask(addr.netmask);
      const subnetKey = `${network}/${cidr}`;
      if (!seenSubnets.has(subnetKey)) {
        seenSubnets.add(subnetKey);
        items.push({
          sourceKind: source,
          itemType: "subnet",
          name: subnetKey,
          externalRef: `subnet:${subnetKey}`,
          naturalKey: `subnet:${subnetKey}`,
          confidence: 0.95,
          attributes: {
            network,
            cidr,
            netmask: addr.netmask,
            osiLayer: 3,
            osiLayerName: "network",
            networkAddress: subnetKey,
            protocolFamily: "ipv4",
          },
        });
      }

      relationships.push({
        sourceKind: source,
        relationshipType: "MEMBER_OF",
        fromExternalRef: ifaceRef,
        toExternalRef: `subnet:${subnetKey}`,
        confidence: 0.95,
      });
    }
  }

  // ── Default Gateway (L3) ──────────────────────────────────────
  const gateway = discoverGateway(deps);
  if (gateway) {
    const gwRef = `gateway:${gateway}`;
    items.push({
      sourceKind: source,
      itemType: "gateway",
      name: `Gateway ${gateway}`,
      externalRef: gwRef,
      naturalKey: `gateway:${gateway}`,
      confidence: 0.9,
      attributes: {
        address: gateway,
        osiLayer: 3,
        osiLayerName: "network",
        networkAddress: gateway,
        protocolFamily: "ipv4",
      },
    });

    for (const subnetKey of seenSubnets) {
      relationships.push({
        sourceKind: source,
        relationshipType: "ROUTES_THROUGH",
        fromExternalRef: `subnet:${subnetKey}`,
        toExternalRef: gwRef,
        confidence: 0.85,
      });
    }
  }

  // ── ARP Neighbors (L3) ────────────────────────────────────────
  const neighbors = discoverArpNeighbors(deps);
  for (const neighbor of neighbors) {
    const neighborRef = `arp-host:${neighbor.ip}`;
    items.push({
      sourceKind: source,
      itemType: "host",
      name: `LAN Host ${neighbor.ip}`,
      externalRef: neighborRef,
      naturalKey: `arp:${neighbor.ip}`,
      confidence: 0.6,
      attributes: {
        address: neighbor.ip,
        mac: neighbor.mac,
        osiLayer: 3,
        osiLayerName: "network",
        networkAddress: neighbor.ip,
        protocolFamily: "ipv4",
      },
    });

    for (const subnetKey of seenSubnets) {
      const [network, cidrStr] = subnetKey.split("/");
      if (isInSubnet(neighbor.ip, network, Number(cidrStr))) {
        relationships.push({
          sourceKind: source,
          relationshipType: "MEMBER_OF",
          fromExternalRef: neighborRef,
          toExternalRef: `subnet:${subnetKey}`,
          confidence: 0.6,
        });
        break;
      }
    }
  }

  if (items.length === 0) {
    warnings.push("network_no_interfaces");
  }

  return { items, relationships, warnings };
}
