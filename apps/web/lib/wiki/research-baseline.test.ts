import { describe, expect, it, vi } from "vitest";
import {
  loadLatestReviewedResearchBaseline,
  type ResearchBaselineClient,
} from "./research-baseline";

function db(rows: unknown[]): ResearchBaselineClient {
  return {
    rawSource: {
      findMany: vi.fn(async () => rows),
    },
  };
}

describe("loadLatestReviewedResearchBaseline", () => {
  it("returns the newest reviewed source for the exact product scope", async () => {
    const client = db([
      {
        id: "raw-line",
        sourceKey: "line",
        excerpt: "Line-wide findings",
        retrievedAt: new Date("2026-07-27T10:00:00.000Z"),
        locator: {
          sourceType: "research",
          topic: "competitive-landscape",
          productLineId: "line-1",
          businessProductId: null,
          digitalProductId: null,
          proposalId: "rp-line",
          urls: ["https://example.com/line"],
        },
        pageSources: [
          {
            page: {
              id: "page-line",
              status: "published",
              lastReviewedAt: new Date("2026-07-27T12:00:00.000Z"),
            },
          },
        ],
      },
      {
        id: "raw-product",
        sourceKey: "product",
        excerpt: "Product findings",
        retrievedAt: new Date("2026-07-26T10:00:00.000Z"),
        locator: {
          sourceType: "research",
          topic: "competitive-landscape",
          productLineId: null,
          businessProductId: "product-1",
          digitalProductId: null,
          proposalId: "rp-product",
          urls: ["https://example.com/product"],
        },
        pageSources: [
          {
            page: {
              id: "page-product",
              status: "published",
              lastReviewedAt: new Date("2026-07-27T09:00:00.000Z"),
            },
          },
        ],
      },
    ]);

    await expect(
      loadLatestReviewedResearchBaseline(
        {
          organizationId: "org-1",
          businessProductId: "product-1",
          topic: "competitive-landscape",
        },
        client,
      ),
    ).resolves.toEqual({
      proposalId: "rp-product",
      sourceKey: "product",
      text: "Product findings",
      retrievedAt: new Date("2026-07-26T10:00:00.000Z"),
      reviewedAt: new Date("2026-07-27T09:00:00.000Z"),
      sourceUrls: ["https://example.com/product"],
    });
  });

  it("does not treat draft-only or mismatched evidence as a reviewed baseline", async () => {
    const client = db([
      {
        id: "raw-draft",
        sourceKey: "draft",
        excerpt: "Unreviewed",
        retrievedAt: new Date(),
        locator: {
          sourceType: "research",
          topic: "competitive-landscape",
          productLineId: null,
          businessProductId: "product-1",
          digitalProductId: null,
        },
        pageSources: [
          {
            page: {
              id: "page-draft",
              status: "draft",
              lastReviewedAt: null,
            },
          },
        ],
      },
    ]);

    await expect(
      loadLatestReviewedResearchBaseline(
        {
          organizationId: "org-1",
          businessProductId: "product-1",
          topic: "competitive-landscape",
        },
        client,
      ),
    ).resolves.toBeNull();
  });
});
