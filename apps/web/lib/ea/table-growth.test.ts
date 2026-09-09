import { describe, expect, it } from "vitest";

import {
  bytesPerDay,
  detectGrowthDrift,
  groupSamplesByTable,
  persistentFindings,
  type TableGrowthSampleRow,
} from "./table-growth";

const MB = 1024 * 1024;
const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n, 3, 0, 0));

function sample(over: Partial<TableGrowthSampleRow> & { table: string; sampledAt: Date }): TableGrowthSampleRow {
  return {
    model: over.table,
    totalBytes: 10n * BigInt(MB),
    heapBytes: 8n * BigInt(MB),
    indexBytes: 2n * BigInt(MB),
    toastBytes: 0n,
    liveRows: 1000n,
    deadRows: 0n,
    rowsLast24h: 0,
    declaredRetention: "90d",
    ...over,
  };
}

describe("bytesPerDay", () => {
  it("uses the two most recent samples and normalises to a day", () => {
    const s = [
      sample({ table: "T", sampledAt: day(0), totalBytes: 100n * BigInt(MB) }),
      sample({ table: "T", sampledAt: day(2), totalBytes: 120n * BigInt(MB) }),
    ];
    expect(bytesPerDay(s)).toBe(10 * MB);
    expect(bytesPerDay(s.slice(0, 1))).toBeNull();
  });
});

describe("detectGrowthDrift", () => {
  it("flags a growing table with no declaration and projects twelve months", () => {
    const history = groupSamplesByTable([
      sample({ table: "DiscoveredItem", model: null, declaredRetention: null, sampledAt: day(0), totalBytes: 200n * BigInt(MB), rowsLast24h: 17_000 }),
      sample({ table: "DiscoveredItem", model: null, declaredRetention: null, sampledAt: day(1), totalBytes: 213n * BigInt(MB), rowsLast24h: 17_500 }),
    ]);
    const findings = detectGrowthDrift(history);
    const f = findings.find((x) => x.issueType === "growth-without-disposition")!;
    expect(f).toBeDefined();
    expect(f.severity).toBe("error");
    expect(f.issueKey).toBe("growth-without-disposition:DiscoveredItem");
    expect(f.targetSourceKey).toBeNull();
    expect(f.details.projected12MonthBytes).toBe(213 * MB + 13 * MB * 365);
    expect(String(f.message)).toContain("carries no /// @dpf declaration");
  });

  it("flags a growing table whose disposition never removes rows, but not one with a purge window or a retained record", () => {
    const history = groupSamplesByTable([
      sample({ table: "Ref", declaredRetention: "reference", sampledAt: day(0), rowsLast24h: 5_000 }),
      sample({ table: "Ref", declaredRetention: "reference", sampledAt: day(1), rowsLast24h: 5_000 }),
      sample({ table: "Log", declaredRetention: "90d", sampledAt: day(0), rowsLast24h: 50_000 }),
      sample({ table: "Log", declaredRetention: "90d", sampledAt: day(1), rowsLast24h: 50_000 }),
      sample({ table: "Invoice", declaredRetention: "retained", sampledAt: day(1), rowsLast24h: 5_000 }),
    ]);
    const keys = detectGrowthDrift(history).map((f) => f.issueKey);
    expect(keys).toContain("growth-without-disposition:Ref");
    expect(keys).not.toContain("growth-without-disposition:Log");
    expect(keys).not.toContain("growth-without-disposition:Invoice");
    const ref = detectGrowthDrift(history).find((f) => f.issueKey === "growth-without-disposition:Ref")!;
    expect(ref.targetSourceKey).toBe("prisma:model:Ref");
  });

  it("does not flag a quiet table even without a declaration", () => {
    const history = groupSamplesByTable([
      sample({ table: "Quiet", model: null, declaredRetention: null, sampledAt: day(0), rowsLast24h: 3 }),
      sample({ table: "Quiet", model: null, declaredRetention: null, sampledAt: day(1), rowsLast24h: 2 }),
    ]);
    expect(detectGrowthDrift(history)).toEqual([]);
  });

  it("flags payload anatomy when TOAST dominates a large relation", () => {
    const history = groupSamplesByTable([
      sample({
        table: "ExternalEvidenceRecord",
        sampledAt: day(1),
        totalBytes: 288n * BigInt(MB),
        heapBytes: 1n * BigInt(MB),
        indexBytes: 1n * BigInt(MB),
        toastBytes: 286n * BigInt(MB),
        liveRows: 862n,
      }),
      sample({ table: "Small", sampledAt: day(1), totalBytes: 2n * BigInt(MB), toastBytes: 2n * BigInt(MB) }),
    ]);
    const findings = detectGrowthDrift(history);
    const f = findings.find((x) => x.issueType === "payload-anatomy")!;
    expect(f.issueKey).toBe("payload-anatomy:ExternalEvidenceRecord");
    expect(f.details.avgRowBytes).toBe(Math.round((288 * MB) / 862));
    expect(findings.some((x) => x.issueKey === "payload-anatomy:Small")).toBe(false);
  });
});

describe("persistentFindings", () => {
  const f = (key: string) => ({ issueType: "growth-without-disposition", issueKey: key, severity: "error" as const, message: "", targetSourceKey: null, details: {} });
  it("requires the key on every one of the previous nights", () => {
    const today = [f("a"), f("b")];
    expect(persistentFindings(today, [new Set(["a", "b"]), new Set(["a"])]).map((x) => x.issueKey)).toEqual(["a"]);
    expect(persistentFindings(today, [new Set(["a"])])).toEqual([]);
    expect(persistentFindings(today, [])).toEqual([]);
  });
});
