import { describe, expect, it } from "vitest";

import { getPatchPosture, type PatchPostureDb } from "./patch-posture";

interface Row {
  findingKey: string;
  findingKind: string;
  policySeverity: string;
  status: string;
  title: string;
  affectedId: string;
  vendorIdentifier: string;
  evidence: Record<string, unknown>;
  remediationHint: Record<string, unknown>;
  lastSeenAt: Date | string;
}

class FakeDb implements PatchPostureDb {
  constructor(private readonly rows: Row[]) {}
  assuranceFinding = {
    findMany: async (args: {
      where: { findingKey: { startsWith: string }; status?: { in: string[] } };
      take: number;
    }): Promise<unknown[]> => {
      let rows = this.rows.filter((r) => r.findingKey.startsWith(args.where.findingKey.startsWith));
      if (args.where.status?.in) rows = rows.filter((r) => args.where.status!.in.includes(r.status));
      return rows.slice(0, args.take);
    },
  };
}

function row(overrides: Partial<Row>): Row {
  return {
    findingKey: "patch:e",
    findingKind: "vulnerability",
    policySeverity: "high",
    status: "open",
    title: "t",
    affectedId: "host-1",
    vendorIdentifier: "CVE-x",
    evidence: {},
    remediationHint: {},
    lastSeenAt: new Date("2026-06-25T00:00:00.000Z"),
    ...overrides,
  };
}

describe("getPatchPosture", () => {
  it("summarizes totals and sorts critical/KEV first", async () => {
    const db = new FakeDb([
      row({ findingKey: "patch:a", policySeverity: "medium", findingKind: "missing-patch", affectedId: "host-1", remediationHint: { targetVersion: "2.0" } }),
      row({ findingKey: "patch:b", policySeverity: "critical", vendorIdentifier: "CVE-1", affectedId: "host-2", evidence: { cisaKev: true, installedVersion: "1.0" } }),
      row({ findingKey: "patch:c", policySeverity: "high", affectedId: "host-2" }),
    ]);
    const posture = await getPatchPosture(db);
    expect(posture.totals.findings).toBe(3);
    expect(posture.totals.bySeverity).toEqual({ critical: 1, high: 1, medium: 1 });
    expect(posture.totals.byKind).toEqual({ vulnerability: 2, "missing-patch": 1 });
    expect(posture.totals.kev).toBe(1);
    expect(posture.totals.hosts).toBe(2);
    // critical (and KEV) first
    expect(posture.findings[0].findingKey).toBe("patch:b");
    expect(posture.findings[0].cisaKev).toBe(true);
    expect(posture.findings[0].installedVersion).toBe("1.0");
    const gap = posture.findings.find((f) => f.findingKey === "patch:a")!;
    expect(gap.targetVersion).toBe("2.0");
  });

  it("excludes resolved findings by default and includes them with status=all", async () => {
    const db = new FakeDb([
      row({ findingKey: "patch:open" }),
      row({ findingKey: "patch:done", status: "resolved" }),
    ]);
    expect((await getPatchPosture(db)).totals.findings).toBe(1);
    expect((await getPatchPosture(db, { status: "all" })).totals.findings).toBe(2);
  });

  it("flags a capped list when more findings exist than the limit", async () => {
    const db = new FakeDb([
      row({ findingKey: "patch:1" }),
      row({ findingKey: "patch:2" }),
      row({ findingKey: "patch:3" }),
    ]);
    const posture = await getPatchPosture(db, { limit: 2 });
    expect(posture.capped).toBe(true);
    expect(posture.findings).toHaveLength(2);
  });
});
