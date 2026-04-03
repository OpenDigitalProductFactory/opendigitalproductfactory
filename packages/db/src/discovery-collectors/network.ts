import os from "node:os";
import { spawnSync } from "node:child_process";

import type { CollectorContext, CollectorOutput } from "../discovery-types";

// ─── Dependency Injection Types ────────────────────────────────────────────

export type NetworkDeps = {
  networkInterfaces: typeof os.networkInterfaces;
  execCommand: (cmd: string, args: string[]) => string;
};

function defaultExecCommand(cmd: string, args: string[]): string {
  const result = spawnSync(cmd, args, { encoding: "utf8", timeout: 5_000 });
  return result.status === 0 ? result.stdout : "";
}

const defaultDeps: NetworkDeps = {
  networkInterfaces: os.networkInterfaces,
  execCommand: defaultExecCommand,
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
  // Linux: ip route
  let output = deps.execCommand("ip", ["route"]);
  if (output) {
    const match = output.match(/default via (\d+\.\d+\.\d+\.\d+)/);
    if (match) return match[1];
  }

  // Windows: route print
  output = deps.execCommand("route", ["print", "0.0.0.0"]);
  if (output) {
    const match = output.match(
      /0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)/,
    );
    if (match) return match[1];
  }

  // macOS/BSD fallback: netstat -rn
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
  // Linux: ip neigh
  let output = deps.execCommand("ip", ["neigh"]);
  if (output) {
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const match = line.match(
          /^(\d+\.\d+\.\d+\.\d+)\s+.*lladdr\s+([\da-fA-F:]+)/,
        );
        return match ? { ip: match[1], mac: match[2] } : null;
      })
      .filter((n): n is ArpNeighbor => n != null);
  }

  // Windows / macOS: arp -a
  output = deps.execCommand("arp", ["-a"]);
  if (output) {
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([\da-fA-F:-]+)/);
        return match
          ? { ip: match[1], mac: match[2].replace(/-/g, ":") }
          : null;
      })
      .filter((n): n is ArpNeighbor => n != null)
      .filter((n) => n.mac !== "ff:ff:ff:ff:ff:ff"); // Exclude broadcast
  }

  return [];
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

  // ── Network Interfaces (L3) ───────────────────────────────────
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
        confidence: 0.95,
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
        },
      });

      // Derive subnet from interface address + netmask
      const network = subnetAddress(addr.address, addr.netmask);
      const cidr = cidrFromNetmask(addr.netmask);
      const subnetKey = `${network}/${cidr}`;
      if (!seenSubnets.has(subnetKey)) {
        seenSubnets.add(subnetKey);
        const subnetRef = `subnet:${subnetKey}`;
        items.push({
          sourceKind: source,
          itemType: "subnet",
          name: subnetKey,
          externalRef: subnetRef,
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

      // Interface MEMBER_OF subnet
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

    // Each subnet ROUTES_THROUGH gateway
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

    // Assign neighbor to its subnet
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
