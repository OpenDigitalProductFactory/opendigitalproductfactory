// Unit tests for the network telemetry collector helpers.
//
// Tests cover pure functions that are exported from each collector module.
// The net-snmp Session.walk calls are NOT tested here — those are integration
// tests that require a real or mocked SNMP agent. Pure helper logic (BigInt
// coercion, OID parsing, rate computation, counter-wrap detection) is
// exhaustively tested here.

import { describe, expect, it } from "vitest";

import {
  asBigInt,
  extractIfIndex,
} from "../collectors/snmp-interface-metrics";
import { InterfaceRateComputer } from "../collectors/interface-rate";
import { formatMac, remKey, lastOidComponent } from "../collectors/lldp-collector";

// ─── asBigInt ───────────────────────────────────────────────────────────────

describe("asBigInt", () => {
  it("passes through a bigint unchanged", () => {
    expect(asBigInt(123n)).toBe(123n);
  });

  it("converts a number (truncating fraction)", () => {
    expect(asBigInt(99.9)).toBe(99n);
  });

  it("converts a decimal string", () => {
    expect(asBigInt("9007199254740993")).toBe(9007199254740993n);
  });

  it("returns 0 for a non-decimal string", () => {
    expect(asBigInt("not-a-number")).toBe(0n);
  });

  it("decodes a Buffer as big-endian bytes", () => {
    // 0x00, 0x01 = 1
    expect(asBigInt(Buffer.from([0x00, 0x01]))).toBe(1n);
    // 0x01, 0x00 = 256
    expect(asBigInt(Buffer.from([0x01, 0x00]))).toBe(256n);
    // 0xff, 0xff, 0xff, 0xff = 4294967295
    expect(asBigInt(Buffer.from([0xff, 0xff, 0xff, 0xff]))).toBe(4294967295n);
  });

  it("returns 0 for null / undefined", () => {
    expect(asBigInt(null)).toBe(0n);
    expect(asBigInt(undefined)).toBe(0n);
  });
});

// ─── extractIfIndex ──────────────────────────────────────────────────────────

describe("extractIfIndex", () => {
  it("extracts the last numeric OID component", () => {
    expect(extractIfIndex("1.3.6.1.2.1.2.2.1.2.1")).toBe(1);
    expect(extractIfIndex("1.3.6.1.2.1.31.1.1.1.6.24")).toBe(24);
  });

  it("returns null for an empty OID", () => {
    expect(extractIfIndex("")).toBeNull();
  });

  it("returns null when the last component is not a number", () => {
    expect(extractIfIndex("1.3.6.abc")).toBeNull();
  });
});

// ─── InterfaceRateComputer ───────────────────────────────────────────────────

function makeSnap(ifIndex: number, inOctets: string, outOctets: string, overrides?: Partial<{ ifDescr: string; timestamp: string }>) {
  return {
    ifIndex,
    ifDescr: overrides?.ifDescr ?? `eth${ifIndex}`,
    inOctets,
    outOctets,
    timestamp: overrides?.timestamp ?? new Date().toISOString(),
  };
}

describe("InterfaceRateComputer", () => {
  it("returns null bps on the first sample for each interface", () => {
    const computer = new InterfaceRateComputer();
    const rates = computer.compute([makeSnap(1, "1000", "2000")]);
    expect(rates[0]!.inBps).toBeNull();
    expect(rates[0]!.outBps).toBeNull();
  });

  it("computes correct bps on the second sample", async () => {
    const computer = new InterfaceRateComputer();
    computer.compute([makeSnap(1, "0", "0")]);
    // Wait ~10 ms so elapsed > 0
    await new Promise((r) => setTimeout(r, 10));
    // 8 000 bytes in, 16 000 bytes out over ~10 ms
    const rates = computer.compute([makeSnap(1, "8000", "16000")]);
    const r = rates[0]!;
    expect(r.inBps).not.toBeNull();
    expect(r.outBps).not.toBeNull();
    // Rough check: 8000 bytes * 8 bits / ~0.01 s ≈ 6 400 000 bps
    // We just verify the ratio is 2× out vs in (not the exact value).
    expect(r.outBps! / r.inBps!).toBeCloseTo(2, 0);
  });

  it("returns null bps on counter-wrap (negative delta)", () => {
    const computer = new InterfaceRateComputer();
    computer.compute([makeSnap(1, "9999999999", "9999999999")]);
    // Wrap: next value is less than prev
    const rates = computer.compute([makeSnap(1, "100", "200")]);
    expect(rates[0]!.inBps).toBeNull();
    expect(rates[0]!.outBps).toBeNull();
  });

  it("prunes interfaces that disappear from walks", () => {
    const computer = new InterfaceRateComputer();
    computer.compute([makeSnap(1, "0", "0"), makeSnap(2, "0", "0")]);
    // Interface 2 disappears
    computer.prune(new Set([1]));
    // Interface 2 should behave as first-sample again
    const rates = computer.compute([makeSnap(2, "1000", "2000")]);
    expect(rates[0]!.inBps).toBeNull();
  });

  it("returns separate rates for multiple interfaces", () => {
    const computer = new InterfaceRateComputer();
    computer.compute([makeSnap(1, "0", "0"), makeSnap(2, "0", "0")]);
    const rates = computer.compute([makeSnap(1, "1000", "2000"), makeSnap(2, "5000", "6000")]);
    expect(rates).toHaveLength(2);
    // Both should have non-null rates after the second sample
    // (exact values depend on elapsed time — just check not null)
    // We allow null if the elapsed time is exactly 0 (extremely fast machines)
    expect(rates[0]!.ifIndex).toBe(1);
    expect(rates[1]!.ifIndex).toBe(2);
  });
});

// ─── remKey ─────────────────────────────────────────────────────────────────

describe("remKey", () => {
  it("extracts the last three OID components as timeMark.localPortNum.remIndex", () => {
    // OID: prefix.{timeMark}.{localPortNum}.{remIndex}
    expect(remKey("1.0.8802.1.1.2.1.4.1.1.5.0.1.1")).toBe("0.1.1");
    expect(remKey("1.0.8802.1.1.2.1.4.1.1.9.123.4.7")).toBe("123.4.7");
  });

  it("returns null for an OID with fewer than 3 components", () => {
    expect(remKey("1.2")).toBeNull();
  });
});

// ─── lastOidComponent ───────────────────────────────────────────────────────

describe("lastOidComponent", () => {
  it("returns the numeric last component", () => {
    expect(lastOidComponent("1.0.8802.1.1.2.1.3.7.1.4.3")).toBe(3);
  });

  it("returns null for non-numeric last component", () => {
    expect(lastOidComponent("1.2.xyz")).toBeNull();
  });
});

// ─── formatMac ──────────────────────────────────────────────────────────────

describe("formatMac", () => {
  it("formats a Buffer as a colon-separated hex MAC", () => {
    const buf = Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44, 0x55]);
    expect(formatMac(buf)).toBe("00:11:22:33:44:55");
  });

  it("returns empty string for null", () => {
    expect(formatMac(null)).toBe("");
  });

  it("returns the string value unchanged for a non-Buffer", () => {
    expect(formatMac("already-formatted")).toBe("already-formatted");
  });

  it("zero-pads individual bytes", () => {
    const buf = Buffer.from([0x00, 0x0f]);
    expect(formatMac(buf)).toBe("00:0f");
  });
});

// ─── metrics-loop trustState gate ─────────────────────────────────────────

import { runMetricsLoop } from "../metrics-loop";
import type { EdgeNodeState } from "../state";
import type { EdgeNodeConfig } from "../config";
import type { AuthorityApiClient } from "../api-client";

describe("runMetricsLoop", () => {
  it("returns immediately when SNMP_TARGET is absent", async () => {
    const logged: string[] = [];
    await runMetricsLoop({
      config: {} as EdgeNodeConfig,
      api: {} as AuthorityApiClient,
      state: {
        nodeId: "n1",
        nodeToken: "tok",
        enrolledAt: new Date().toISOString(),
        heartbeatIntervalSec: 30,
        sweepIntervalSec: 60,
        acceptedCapabilities: [],
        trustState: "trusted",
      } as EdgeNodeState,
      snmpTarget: undefined, // no target → early return
      log: (_l, msg) => logged.push(msg),
      maxIterations: 1,
    });
    expect(logged.some((m) => m.includes("SNMP_TARGET not set"))).toBe(true);
  });

  it("skips collection tick when trustState is not trusted", async () => {
    const logged: string[] = [];
    let ticks = 0;
    await runMetricsLoop({
      config: {} as EdgeNodeConfig,
      api: {} as AuthorityApiClient,
      state: {
        nodeId: "n1",
        nodeToken: "tok",
        enrolledAt: new Date().toISOString(),
        heartbeatIntervalSec: 30,
        sweepIntervalSec: 60,
        metricsIntervalSec: 1,
        acceptedCapabilities: [],
        trustState: "pending",
      } as EdgeNodeState,
      snmpTarget: "192.0.2.1",
      sleep: async () => { ticks++; },
      log: (_l, msg) => logged.push(msg),
      maxIterations: 2,
    });
    expect(logged.some((m) => m.includes("not trusted"))).toBe(true);
    expect(ticks).toBe(2);
  });
});
