/**
 * Tests for GET /api/storefront/nearby — the anonymous walk-up discovery
 * endpoint. Public (no auth). Verifies geo distance + sort + graceful
 * handling of businesses that published no coordinates. BI-9FEB61B8.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockOrgFindMany, mockGetPublicStorefront } = vi.hoisted(() => ({
  mockOrgFindMany: vi.fn(),
  mockGetPublicStorefront: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: { organization: { findMany: mockOrgFindMany } },
}));
vi.mock("@/lib/release/storefront-data", () => ({
  getPublicStorefront: mockGetPublicStorefront,
}));

import { GET } from "./route";

function sf(overrides: Record<string, unknown> = {}) {
  return {
    orgName: "The Corner Table",
    orgSlug: "corner-table",
    archetypeId: "food-hospitality/restaurant",
    archetypeCategory: "food-hospitality",
    orgAddress: { lat: 37.7955, lng: -122.3937, city: "San Francisco" },
    items: [{ id: "i1" }],
    ...overrides,
  };
}

function req(query = ""): Request {
  return new Request(`https://example/api/storefront/nearby${query}`);
}

beforeEach(() => {
  mockOrgFindMany.mockReset();
  mockGetPublicStorefront.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/storefront/nearby", () => {
  it("returns a nearby business with a computed distance when coords + query present", async () => {
    mockOrgFindMany.mockResolvedValueOnce([{ slug: "corner-table" }]);
    mockGetPublicStorefront.mockResolvedValueOnce(sf());

    const res = await GET(req("?lat=37.8024&lng=-122.4058"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      businesses: { slug: string; distanceMeters: number | null; hasMenu: boolean; category: string | null }[];
    };
    expect(body.businesses).toHaveLength(1);
    const b = body.businesses[0];
    expect(b.slug).toBe("corner-table");
    expect(b.category).toBe("food-hospitality");
    expect(b.hasMenu).toBe(true);
    expect(b.distanceMeters).toBeGreaterThan(500);
    expect(b.distanceMeters).toBeLessThan(2500);
  });

  it("surfaces a business with null distance when it published no coordinates", async () => {
    mockOrgFindMany.mockResolvedValueOnce([{ slug: "no-coords" }]);
    mockGetPublicStorefront.mockResolvedValueOnce(
      sf({ orgSlug: "no-coords", orgAddress: { city: "Nowhere" }, items: [] }),
    );

    const res = await GET(req("?lat=37.8&lng=-122.4"));
    const body = (await res.json()) as {
      businesses: { distanceMeters: number | null; hasMenu: boolean }[];
    };
    expect(body.businesses[0].distanceMeters).toBeNull();
    expect(body.businesses[0].hasMenu).toBe(false);
  });

  it("still surfaces businesses (null distance) when the query omits coordinates", async () => {
    mockOrgFindMany.mockResolvedValueOnce([{ slug: "corner-table" }]);
    mockGetPublicStorefront.mockResolvedValueOnce(sf());

    const res = await GET(req());
    const body = (await res.json()) as { businesses: { distanceMeters: number | null }[] };
    expect(body.businesses).toHaveLength(1);
    expect(body.businesses[0].distanceMeters).toBeNull();
  });

  it("skips unpublished / unconfigured orgs (getPublicStorefront → null)", async () => {
    mockOrgFindMany.mockResolvedValueOnce([{ slug: "a" }, { slug: "b" }]);
    mockGetPublicStorefront
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(sf({ orgSlug: "b" }));

    const res = await GET(req("?lat=37.8&lng=-122.4"));
    const body = (await res.json()) as { businesses: { slug: string }[] };
    expect(body.businesses.map((x) => x.slug)).toEqual(["b"]);
  });

  it("sorts nearest first with unknown-distance businesses last", async () => {
    mockOrgFindMany.mockResolvedValueOnce([
      { slug: "far" },
      { slug: "no-coords" },
      { slug: "near" },
    ]);
    mockGetPublicStorefront
      .mockResolvedValueOnce(sf({ orgSlug: "far", orgAddress: { lat: 40.0, lng: -122.4 } }))
      .mockResolvedValueOnce(sf({ orgSlug: "no-coords", orgAddress: {} }))
      .mockResolvedValueOnce(sf({ orgSlug: "near", orgAddress: { lat: 37.8005, lng: -122.404 } }));

    const res = await GET(req("?lat=37.8&lng=-122.404"));
    const body = (await res.json()) as { businesses: { slug: string }[] };
    expect(body.businesses.map((x) => x.slug)).toEqual(["near", "far", "no-coords"]);
  });
});
