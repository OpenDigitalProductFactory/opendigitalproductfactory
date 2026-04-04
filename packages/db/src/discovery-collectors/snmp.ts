// SNMP Discovery Collector
// Walks SNMP on managed network devices to discover:
// - System identity (sysName, sysDescr, sysLocation)
// - Interfaces with IP addresses and operational status
// - ARP table (IP → MAC mappings for all known hosts)
// - LLDP neighbors (directly connected devices)
//
// Works with any SNMP-enabled device: routers, switches, firewalls, printers, NAS, UPS.
// Uses net-snmp (pure JavaScript, no native binaries).

// @ts-nocheck — net-snmp has no type declarations; cross-package type resolution
// causes spurious DiscoverySourceKind errors in the Next.js build context.
// This file runs inside Docker containers, not in the browser.
import snmp from "net-snmp";
import type { CollectorContext, CollectorOutput, DiscoverySourceKind } from "../discovery-types";

// ─── SNMP OIDs ──────────────────────────────────────────────────────────────

const OID = {
  // System group
  sysDescr: "1.3.6.1.2.1.1.1.0",
  sysName: "1.3.6.1.2.1.1.5.0",
  sysLocation: "1.3.6.1.2.1.1.6.0",

  // IF-MIB interface table
  ifTable: "1.3.6.1.2.1.2.2.1",        // ifEntry
  ifDescr: "1.3.6.1.2.1.2.2.1.2",       // interface name
  ifType: "1.3.6.1.2.1.2.2.1.3",        // interface type (6=ethernet)
  ifSpeed: "1.3.6.1.2.1.2.2.1.5",       // bits per second
  ifPhysAddress: "1.3.6.1.2.1.2.2.1.6", // MAC address
  ifOperStatus: "1.3.6.1.2.1.2.2.1.8",  // 1=up, 2=down, 3=testing

  // IP address table
  ipAddrTable: "1.3.6.1.2.1.4.20.1",
  ipAdEntAddr: "1.3.6.1.2.1.4.20.1.1",      // IP address
  ipAdEntIfIndex: "1.3.6.1.2.1.4.20.1.2",   // interface index
  ipAdEntNetMask: "1.3.6.1.2.1.4.20.1.3",   // subnet mask

  // ARP table (ipNetToMedia)
  ipNetToMediaTable: "1.3.6.1.2.1.4.22.1",
  ipNetToMediaPhysAddress: "1.3.6.1.2.1.4.22.1.2", // MAC
  ipNetToMediaNetAddress: "1.3.6.1.2.1.4.22.1.3",   // IP

  // LLDP neighbors
  lldpRemTable: "1.0.8802.1.1.2.1.4.1.1",
  lldpRemSysName: "1.0.8802.1.1.2.1.4.1.1.9",
  lldpRemPortDesc: "1.0.8802.1.1.2.1.4.1.1.8",
  lldpRemManAddrOID: "1.0.8802.1.1.2.1.4.2.1",
};

// ─── Types ──────────────────────────────────────────────────────────────────

export type SnmpTarget = {
  address: string;
  community?: string;       // SNMPv2c community string (default: "public")
  version?: 1 | 2;          // SNMP version (default: 2 = v2c)
  timeout?: number;          // milliseconds (default: 5000)
};

export type SnmpDeps = {
  createSession: (target: string, community: string, options: Record<string, unknown>) => SnmpSession;
};

type SnmpSession = {
  get: (oids: string[], callback: (error: Error | null, varbinds: SnmpVarbind[]) => void) => void;
  subtree: (oid: string, maxRepetitions: number, feedCb: (varbinds: SnmpVarbind[]) => void, doneCb: (error: Error | null) => void) => void;
  close: () => void;
};

type SnmpVarbind = {
  oid: string;
  type: number;
  value: Buffer | string | number;
};

const defaultDeps: SnmpDeps = {
  createSession: (target, community, options) =>
    snmp.createSession(target, community, options) as unknown as SnmpSession,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function bufferToMac(buf: Buffer | string): string {
  if (typeof buf === "string") return buf;
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join(":");
}

function varbindToString(vb: SnmpVarbind): string {
  if (Buffer.isBuffer(vb.value)) return vb.value.toString("utf8").replace(/\0/g, "");
  return String(vb.value);
}

function snmpGet(session: SnmpSession, oids: string[]): Promise<SnmpVarbind[]> {
  return new Promise((resolve, reject) => {
    session.get(oids, (error, varbinds) => {
      if (error) reject(error);
      else resolve(varbinds);
    });
  });
}

function snmpWalk(session: SnmpSession, oid: string): Promise<SnmpVarbind[]> {
  return new Promise((resolve) => {
    const results: SnmpVarbind[] = [];
    session.subtree(
      oid,
      20,
      (varbinds) => results.push(...varbinds),
      () => resolve(results),
    );
  });
}

// ─── Collector ──────────────────────────────────────────────────────────────

export async function collectSnmpDiscovery(
  ctx?: CollectorContext,
  targets?: SnmpTarget[],
  deps: SnmpDeps = defaultDeps,
): Promise<CollectorOutput> {
  const source = "snmp" as const;
  const items: CollectorOutput["items"] = [];
  const relationships: CollectorOutput["relationships"] = [];
  const warnings: string[] = [];

  if (!targets || targets.length === 0) {
    return { items, relationships, warnings: ["snmp_no_targets"] };
  }

  for (const target of targets) {
    try {
      await discoverSnmpDevice(target, deps, source, items, relationships);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`snmp_error:${target.address}:${msg}`);
    }
  }

  return { items, relationships, warnings };
}

async function discoverSnmpDevice(
  target: SnmpTarget,
  deps: SnmpDeps,
  source: string,
  items: CollectorOutput["items"],
  relationships: CollectorOutput["relationships"],
): Promise<void> {
  const community = target.community ?? "public";
  const version = target.version === 1 ? snmp.Version1 : snmp.Version2c;
  const session = deps.createSession(target.address, community, {
    version,
    timeout: target.timeout ?? 5000,
  });

  try {
    // ── System identity ──────────────────────────────────────────
    const sysVarbinds = await snmpGet(session, [OID.sysDescr, OID.sysName, OID.sysLocation]);
    const sysDescr = varbindToString(sysVarbinds[0]);
    const sysName = varbindToString(sysVarbinds[1]);
    const sysLocation = varbindToString(sysVarbinds[2]);

    const deviceRef = `snmp-device:${target.address}`;
    const deviceName = sysName || `Device ${target.address}`;

    items.push({
      sourceKind: source,
      itemType: "host",
      name: deviceName,
      externalRef: deviceRef,
      naturalKey: `snmp:${target.address}`,
      confidence: 0.90,
      attributes: {
        address: target.address,
        sysDescr,
        sysName,
        sysLocation,
        osiLayer: 3,
        osiLayerName: "network",
        networkAddress: target.address,
        protocolFamily: "ipv4",
        discoveredVia: "snmp",
      },
    });

    // ── Interfaces ───────────────────────────────────────────────
    const ifDescrVbs = await snmpWalk(session, OID.ifDescr);
    const ifStatusVbs = await snmpWalk(session, OID.ifOperStatus);
    const ifSpeedVbs = await snmpWalk(session, OID.ifSpeed);
    const ifMacVbs = await snmpWalk(session, OID.ifPhysAddress);

    const ifMap = new Map<string, { name: string; status: number; speed: number; mac: string }>();
    for (const vb of ifDescrVbs) {
      const idx = vb.oid.split(".").pop()!;
      ifMap.set(idx, { name: varbindToString(vb), status: 0, speed: 0, mac: "" });
    }
    for (const vb of ifStatusVbs) {
      const idx = vb.oid.split(".").pop()!;
      const entry = ifMap.get(idx);
      if (entry) entry.status = Number(vb.value);
    }
    for (const vb of ifSpeedVbs) {
      const idx = vb.oid.split(".").pop()!;
      const entry = ifMap.get(idx);
      if (entry) entry.speed = Number(vb.value);
    }
    for (const vb of ifMacVbs) {
      const idx = vb.oid.split(".").pop()!;
      const entry = ifMap.get(idx);
      if (entry && Buffer.isBuffer(vb.value) && vb.value.length === 6) {
        entry.mac = bufferToMac(vb.value);
      }
    }

    // ── IP addresses on interfaces ──────────────────────────────
    const ipAddrVbs = await snmpWalk(session, OID.ipAdEntAddr);
    const ipIfIndexVbs = await snmpWalk(session, OID.ipAdEntIfIndex);
    const ipMaskVbs = await snmpWalk(session, OID.ipAdEntNetMask);

    const ipByIfIndex = new Map<string, { address: string; netmask: string }>();
    for (let i = 0; i < ipAddrVbs.length; i++) {
      const addr = varbindToString(ipAddrVbs[i]);
      const ifIdx = ipIfIndexVbs[i] ? String(ipIfIndexVbs[i].value) : "";
      const mask = ipMaskVbs[i] ? varbindToString(ipMaskVbs[i]) : "255.255.255.0";
      if (ifIdx && addr && addr !== "127.0.0.1") {
        ipByIfIndex.set(ifIdx, { address: addr, netmask: mask });
      }
    }

    // Emit interface items
    for (const [idx, iface] of ifMap) {
      if (iface.status !== 1) continue; // Only "up" interfaces
      const ip = ipByIfIndex.get(idx);
      const ifaceRef = `snmp-iface:${target.address}:${iface.name}`;

      items.push({
        sourceKind: source,
        itemType: "network_interface",
        name: ip ? `${iface.name} (${ip.address})` : iface.name,
        externalRef: ifaceRef,
        naturalKey: `snmp-iface:${target.address}:${iface.name}`,
        confidence: 0.90,
        attributes: {
          interfaceName: iface.name,
          ...(ip ? { address: ip.address, netmask: ip.netmask, networkAddress: ip.address } : {}),
          ...(iface.mac ? { mac: iface.mac } : {}),
          speed: iface.speed,
          operstate: "up",
          osiLayer: 3,
          osiLayerName: "network",
          protocolFamily: "ipv4",
          discoveredVia: "snmp",
          parentDevice: target.address,
        },
      });

      // Interface belongs to device
      relationships.push({
        sourceKind: source,
        relationshipType: "HOSTS",
        fromExternalRef: deviceRef,
        toExternalRef: ifaceRef,
        confidence: 0.90,
      });
    }

    // ── ARP table (discovered hosts) ────────────────────────────
    const arpMacVbs = await snmpWalk(session, OID.ipNetToMediaPhysAddress);
    const arpIpVbs = await snmpWalk(session, OID.ipNetToMediaNetAddress);

    for (let i = 0; i < arpIpVbs.length; i++) {
      const ip = varbindToString(arpIpVbs[i]);
      const mac = arpMacVbs[i] && Buffer.isBuffer(arpMacVbs[i].value)
        ? bufferToMac(arpMacVbs[i].value as Buffer)
        : "";
      if (!ip || ip === "0.0.0.0" || ip === target.address) continue;

      const hostRef = `arp-host:${ip}`;
      items.push({
        sourceKind: source,
        itemType: "host",
        name: `LAN Host ${ip}`,
        externalRef: hostRef,
        naturalKey: `arp:${ip}`,
        confidence: 0.60,
        attributes: {
          address: ip,
          mac,
          osiLayer: 3,
          osiLayerName: "network",
          networkAddress: ip,
          protocolFamily: "ipv4",
          discoveredVia: "snmp_arp",
        },
      });
    }

    // ── LLDP neighbors ──────────────────────────────────────────
    try {
      const lldpNameVbs = await snmpWalk(session, OID.lldpRemSysName);
      for (const vb of lldpNameVbs) {
        const neighborName = varbindToString(vb);
        if (!neighborName) continue;

        const neighborRef = `lldp-neighbor:${target.address}:${neighborName}`;
        items.push({
          sourceKind: source,
          itemType: "host",
          name: neighborName,
          externalRef: neighborRef,
          naturalKey: `lldp:${target.address}:${neighborName}`,
          confidence: 0.85,
          attributes: {
            osiLayer: 2,
            osiLayerName: "data_link",
            discoveredVia: "lldp",
            discoveredFrom: target.address,
          },
        });

        relationships.push({
          sourceKind: source,
          relationshipType: "PEER_OF",
          fromExternalRef: deviceRef,
          toExternalRef: neighborRef,
          confidence: 0.85,
          attributes: { protocol: "lldp" },
        });
      }
    } catch {
      // LLDP not supported on this device — that's fine
    }
  } finally {
    session.close();
  }
}
