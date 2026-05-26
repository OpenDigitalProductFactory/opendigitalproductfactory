import { describe, expect, it } from "vitest";

import { buildAssuranceSummaryTrust } from "./assurance";

const emptyFindings = {
  total: 0,
  blocking: 0,
  bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  byKind: {},
};

const readyScanner = {
  state: "ready" as const,
  approvedScannerCount: 1,
  scannerNames: ["pnpm-audit"],
  reason: "platform-native-scanner-available" as const,
};

function currentSummary(overrides = {}) {
  return {
    state: "current" as const,
    document: {
      documentId: "bom_1",
      digest: "abc",
      generatedAt: new Date("2026-05-26T10:00:00.000Z"),
      componentCount: 10,
      sourceKind: "pnpm-lock",
    },
    latestAssuranceRunCompletedAt: new Date("2026-05-26T10:30:00.000Z"),
    counts: { components: 10, models: 1 },
    findings: emptyFindings,
    scanner: readyScanner,
    ...overrides,
  };
}

describe("buildAssuranceSummaryTrust", () => {
  it("scores a current BOM and current scan as a high-trust current fact", () => {
    const assessment = buildAssuranceSummaryTrust(currentSummary(), {
      asOf: new Date("2026-05-26T12:00:00.000Z"),
    });

    expect(assessment.tier).toBe("high");
    expect(assessment.statementKind).toBe("current-fact");
    expect(assessment.action).toBe("present");
  });

  it("requires refresh for no-finding claims when the latest scan is 45 days old", () => {
    const assessment = buildAssuranceSummaryTrust(currentSummary({
      latestAssuranceRunCompletedAt: new Date("2026-04-11T12:00:00.000Z"),
    }), {
      asOf: new Date("2026-05-26T12:00:00.000Z"),
    });

    expect(assessment.statementKind).toBe("last-known-fact");
    expect(assessment.action).toBe("refresh-required");
    expect(assessment.primaryRationale).toContain("45 days");
  });

  it("marks missing BOMs as requiring refresh", () => {
    const assessment = buildAssuranceSummaryTrust({
      state: "missing",
      document: null,
      latestAssuranceRunCompletedAt: null,
      counts: { components: 0, models: 0 },
      findings: emptyFindings,
      scanner: readyScanner,
    }, {
      asOf: new Date("2026-05-26T12:00:00.000Z"),
    });

    expect(assessment.tier).toBe("low");
    expect(assessment.action).toBe("refresh-required");
    expect(assessment.primaryRationale).toContain("No assurance scan");
  });

  it("lowers trust when no approved scanner is available", () => {
    const assessment = buildAssuranceSummaryTrust(currentSummary({
      scanner: {
        state: "needs-evaluation" as const,
        approvedScannerCount: 0,
        scannerNames: [],
        reason: "no-approved-scanner" as const,
      },
    }), {
      asOf: new Date("2026-05-26T12:00:00.000Z"),
    });

    expect(assessment.tier).not.toBe("high");
    expect(assessment.dimensions.find((dimension) => dimension.key === "toolReliability")?.tier).toBe("low");
  });
});
