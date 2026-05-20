// LLDP peer discovery via LLDP-MIB remote table (IEEE 802.1AB).
//
// Walks lldpRemTable OID 1.0.8802.1.1.2.1.4.1.1 to discover directly
// connected network peers.  Returns structured PEER_OF records that the
// portal's inventory layer can turn into InventoryRelationship rows.
//
// Uses the same `net-snmp` package and walk helper pattern as
// snmp-interface-metrics.ts so no additional dependency is required.
//
// Spec: docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md
//   § LLDP collector, § PEER_OF structs

import snmp from "net-snmp";

import type { SnmpInterfaceConfig } from "./snmp-interface-metrics.js";

// lldpRemTable OIDs (1.0.8802.1.1.2.1.4.1.1.{column})
const OID_LLDP_REM_CHASSIS_ID = "1.0.8802.1.1.2.1.4.1.1.5"; // lldpRemChassisId
const OID_LLDP_REM_PORT_ID = "1.0.8802.1.1.2.1.4.1.1.7"; // lldpRemPortId
const OID_LLDP_REM_PORT_DESC = "1.0.8802.1.1.2.1.4.1.1.8"; // lldpRemPortDesc
const OID_LLDP_REM_SYS_NAME = "1.0.8802.1.1.2.1.4.1.1.9"; // lldpRemSysName
const OID_LLDP_REM_SYS_DESC = "1.0.8802.1.1.2.1.4.1.1.10"; // lldpRemSysDesc
const OID_LLDP_LOC_PORT_DESC = "1.0.8802.1.1.2.1.3.7.1.4"; // lldpLocPortDesc

/** A discovered LLDP neighbor. */
export interface LldpPeerRecord {
  /** Local port (from lldpLocPortDesc, e.g. "GigabitEthernet0/1"). */
  localPort: string;
  /** Remote chassis MAC or other identifier. */
  chassisId: string;
  /** Remote port identifier. */
  portId: string;
  systemName?: string;
  systemDescription?: string;
  portDescription?: string;
  timestamp: string;
}

/**
 * Walk the LLDP remote table and return peer records.
 * Returns an empty array when the target is unreachable or has no LLDP data.
 */
export async function collectLldpPeers(
  config: SnmpInterfaceConfig,
): Promise<LldpPeerRecord[]> {
  const {
    target,
    community = "public",
    version = snmp.Version2c,
    timeout = 5_000,
  } = config;

  const session = snmp.createSession(target, community, { version, timeout });

  try {
    // Build a map of localPortNum → local port description first.
    const localPorts = new Map<number, string>();
    await walkOid(session, OID_LLDP_LOC_PORT_DESC, (oid, value) => {
      const portNum = lastOidComponent(oid);
      if (portNum !== null && value != null) {
        localPorts.set(portNum, String(value));
      }
    });

    // Index: "{timeMark}.{localPortNum}.{remIndex}" → partial record
    const remotes = new Map<
      string,
      {
        timeMark: number;
        localPortNum: number;
        remIndex: number;
        chassisId?: string;
        portId?: string;
        portDescription?: string;
        systemName?: string;
        systemDescription?: string;
      }
    >();

    function getOrCreate(key: string) {
      let r = remotes.get(key);
      if (!r) {
        const [t, l, i] = key.split(".").map(Number) as [number, number, number];
        r = { timeMark: t, localPortNum: l, remIndex: i };
        remotes.set(key, r);
      }
      return r;
    }

    await walkOid(session, OID_LLDP_REM_CHASSIS_ID, (oid, value) => {
      const key = remKey(oid);
      if (key) getOrCreate(key).chassisId = formatMac(value);
    });

    await walkOid(session, OID_LLDP_REM_PORT_ID, (oid, value) => {
      const key = remKey(oid);
      if (key) getOrCreate(key).portId = value != null ? String(value) : "";
    });

    await walkOid(session, OID_LLDP_REM_PORT_DESC, (oid, value) => {
      const key = remKey(oid);
      if (key) getOrCreate(key).portDescription = value != null ? String(value) : undefined;
    });

    await walkOid(session, OID_LLDP_REM_SYS_NAME, (oid, value) => {
      const key = remKey(oid);
      if (key) getOrCreate(key).systemName = value != null ? String(value) : undefined;
    });

    await walkOid(session, OID_LLDP_REM_SYS_DESC, (oid, value) => {
      const key = remKey(oid);
      if (key) getOrCreate(key).systemDescription = value != null ? String(value) : undefined;
    });

    const timestamp = new Date().toISOString();
    const peers: LldpPeerRecord[] = [];

    for (const r of remotes.values()) {
      if (!r.chassisId || !r.portId) continue;
      peers.push({
        localPort: localPorts.get(r.localPortNum) ?? `port${r.localPortNum}`,
        chassisId: r.chassisId,
        portId: r.portId,
        systemName: r.systemName,
        systemDescription: r.systemDescription,
        portDescription: r.portDescription,
        timestamp,
      });
    }

    return peers;
  } finally {
    session.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function walkOid(
  session: snmp.Session,
  oid: string,
  cb: (oid: string, value: unknown) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    session.walk(
      oid,
      20,
      (varbinds) => {
        for (const vb of varbinds) {
          if (snmp.isVarbindError(vb)) continue;
          cb(vb.oid, vb.value);
        }
      },
      (err) => {
        if (done) return;
        done = true;
        err ? reject(err) : resolve();
      },
    );
  });
}

function lastOidComponent(oid: string): number | null {
  const parts = oid.split(".");
  const n = parseInt(parts[parts.length - 1]!, 10);
  return isNaN(n) ? null : n;
}

/**
 * Extract "{timeMark}.{localPortNum}.{remIndex}" from a lldpRemTable OID.
 * The final 3 index components encode the row identity.
 */
function remKey(oid: string): string | null {
  const parts = oid.split(".");
  if (parts.length < 3) return null;
  const [i, p, t] = [
    parts[parts.length - 1],
    parts[parts.length - 2],
    parts[parts.length - 3],
  ];
  return `${t}.${p}.${i}`;
}

/** Format a net-snmp Buffer as a colon-delimited MAC, or return the string value. */
function formatMac(value: unknown): string {
  if (Buffer.isBuffer(value)) {
    return Array.from(value)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(":");
  }
  return value != null ? String(value) : "";
}
