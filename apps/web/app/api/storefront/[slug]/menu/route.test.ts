/**
 * Tests for GET /api/storefront/:slug/menu — the anonymous walk-up menu view.
 * Public (no auth). Grouping/price logic is unit-tested in lib/storefront/
 * menu.test.ts; this covers the route's 404 + projection wiring. BI-9FEB61B8.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetPublicStorefront } = vi.hoisted(() => ({
  mockGetPublicStorefront: vi.fn(),
}));

vi.mock("@/lib/release/storefront-data", () => ({
  getPublicStorefront: mockGetPublicStorefront,
}));

import { GET } from "./route";

const PARAMS = { params: Promise.resolve({ slug: "corner-table" }) };
function req(): Request {
  return new Request("https://example/api/storefront/corner-table/menu");
}

beforeEach(() => mockGetPublicStorefront.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("GET /api/storefront/:slug/menu", () => {
  it("404s when the storefront is missing or unpublished", async () => {
    mockGetPublicStorefront.mockResolvedValueOnce(null);
    const res = await GET(req(), PARAMS);
    expect(res.status).toBe(404);
  });

  it("returns a categorised menu projected from the public storefront items", async () => {
    mockGetPublicStorefront.mockResolvedValueOnce({
      orgName: "The Corner Table",
      orgSlug: "corner-table",
      archetypeCategory: "food-hospitality",
      items: [
        { id: "1", name: "Soup", description: null, category: "Starters", priceAmount: "7", priceCurrency: "USD", imageUrl: null },
        { id: "2", name: "Pizza", description: "Wood-fired", category: "Mains", priceAmount: "14", priceCurrency: "USD", imageUrl: null },
      ],
    });

    const res = await GET(req(), PARAMS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      slug: string;
      name: string;
      category: string | null;
      categories: { category: string | null; items: { name: string; price: number | null }[] }[];
    };
    expect(body.slug).toBe("corner-table");
    expect(body.name).toBe("The Corner Table");
    expect(body.category).toBe("food-hospitality");
    expect(body.categories.map((c) => c.category)).toEqual(["Starters", "Mains"]);
    expect(body.categories[1].items[0]).toMatchObject({ name: "Pizza", price: 14 });
  });

  it("returns an empty categories array for a storefront with no items", async () => {
    mockGetPublicStorefront.mockResolvedValueOnce({
      orgName: "Empty Co",
      orgSlug: "empty-co",
      archetypeCategory: null,
      items: [],
    });
    const res = await GET(req(), PARAMS);
    const body = (await res.json()) as { categories: unknown[] };
    expect(body.categories).toEqual([]);
  });
});
