// BPS delta computation from consecutive ifTable counter snapshots.
//
// Maintains a per-ifIndex Map of the most recent snapshot. On each call,
// compares to the previous sample and returns bits-per-second rates.
//
// Counter wrap (BigInt subtraction going negative) is detected and returns
// null so the caller can skip the affected interval rather than emitting a
// large negative or extremely large positive rate.
//
// Spec: docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md
//   § BPS delta from counter snapshots

import type { InterfaceSnapshot } from "./snmp-interface-metrics.js";

export interface InterfaceRate {
  ifIndex: number;
  ifDescr: string;
  ifAlias?: string;
  /** Inbound bits-per-second. null = first sample or counter-wrap. */
  inBps: number | null;
  /** Outbound bits-per-second. null = first sample or counter-wrap. */
  outBps: number | null;
  timestamp: string;
}

interface StoredSample {
  inOctets: bigint;
  outOctets: bigint;
  capturedAt: number; // Date.now() ms
}

/**
 * Stateful rate computer.  Instantiate once per edge-node run and call
 * `compute()` after each ifTable walk.
 */
export class InterfaceRateComputer {
  private readonly prev = new Map<number, StoredSample>();

  /**
   * Compute per-interface rates from a fresh set of snapshots.
   *
   * Returns one entry per snapshot.  Entries with `null` bps values
   * represent the first sample for that interface (no delta yet) or a
   * counter-wrap event.
   */
  compute(snapshots: InterfaceSnapshot[]): InterfaceRate[] {
    const now = Date.now();
    const results: InterfaceRate[] = [];

    for (const snap of snapshots) {
      const inOctets = BigInt(snap.inOctets);
      const outOctets = BigInt(snap.outOctets);
      const prev = this.prev.get(snap.ifIndex);

      let inBps: number | null = null;
      let outBps: number | null = null;

      if (prev) {
        const elapsedMs = now - prev.capturedAt;
        if (elapsedMs > 0) {
          const inDelta = inOctets - prev.inOctets;
          const outDelta = outOctets - prev.outOctets;

          // Negative delta → counter wrap; return null for this interval.
          if (inDelta >= 0n && outDelta >= 0n) {
            const elapsedSec = elapsedMs / 1_000;
            inBps = Number(inDelta * 8n) / elapsedSec;
            outBps = Number(outDelta * 8n) / elapsedSec;
          }
        }
      }

      // Store this sample for the next tick.
      this.prev.set(snap.ifIndex, { inOctets, outOctets, capturedAt: now });

      results.push({
        ifIndex: snap.ifIndex,
        ifDescr: snap.ifDescr,
        ifAlias: snap.ifAlias,
        inBps,
        outBps,
        timestamp: snap.timestamp,
      });
    }

    return results;
  }

  /** Remove state for interfaces that no longer appear in walks. */
  prune(currentIfIndexes: Set<number>): void {
    for (const ifIndex of this.prev.keys()) {
      if (!currentIfIndexes.has(ifIndex)) {
        this.prev.delete(ifIndex);
      }
    }
  }
}
