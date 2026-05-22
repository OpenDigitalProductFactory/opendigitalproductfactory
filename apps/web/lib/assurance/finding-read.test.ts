import { describe, expect, it, vi } from "vitest";
import {
  getActiveFindingSummaryForBuild,
  getActiveFindingSummaryForProduct,
  listActiveFindingsForBuild,
  listActiveFindingsForProduct,
} from "./finding-read";

describe("active assurance finding summaries", () => {
  it("rolls up active build findings by severity and release impact", async () => {
    const db = {
      assuranceFinding: {
        findMany: vi.fn(async () => [
          { policySeverity: "critical", releaseImpact: "block", status: "open", findingKind: "vulnerability" },
          { policySeverity: "medium", releaseImpact: "warn", status: "planned", findingKind: "license" },
          { policySeverity: "high", releaseImpact: "block", status: "accepted", findingKind: "vulnerability" },
        ]),
      },
    };

    await expect(getActiveFindingSummaryForBuild(db, "BUILD-1")).resolves.toEqual({
      total: 3,
      blocking: 1,
      bySeverity: { critical: 1, high: 1, medium: 1, low: 0, info: 0 },
      byKind: { vulnerability: 2, license: 1 },
    });
    expect(db.assuranceFinding.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { buildId: "BUILD-1", status: { notIn: ["resolved", "false-positive"] } },
    }));
  });

  it("returns an empty summary when product finding persistence is not available yet", async () => {
    await expect(getActiveFindingSummaryForProduct({}, "prod-1")).resolves.toEqual({
      total: 0,
      blocking: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      byKind: {},
    });
  });
});

describe("listActiveFindingsForBuild", () => {
  it("returns findings sorted by severity then recency", async () => {
    const newer = new Date("2026-05-22T12:00:00.000Z");
    const older = new Date("2026-05-20T12:00:00.000Z");
    const db = {
      assuranceFinding: {
        findMany: vi.fn(async () => [
          {
            findingKey: "fk-low",
            findingKind: "vulnerability",
            title: "Low issue",
            status: "open",
            policySeverity: "low",
            releaseImpact: "track",
            adapterKey: "pnpm-audit",
            vendorIdentifier: "GHSA-low",
            affectedType: "bom-component",
            affectedId: "key-low",
            lastSeenAt: newer,
            bomComponent: null,
          },
          {
            findingKey: "fk-critical-old",
            findingKind: "vulnerability",
            title: "Old critical",
            status: "open",
            policySeverity: "critical",
            releaseImpact: "block",
            adapterKey: "pnpm-audit",
            vendorIdentifier: "GHSA-critical-old",
            affectedType: "bom-component",
            affectedId: "key-critical-old",
            lastSeenAt: older,
            bomComponent: {
              name: "vulnerable-lib",
              version: "1.2.0",
              packageUrl: "pkg:npm/vulnerable-lib@1.2.0",
            },
          },
          {
            findingKey: "fk-critical-new",
            findingKind: "vulnerability",
            title: "Recent critical",
            status: "open",
            policySeverity: "critical",
            releaseImpact: "block",
            adapterKey: "pnpm-audit",
            vendorIdentifier: "GHSA-critical-new",
            affectedType: "bom-component",
            affectedId: "key-critical-new",
            lastSeenAt: newer,
            bomComponent: null,
          },
        ]),
      },
    };

    const result = await listActiveFindingsForBuild(db, "BUILD-1", 5);

    expect(result.map((finding) => finding.findingKey)).toEqual([
      "fk-critical-new",
      "fk-critical-old",
      "fk-low",
    ]);
    expect(result[1]?.component).toEqual({
      name: "vulnerable-lib",
      version: "1.2.0",
      packageUrl: "pkg:npm/vulnerable-lib@1.2.0",
    });
    expect(db.assuranceFinding.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { buildId: "BUILD-1", status: { notIn: ["resolved", "false-positive"] } },
      take: 5,
    }));
  });

  it("returns empty array when finding persistence not available", async () => {
    await expect(listActiveFindingsForProduct({}, "prod-1")).resolves.toEqual([]);
  });
});
