import {
  normalizeProductIntelligenceScope,
  type ProductIntelligenceScopeInput,
} from "@/lib/product-management/product-intelligence-scope";

export type ReviewedResearchBaseline = {
  proposalId: string | null;
  sourceKey: string;
  text: string;
  retrievedAt: Date | null;
  reviewedAt: Date;
  sourceUrls: string[];
};

type BaselineRow = {
  sourceKey: string;
  excerpt: string | null;
  retrievedAt: Date | null;
  locator: unknown;
  pageSources: Array<{
    page: {
      status: string;
      lastReviewedAt: Date | null;
    };
  }>;
};

export type ResearchBaselineClient = {
  rawSource: {
    findMany: (args: unknown) => Promise<unknown>;
  };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sameScope(
  locator: Record<string, unknown>,
  scope: ReturnType<typeof normalizeProductIntelligenceScope>,
): boolean {
  return (
    nullableString(locator.productLineId) === scope.productLineId &&
    nullableString(locator.businessProductId) === scope.businessProductId &&
    nullableString(locator.digitalProductId) === scope.digitalProductId
  );
}

export async function loadLatestReviewedResearchBaseline(
  input: ProductIntelligenceScopeInput & { topic: string },
  db: ResearchBaselineClient,
): Promise<ReviewedResearchBaseline | null> {
  const scope = normalizeProductIntelligenceScope(input);
  const rows = (await db.rawSource.findMany({
    where: {
      organizationId: scope.organizationId,
      sourceType: "research",
      pageSources: {
        some: {
          page: {
            status: "published",
            lastReviewedAt: { not: null },
          },
        },
      },
    },
    orderBy: [{ retrievedAt: "desc" }, { updatedAt: "desc" }],
    take: 50,
    select: {
      sourceKey: true,
      excerpt: true,
      retrievedAt: true,
      locator: true,
      pageSources: {
        select: {
          page: {
            select: {
              status: true,
              lastReviewedAt: true,
            },
          },
        },
      },
    },
  })) as BaselineRow[];

  for (const row of rows) {
    const locator = asRecord(row.locator);
    if (nullableString(locator.sourceType) !== "research") continue;
    if (nullableString(locator.topic) !== input.topic.trim()) continue;
    if (!sameScope(locator, scope)) continue;

    const reviewedAt = row.pageSources
      .filter((link) => link.page.status === "published" && link.page.lastReviewedAt)
      .map((link) => link.page.lastReviewedAt as Date)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (!reviewedAt || !row.excerpt?.trim()) continue;

    const urls = Array.isArray(locator.urls)
      ? locator.urls
          .filter((url): url is string => typeof url === "string" && url.trim().length > 0)
          .map((url) => url.trim())
      : [];

    return {
      proposalId: nullableString(locator.proposalId),
      sourceKey: row.sourceKey,
      text: row.excerpt,
      retrievedAt: row.retrievedAt,
      reviewedAt,
      sourceUrls: urls,
    };
  }

  return null;
}
