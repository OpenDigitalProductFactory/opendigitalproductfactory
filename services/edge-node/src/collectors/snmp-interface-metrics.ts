// SNMP ifXTable walk for network interface metrics.
//
// Walks ifXTable (RFC 2863 §ifXTable) to collect 64-bit counters:
//   - ifHCInOctets  (1.3.6.1.2.1.31.1.1.1.6)
//   - ifHCOutOctets (1.3.6.1.2.1.31.1.1.1.10)
//   - ifDescr       (1.3.6.1.2.1.2.2.1.2)  — from base ifTable
//   - ifAlias       (1.3.6.1.2.1.31.1.1.1.18)
//
// Uses the `net-snmp` npm package (no shell-out). Requires an SNMP agent
// that exposes ifXTable (most managed switches do under SNMPv2c). If the
// target only exposes the base ifTable (32-bit counters), all rows are
// filtered out (HC OIDs return 0 or error) and an empty array is returned.
// Phase 2 will add a 32-bit fallback walk — tracked as a known gap.
//
// Spec: docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md
//   § SNMP ifTable walk, § BigInt serialization

import snmp from "net-snmp";

// OIDs
const OID_IF_DESCR = "1.3.6.1.2.1.2.2.1.2"; // ifDescr (base ifTable)
const OID_IF_ALIAS = "1.3.6.1.2.1.31.1.1.1.18"; // ifAlias
const OID_IF_HC_IN_OCTETS = "1.3.6.1.2.1.31.1.1.1.6"; // ifHCInOctets (64-bit)
const OID_IF_HC_OUT_OCTETS = "1.3.6.1.2.1.31.1.1.1.10"; // ifHCOutOctets (64-bit)

export interface SnmpInterfaceConfig {
  target: string;
  community?: string;
  /** SNMP version: 0 = v1, 1 = v2c (default). */
  version?: 0 | 1;
  /** Per-target timeout in ms. Default: 5000. */
  timeout?: number;
}

/** One row from the ifTable walk. Counter values are decimal strings. */
export interface InterfaceSnapshot {
  ifIndex: number;
  ifDescr: string;
  ifAlias?: string;
  /** ifHCInOctets as a decimal string (avoids JSON BigInt). */
  inOctets: string;
  /** ifHCOutOctets as a decimal string. */
  outOctets: string;
  /** ISO-8601 timestamp when the walk completed. */
  timestamp: string;
}

/**
 * Walk the ifXTable for one SNMP target and return per-interface
 * counter snapshots.  Resolves with an empty array when the target
 * is unreachable (error is swallowed — caller decides whether to log).
 */
export async function walkInterfaceMetrics(
  config: SnmpInterfaceConfig,
): Promise<InterfaceSnapshot[]> {
  const {
    target,
    community = "public",
    version = snmp.Version2c,
    timeout = 5_000,
  } = config;

  const session = snmp.createSession(target, community, { version, timeout });

  try {
    const interfaces = new Map<
      number,
      {
        ifDescr?: string;
        ifAlias?: string;
        inOctets?: bigint;
        outOctets?: bigint;
      }
    >();

    await walkOid(session, OID_IF_DESCR, (oid, value) => {
      const idx = extractIfIndex(oid);
      if (idx === null) return;
      const row = interfaces.get(idx) ?? {};
      row.ifDescr = value != null ? String(value) : undefined;
      interfaces.set(idx, row);
    });

    await walkOid(session, OID_IF_ALIAS, (oid, value) => {
      const idx = extractIfIndex(oid);
      if (idx === null) return;
      const row = interfaces.get(idx);
      if (row) row.ifAlias = value != null ? String(value) : undefined;
    });

    await walkOid(session, OID_IF_HC_IN_OCTETS, (oid, value) => {
      const idx = extractIfIndex(oid);
      if (idx === null) return;
      const row = interfaces.get(idx);
      if (row) row.inOctets = asBigInt(value);
    });

    await walkOid(session, OID_IF_HC_OUT_OCTETS, (oid, value) => {
      const idx = extractIfIndex(oid);
      if (idx === null) return;
      const row = interfaces.get(idx);
      if (row) row.outOctets = asBigInt(value);
    });

    const timestamp = new Date().toISOString();
    const results: InterfaceSnapshot[] = [];

    for (const [ifIndex, row] of interfaces.entries()) {
      if (
        row.ifDescr &&
        row.inOctets !== undefined &&
        row.outOctets !== undefined
      ) {
        results.push({
          ifIndex,
          ifDescr: row.ifDescr,
          ifAlias: row.ifAlias,
          inOctets: row.inOctets.toString(),
          outOctets: row.outOctets.toString(),
          timestamp,
        });
      }
    }

    return results;
  } finally {
    session.close();
  }
}

// ---------------------------------------------------------------------------
// Exported helpers (also used in tests)
// ---------------------------------------------------------------------------

export function walkOid(
  session: snmp.Session,
  oid: string,
  cb: (oid: string, value: unknown) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    session.walk(
      oid,
      20, // maxRepetitions
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

/** Extract ifIndex from the last OID component. */
export function extractIfIndex(oid: string): number | null {
  const parts = oid.split(".");
  const n = parseInt(parts[parts.length - 1]!, 10);
  return isNaN(n) ? null : n;
}

/** Coerce net-snmp value to BigInt (handles Buffer, number, bigint, string). */
export function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  if (Buffer.isBuffer(value)) {
    // net-snmp returns Counter64 as a Buffer (big-endian)
    let n = 0n;
    for (const byte of value) {
      n = (n << 8n) | BigInt(byte);
    }
    return n;
  }
  return 0n;
}
