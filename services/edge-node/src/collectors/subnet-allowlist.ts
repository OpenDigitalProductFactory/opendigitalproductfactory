// Subnet allow-list resolution for the active discovery collectors.
//
// What gets scanned, in priority order:
//
//   1. If DPF_EDGE_DISCOVERY_SUBNETS is set in the environment, parse
//      it as a comma-separated list of CIDRs and use ONLY that.
//      Operator-explicit always wins — the operator may include
//      subnets that don't show up on local NICs (e.g. a VPN-attached
//      remote LAN they want inventoried) or, conversely, scope
//      scanning down to a single subnet on a multi-homed host.
//
//   2. Otherwise, derive subnets from the host's non-internal,
//      non-link-local IPv4 NICs (`os.networkInterfaces()` already
//      hands us `cidr` per address). Then apply two safety filters:
//
//        a. Drop anything bigger than the operator-configured cap
//           (DPF_EDGE_DISCOVERY_MIN_CIDR_BITS, default 20 → ≤ 4096
//           addresses per subnet). Auto-detect must NEVER kick off
//           a 65k-host /16 scan unattended; the operator can opt in
//           via the explicit env override above if they really
//           mean it.
//        b. Drop loopback + link-local explicitly (the cidr cap
//           catches /8 loopback by default, but we hard-filter
//           regardless of cap so they can't slip back in).
//
// Result: a list of CIDR strings the active collectors are allowed
// to scan, plus warnings about anything we dropped so the operator
// sees what got filtered and why.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
//   § Edge Node capability envelope — capability.discovery.network
//   § Operator-configurable safety bounds (Phase 0)

import * as os from "node:os";

export type SubnetAllowlistResolution = {
  /** CIDR strings safe to scan, in stable order. */
  subnets: string[];
  /**
   * Non-fatal messages — surfaced on the next discovery-run envelope's
   * `warnings` array. Operators see why a subnet got filtered without
   * having to grep container logs.
   */
  warnings: string[];
  /** Where the result came from, for log clarity. */
  source: "env" | "auto" | "empty";
};

/** Adapter for tests — replaces os.networkInterfaces + process.env. */
export type SubnetAllowlistAdapter = {
  networkInterfaces: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;
  env: NodeJS.ProcessEnv;
};

const DEFAULT_ADAPTER: SubnetAllowlistAdapter = {
  networkInterfaces: os.networkInterfaces,
  env: process.env,
};

/**
 * Minimum CIDR mask bits the auto-derive path will accept. Default 20
 * (4096 addresses per subnet); operator can tighten with the env var.
 * Tighter (larger number) = smaller max network = safer.
 *
 * Why 20 by default: typical residential / SMB LANs are /24; small
 * enterprise sites are /23 or /22. /20 covers those and still bounds
 * the scan workload — at nmap's default rate, a full /20 ping sweep
 * takes ~30s. A /16 would take 8+ minutes and is almost always wrong
 * as an auto-detected scan target.
 */
const DEFAULT_MIN_CIDR_BITS = 20;

/**
 * Hard ceiling on auto-detected subnet size — operator-explicit env
 * override can go lower, but auto-detect refuses to consider anything
 * with fewer mask bits than this (i.e. larger than /8). Prevents the
 * pathological case of an interface with a 0.0.0.0/0 default-route-
 * style address ending up in the scan list.
 */
const HARD_MIN_CIDR_BITS = 8;

/** Parse "DPF_EDGE_DISCOVERY_MIN_CIDR_BITS" with safe fallback. */
function parseMinCidrBits(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_MIN_CIDR_BITS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < HARD_MIN_CIDR_BITS || n > 32) {
    return DEFAULT_MIN_CIDR_BITS;
  }
  return n;
}

/** Validate that a string parses as a CIDR `a.b.c.d/N`. */
function parseCidr(
  raw: string,
): { network: string; cidr: number } | null {
  const trimmed = raw.trim();
  const m = trimmed.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/);
  if (!m) return null;
  const network = m[1]!;
  const cidr = Number(m[2]!);
  if (!Number.isInteger(cidr) || cidr < 0 || cidr > 32) return null;
  for (const oct of network.split(".")) {
    const n = Number(oct);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
  }
  return { network, cidr };
}

/**
 * Aggregate an IP + CIDR into the canonical "<network address>/N"
 * form. Node's `os.networkInterfaces()` returns the address bound to
 * the NIC (e.g. "192.168.1.42") together with a `cidr` string already
 * in network form ("192.168.1.0/24"), so this helper mostly exists
 * for defensiveness against weird platform output (and for the
 * env-override path that comes in raw).
 */
function canonicalizeCidr(network: string, cidrBits: number): string {
  // Mask the network address to the cidr bits so an operator who
  // wrote "192.168.1.42/24" gets normalized to "192.168.1.0/24"
  // before reaching nmap.
  const octets = network.split(".").map((o) => Number(o));
  const mask = cidrBits === 0 ? 0 : ((0xffffffff << (32 - cidrBits)) >>> 0);
  const ip =
    (octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!;
  const masked = (ip & mask) >>> 0;
  const out = [
    (masked >>> 24) & 0xff,
    (masked >>> 16) & 0xff,
    (masked >>> 8) & 0xff,
    masked & 0xff,
  ].join(".");
  return `${out}/${cidrBits}`;
}

function isLoopbackOrLinkLocal(network: string): boolean {
  return network.startsWith("127.") || network.startsWith("169.254.");
}

/**
 * Resolve the subnet allow-list for active discovery collectors.
 *
 * Pure function (modulo the adapter) — no I/O, no exec. Safe to call
 * once per sweep tick.
 */
export function resolveSubnetAllowlist(
  adapter: SubnetAllowlistAdapter = DEFAULT_ADAPTER,
): SubnetAllowlistResolution {
  const envOverride = (adapter.env.DPF_EDGE_DISCOVERY_SUBNETS ?? "").trim();
  const minCidrBits = parseMinCidrBits(
    adapter.env.DPF_EDGE_DISCOVERY_MIN_CIDR_BITS,
  );

  // Path 1 — explicit env override. Operator-controlled; we still
  // validate but DO NOT apply the minCidrBits cap (operator opt-in).
  if (envOverride.length > 0) {
    const warnings: string[] = [];
    const out: string[] = [];
    for (const raw of envOverride.split(",")) {
      const parsed = parseCidr(raw);
      if (parsed === null) {
        warnings.push(
          `discovery: ignored invalid CIDR in DPF_EDGE_DISCOVERY_SUBNETS: "${raw.trim()}"`,
        );
        continue;
      }
      const canonical = canonicalizeCidr(parsed.network, parsed.cidr);
      if (!out.includes(canonical)) out.push(canonical);
    }
    return {
      subnets: out,
      warnings,
      source: out.length > 0 ? "env" : "empty",
    };
  }

  // Path 2 — auto-derive from NICs.
  const ifaces = adapter.networkInterfaces();
  const seen = new Set<string>();
  const subnets: string[] = [];
  const warnings: string[] = [];

  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4") continue;
      if (addr.internal) continue;
      if (!addr.cidr) continue;
      if (isLoopbackOrLinkLocal(addr.address)) continue;

      const parsed = parseCidr(addr.cidr);
      if (parsed === null) continue;
      if (parsed.cidr < minCidrBits) {
        warnings.push(
          `discovery: skipped auto-detected subnet ${addr.cidr} on ${name} ` +
            `(larger than /${minCidrBits} cap; set DPF_EDGE_DISCOVERY_SUBNETS ` +
            `to scan explicitly, or lower DPF_EDGE_DISCOVERY_MIN_CIDR_BITS)`,
        );
        continue;
      }
      const canonical = canonicalizeCidr(parsed.network, parsed.cidr);
      if (!seen.has(canonical)) {
        seen.add(canonical);
        subnets.push(canonical);
      }
    }
  }

  return {
    subnets,
    warnings,
    source: subnets.length > 0 ? "auto" : "empty",
  };
}
