import { describe, expect, it, vi } from "vitest";
import {
  getLatestBomComponentsForProduct,
  getLatestBomSummaryForBuild,
  getLatestBomSummaryForProduct,
} from "./bom-read";

const emptyFindings = {
  total: 0,
  blocking: 0,
  bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  byKind: {},
};

const platformNativeScanner = {
  state: "ready",
  approvedScannerCount: 1,
  scannerNames: ["pnpm-audit"],
  reason: "platform-native-scanner-available",
};

describe("getLatestBomSummaryForBuild", () => {
  it("returns a missing state when no BOM exists", async () => {
    const db = { bomDocument: { findFirst: vi.fn(async () => null) } };

    await expect(getLatestBomSummaryForBuild(db, "BUILD-1", {
      now: new Date("2026-05-26T12:00:00.000Z"),
    })).resolves.toMatchObject({
      state: "missing",
      document: null,
      counts: { components: 0, models: 0 },
      findings: emptyFindings,
      scanner: platformNativeScanner,
      trust: expect.objectContaining({
        action: "refresh-required",
      }),
    });
  });

  it("summarizes the newest build BOM and model count", async () => {
    const generatedAt = new Date("2026-05-22T00:00:00.000Z");
    const db = {
      bomDocument: {
        findFirst: vi.fn(async () => ({
          documentId: "bom_1",
          digest: "abc",
          generatedAt,
          componentCount: 3,
          sourceKind: "pnpm-lock",
          status: "current",
          occurrences: [
            { component: { componentType: "library" } },
            { component: { componentType: "model" } },
          ],
        })),
      },
    };

    await expect(getLatestBomSummaryForBuild(db, "BUILD-1", {
      now: new Date("2026-05-22T01:00:00.000Z"),
    })).resolves.toMatchObject({
      state: "current",
      document: {
        documentId: "bom_1",
        digest: "abc",
        generatedAt,
        componentCount: 3,
        sourceKind: "pnpm-lock",
      },
      counts: { components: 3, models: 1 },
      findings: emptyFindings,
      scanner: platformNativeScanner,
      trust: expect.objectContaining({
        statementKind: "current-fact",
      }),
    });
    expect(db.bomDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { buildId: "BUILD-1" },
      orderBy: { generatedAt: "desc" },
    }));
  });

  it("adds stale scan trust metadata from the latest assurance run", async () => {
    const generatedAt = new Date("2026-05-22T00:00:00.000Z");
    const db = {
      bomDocument: {
        findFirst: vi.fn(async () => ({
          documentId: "bom_1",
          digest: "abc",
          generatedAt,
          componentCount: 3,
          sourceKind: "pnpm-lock",
          status: "current",
          occurrences: [],
        })),
      },
      assuranceRun: {
        findFirst: vi.fn(async () => ({
          completedAt: new Date("2026-04-11T12:00:00.000Z"),
        })),
      },
    };

    const summary = await getLatestBomSummaryForBuild(db, "BUILD-1", {
      now: new Date("2026-05-26T12:00:00.000Z"),
    });

    expect(summary.latestAssuranceRunCompletedAt).toEqual(new Date("2026-04-11T12:00:00.000Z"));
    expect(summary.trust?.action).toBe("refresh-required");
    expect(summary.trust?.primaryRationale).toContain("45 days");
    expect(db.assuranceRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { buildId: "BUILD-1", status: "completed" },
    }));
  });
});

describe("getLatestBomSummaryForProduct", () => {
  it("marks non-current product BOMs stale", async () => {
    const db = {
      bomDocument: {
        findFirst: vi.fn(async () => ({
          documentId: "bom_stale",
          digest: "def",
          generatedAt: new Date("2026-05-20T00:00:00.000Z"),
          componentCount: 1,
          sourceKind: "pnpm-lock",
          status: "superseded",
          occurrences: [],
        })),
      },
    };

    const summary = await getLatestBomSummaryForProduct(db, "product-1", {
      now: new Date("2026-05-26T12:00:00.000Z"),
    });

    expect(summary.state).toBe("stale");
    expect(summary.findings).toEqual(emptyFindings);
    expect(summary.scanner).toEqual(platformNativeScanner);
    expect(summary.trust?.statementKind).toBe("last-known-fact");
    expect(db.bomDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { digitalProductId: "product-1" },
    }));
  });
});

describe("getLatestBomComponentsForProduct", () => {
  it("returns the latest product BOM rows for the software-composition table", async () => {
    const generatedAt = new Date("2026-05-22T00:00:00.000Z");
    const db = {
      bomDocument: {
        findFirst: vi.fn(async () => ({
          documentId: "bom_2",
          generatedAt,
          digest: "ghi",
          componentCount: 1,
          occurrences: [
            {
              component: {
                name: "next",
                version: "16.2.6",
                componentType: "framework",
                ecosystem: "npm",
                packageUrl: "pkg:npm/next@16.2.6",
                catalogIdentity: {
                  lifecycleMilestones: [
                    {
                      milestone: "eol",
                      date: new Date("2027-01-01T00:00:00.000Z"),
                      confidence: 0.9,
                    },
                  ],
                },
              },
            },
          ],
        })),
      },
    };

    await expect(getLatestBomComponentsForProduct(db, "product-1")).resolves.toEqual({
      latestBom: {
        documentId: "bom_2",
        generatedAt,
        digest: "ghi",
        componentCount: 1,
      },
      components: [
        {
          name: "next",
          version: "16.2.6",
          componentType: "framework",
          ecosystem: "npm",
          packageUrl: "pkg:npm/next@16.2.6",
          lifecycleMilestones: [
            {
              milestone: "eol",
              date: new Date("2027-01-01T00:00:00.000Z"),
              confidence: 0.9,
            },
          ],
        },
      ],
      findingSummary: emptyFindings,
      scanner: platformNativeScanner,
    });
    expect(db.bomDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { digitalProductId: "product-1", status: "current" },
      select: expect.objectContaining({
        occurrences: expect.objectContaining({
          select: {
            component: {
              select: expect.objectContaining({
                catalogIdentity: {
                  select: {
                    lifecycleMilestones: {
                      select: { milestone: true, date: true, confidence: true },
                    },
                  },
                },
              }),
            },
          },
        }),
      }),
    }));
  });
});
