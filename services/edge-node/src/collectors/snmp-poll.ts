// SNMP poll (C3) — query the operator-configured target list for
// device identity (sysName, sysDescr, sysObjectID, sysUpTime, ifNumber)
// and emit one `network_device` inventory entity per responder.
//
// This is the collector that closes the original T2 success bar:
// "at least one switch / gateway / non-portal-host inventory item
// with osiLayer >= 2 in the discovery results."
//
// Why SNMP and not LLDP/CDP receive: LLDP-receive requires the agent
// to live on the same broadcast domain as the device and have
// CAP_NET_RAW + multicast group membership. SNMP works over routed
// IP from anywhere the operator has reachability to the device's
// 161/udp. It's slightly less topology-rich (no peer-port disclosure
// from CDP/LLDP TLVs) but vastly more deployable.
//
// We shell out to `snmpget` from net-snmp-tools. Same pattern as C2's
// nmap shell-out — no new npm dependency, no native build, output is
// a small text format easy to parse. The `snmpget` binary is added
// to the image in the Dockerfile.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
//   § Edge Node capability envelope — capability.discovery.network

import { execFileSync } from "node:child_process";

import type { ObservationItem } from "./host-info";
import {
  resolveSnmpConfig,
  type SnmpConfigAdapter,
  type SnmpTarget,
} from "./snmp-config";

/** OIDs we query per target. */
const SYS_OIDS = {
  sysDescr: "1.3.6.1.2.1.1.1.0",
  sysObjectID: "1.3.6.1.2.1.1.2.0",
  sysUpTime: "1.3.6.1.2.1.1.3.0",
  sysName: "1.3.6.1.2.1.1.5.0",
  sysLocation: "1.3.6.1.2.1.1.6.0",
  ifNumber: "1.3.6.1.2.1.2.1.0",
} as const;

type SysFacts = {
  sysName?: string;
  sysDescr?: string;
  sysObjectID?: string;
  sysUpTimeTicks?: number;
  sysLocation?: string;
  ifNumber?: number;
};

export type SnmpRelationship = {
  fromObservedKey: string;
  toObservedKey: string;
  relationshipType: string;
  rawData?: Record<string, unknown>;
};

export type SnmpPollResult = {
  items: ObservationItem[];
  relationships: SnmpRelationship[];
  warnings: string[];
};

/** Adapter for tests — replaces snmpget exec + the config resolver. */
export type SnmpPollAdapter = {
  /**
   * Run `snmpget` for a single OID and return its formatted output
   * line, or throw on non-zero exit / timeout. Sync; per-target loop
   * is serial since SNMP is cheap and parallel adds complexity
   * without throughput win at small fleet sizes.
   */
  execSnmpget: (target: SnmpTarget, oid: string) => string;
  /** Config source (defaults to file + env). */
  configAdapter?: SnmpConfigAdapter;
};

const DEFAULT_ADAPTER: SnmpPollAdapter = {
  execSnmpget: (target, oid) => snmpget(target, oid),
};

/**
 * Build the snmpget argv for a target, including version-specific
 * auth flags. Returns [bin, args[]].
 */
function snmpgetArgv(target: SnmpTarget, oid: string): [string, string[]] {
  const common = ["-OQv", "-t", `${Math.round(target.timeoutMs / 1000)}`, "-r", "1"];
  if (target.version === "2c") {
    return [
      "snmpget",
      [
        ...common,
        "-v",
        "2c",
        "-c",
        target.community,
        `${target.host}:${target.port}`,
        oid,
      ],
    ];
  }
  // v3
  return [
    "snmpget",
    [
      ...common,
      "-v",
      "3",
      "-l",
      "authPriv",
      "-u",
      target.user,
      "-a",
      target.authProtocol,
      "-A",
      target.authPassword,
      "-x",
      target.privProtocol,
      "-X",
      target.privPassword,
      `${target.host}:${target.port}`,
      oid,
    ],
  ];
}

function snmpget(target: SnmpTarget, oid: string): string {
  const [bin, args] = snmpgetArgv(target, oid);
  return execFileSync(bin, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024,
    // The -t flag inside snmpget governs per-query timeout; this is
    // a defensive outer bound for the whole exec invocation.
    timeout: target.timeoutMs + 2_000,
  });
}

/**
 * Parse `snmpget -OQv` (quick-print, value-only) output. With -OQv,
 * snmpget emits just the value on stdout — e.g. `"Linux gateway 5.15"`
 * for sysDescr — without the OID prefix or type annotation. Strips
 * surrounding quotes that snmpget adds to string types.
 */
export function parseSnmpgetOQv(raw: string): string {
  const trimmed = raw.trim();
  // Quoted string: "Linux gateway 5.15"
  const quoted = trimmed.match(/^"(.*)"$/s);
  if (quoted) return quoted[1]!;
  return trimmed;
}

/**
 * Parse the sysUpTime "Timeticks: (12345) 0:00:01.23" form. -OQv
 * strips the "Timeticks:" prefix on most versions but leaves the
 * parenthesized centisecond count + the formatted duration; older
 * net-snmp may emit just the duration. Handle both.
 */
export function parseSysUpTime(raw: string): number | undefined {
  const trimmed = raw.trim();
  // Form 1: "(12345) 0:00:01.23"
  const ticksMatch = trimmed.match(/^\((\d+)\)/);
  if (ticksMatch) return Number(ticksMatch[1]!);
  // Form 2: "0:02:34.56" — parse h:m:s.cs
  const durMatch = trimmed.match(/^(\d+):(\d+):(\d+)\.(\d+)/);
  if (durMatch) {
    const h = Number(durMatch[1]!);
    const m = Number(durMatch[2]!);
    const s = Number(durMatch[3]!);
    const cs = Number(durMatch[4]!);
    return (h * 3600 + m * 60 + s) * 100 + cs;
  }
  // Form 3: pure number (some hosts)
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Walk a single target. Each OID is its own snmpget; if any fails the
 * collector logs a warning and returns the partial facts it did
 * collect. Some firewalls block specific OIDs (e.g. sysObjectID for
 * fingerprinting protection) — a partial result is still useful.
 */
function pollTarget(
  target: SnmpTarget,
  adapter: SnmpPollAdapter,
  warnings: string[],
): SysFacts {
  const facts: SysFacts = {};
  const safeGet = (oidName: keyof typeof SYS_OIDS): string | undefined => {
    try {
      return parseSnmpgetOQv(adapter.execSnmpget(target, SYS_OIDS[oidName]));
    } catch (err) {
      warnings.push(
        `snmp: ${target.host} OID ${oidName} failed: ${(err as Error).message}`,
      );
      return undefined;
    }
  };

  facts.sysName = safeGet("sysName");
  facts.sysDescr = safeGet("sysDescr");
  facts.sysObjectID = safeGet("sysObjectID");
  facts.sysLocation = safeGet("sysLocation");

  const upTimeRaw = safeGet("sysUpTime");
  if (upTimeRaw) {
    const ticks = parseSysUpTime(upTimeRaw);
    if (ticks !== undefined) facts.sysUpTimeTicks = ticks;
  }

  const ifNumRaw = safeGet("ifNumber");
  if (ifNumRaw) {
    const n = Number(ifNumRaw);
    if (Number.isInteger(n) && n >= 0) facts.ifNumber = n;
  }

  return facts;
}

/**
 * Best-effort device classification from sysObjectID + sysDescr.
 * Vendor enterprise OIDs under 1.3.6.1.4.1 tell us who made the
 * device; common ones (Cisco=9, Juniper=2636, Aruba=14823, etc.) are
 * widely known. We don't try to identify model — that's a vendor-
 * specific MIB lookup and outside C3's scope. Returns broad class.
 */
function classifyDevice(
  facts: SysFacts,
): { osiLayer: number; itemType: string; vendorOidPrefix?: string } {
  // Default: Layer-2/3 network device unless evidence otherwise.
  let osiLayer = 2;
  let itemType = "network_device";

  // sysDescr keyword heuristics — a "Cisco IOS" or "Juniper JunOS"
  // string almost always means a router/switch. A "Linux" string
  // could be anything; treat as router-class only if we have other
  // signal (e.g. ifNumber > 2).
  const descr = (facts.sysDescr ?? "").toLowerCase();
  if (
    descr.includes("router") ||
    descr.includes("ios ") ||
    descr.includes("junos") ||
    descr.includes("routeros") ||
    descr.includes("pfsense") ||
    descr.includes("opnsense")
  ) {
    osiLayer = 3;
    itemType = "router";
  } else if (descr.includes("switch")) {
    osiLayer = 2;
    itemType = "switch";
  } else if (
    descr.includes("access point") ||
    descr.includes("wireless") ||
    descr.includes("wifi")
  ) {
    osiLayer = 2;
    itemType = "wireless_ap";
  }

  // Vendor OID prefix (the .1.3.6.1.4.1.<vendor> portion) — surfaced
  // in rawData for downstream classification without trying to parse
  // it here.
  let vendorOidPrefix: string | undefined;
  const m = (facts.sysObjectID ?? "").match(
    /^1\.3\.6\.1\.4\.1\.(\d+)/,
  );
  if (m) vendorOidPrefix = `1.3.6.1.4.1.${m[1]}`;

  return vendorOidPrefix !== undefined
    ? { osiLayer, itemType, vendorOidPrefix }
    : { osiLayer, itemType };
}

/**
 * Run SNMP polls across the configured target list. Each target
 * emits at most one `network_device` (or `router`/`switch`/`wireless_ap`)
 * item, keyed `snmp:<ip>` to keep distinct from the `arp:<ip>` host
 * entities — a single physical device may show up as BOTH (its mgmt
 * IP responded to ICMP/ARP and to SNMP), and the Authority correlates
 * them via a sameAs/MEMBER_OF relationship in a future pass. For
 * Phase 0a we keep the keys separate so SNMP-discovered attributes
 * don't accidentally overwrite host attributes.
 */
export async function collectSnmpPoll(
  adapter: SnmpPollAdapter = DEFAULT_ADAPTER,
): Promise<SnmpPollResult> {
  const config = resolveSnmpConfig(adapter.configAdapter);
  const items: ObservationItem[] = [];
  const relationships: SnmpRelationship[] = [];
  const warnings: string[] = [...config.warnings];

  if (config.targets.length === 0) {
    return { items, relationships, warnings };
  }

  for (const target of config.targets) {
    const facts = pollTarget(target, adapter, warnings);

    // No facts at all = unreachable / fully blocked. Skip the item
    // entirely — operators get the per-OID warnings already.
    if (
      facts.sysName === undefined &&
      facts.sysDescr === undefined &&
      facts.sysObjectID === undefined
    ) {
      continue;
    }

    const classification = classifyDevice(facts);
    items.push({
      observedKey: `snmp:${target.host}`,
      itemType: classification.itemType,
      name: facts.sysName ?? `SNMP device ${target.host}`,
      // 0.95 — SNMP responded with system identity. Highest confidence
      // of any C-line collector because the device confirmed who it is.
      confidence: 0.95,
      rawData: {
        address: target.host,
        port: target.port,
        snmpVersion: target.version,
        osiLayer: classification.osiLayer,
        osiLayerName: classification.osiLayer === 3 ? "network" : "data-link",
        protocolFamily: "ipv4",
        discoveredVia: "snmp_poll",
        ...(facts.sysName !== undefined ? { sysName: facts.sysName } : {}),
        ...(facts.sysDescr !== undefined ? { sysDescr: facts.sysDescr } : {}),
        ...(facts.sysObjectID !== undefined
          ? { sysObjectID: facts.sysObjectID }
          : {}),
        ...(facts.sysLocation !== undefined
          ? { sysLocation: facts.sysLocation }
          : {}),
        ...(facts.sysUpTimeTicks !== undefined
          ? { sysUpTimeTicks: facts.sysUpTimeTicks }
          : {}),
        ...(facts.ifNumber !== undefined
          ? { interfaceCount: facts.ifNumber }
          : {}),
        ...(classification.vendorOidPrefix !== undefined
          ? { vendorOidPrefix: classification.vendorOidPrefix }
          : {}),
      },
    });

    // Cross-reference relationship: if the SNMP target IP also got
    // discovered by C1/C2 (very common for the LAN gateway), link the
    // two entities so the inventory graph treats them as the same
    // physical device. The Authority's normalization can later
    // collapse them into one canonical entity.
    relationships.push({
      fromObservedKey: `snmp:${target.host}`,
      toObservedKey: `arp:${target.host}`,
      relationshipType: "SAME_AS",
      rawData: { reason: "snmp_target_matches_l3_host" },
    });
  }

  return { items, relationships, warnings };
}
