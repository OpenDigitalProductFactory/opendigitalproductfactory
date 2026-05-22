import { describe, expect, it, vi } from "vitest";
import {
  getLatestBomComponentsForProduct,
  getLatestBomSummaryForBuild,
  getLatestBomSummaryForProduct,
} from "./bom-read";

describe("getLatestBomSummaryForBuild", () => {
  it("returns a missing state when no BOM exists", async () => {
    const db = { bomDocument: { findFirst: vi.fn(async () => null) } };

    await expect(getLatestBomSummaryForBuild(db, "BUILD-1")).resolves.toEqual({
      state: "missing",
      document: null,
      counts: { components: 0, models: 0 },
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

    await expect(getLatestBomSummaryForBuild(db, "BUILD-1")).resolves.toEqual({
      state: "current",
      document: {
        documentId: "bom_1",
        digest: "abc",
        generatedAt,
        componentCount: 3,
        sourceKind: "pnpm-lock",
      },
      counts: { components: 3, models: 1 },
    });
    expect(db.bomDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { buildId: "BUILD-1" },
      orderBy: { generatedAt: "desc" },
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

    const summary = await getLatestBomSummaryForProduct(db, "product-1");

    expect(summary.state).toBe("stale");
    expect(db.bomDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { digitalProductId: "product-1" },
    }));
  });
});

describe("getLatestBomComponentsForProduct", () => {
  it("returns the latest product BOM rows for the supply chain table", async () => {
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
        },
      ],
    });
  });
});
