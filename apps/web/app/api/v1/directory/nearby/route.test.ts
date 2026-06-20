/**
 * Contract tests for GET /api/v1/directory/nearby. Geo math is unit-tested
 * separately in lib/api/nearby-geo.test.ts; these tests cover the public
 * endpoint's auth-free path, validation, the publicUrl gate, and the
 * "install too far away → empty results" branch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockOrgFindFirst, mockStorefrontFindFirst } = vi.hoisted(() => ({
  mockOrgFindFirst: vi.fn(),
  mockStorefrontFindFirst: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    organization: { findFirst: mockOrgFindFirst },
    storefrontConfig: { findFirst: mockStorefrontFindFirst },
  },
}));

import { GET } from "./route";

// London (within ~5 km of the seeded install) and Sydney (a continent away).
const LONDON = { lat: 51.5074, lng: -0.1278 };
const SYDNEY = { lat: -33.8688, lng: 151.2093 };

const ORG = {
  orgId: "ORG-ACME",
  name: "Acme HVAC",
  industry: "trades",
  address: { latitude: 51.51, longitude: -0.13, city: "London", region: "UK" },
};

function req(q: { lat?: number; lng?: number; radiusKm?: number }): Request {
  const params = new URLSearchParams();
  if (q.lat !== undefined) params.set("lat", String(q.lat));
  if (q.lng !== undefined) params.set("lng", String(q.lng));
  if (q.radiusKm !== undefined) params.set("radiusKm", String(q.radiusKm));
  return new Request(
    `https://install.example/api/v1/directory/nearby?${params.toString()}`,
  );
}

const originalEnv = process.env.PUBLIC_URL;

beforeEach(() => {
  mockOrgFindFirst.mockReset();
  mockStorefrontFindFirst.mockReset();
  process.env.PUBLIC_URL = "https://acme.example";
});
afterEach(() => {
  process.env.PUBLIC_URL = originalEnv;
  vi.restoreAllMocks();
});

describe("GET /api/v1/directory/nearby", () => {
  it("returns 422 when lat / lng are missing or invalid", async () => {
    const r1 = await GET(req({ lat: LONDON.lat }));
    expect(r1.status).toBe(422);
    const r2 = await GET(req({ lat: 200, lng: 0 }));
    expect(r2.status).toBe(422);
    expect(mockOrgFindFirst).not.toHaveBeenCalled();
  });

  it("returns this install when its lat/long falls in radius and PUBLIC_URL is set", async () => {
    mockOrgFindFirst.mockResolvedValueOnce(ORG);
    mockStorefrontFindFirst.mockResolvedValueOnce({
      archetypeId: "trades-maintenance/hvac-contractor",
    });

    const res = await GET(req({ lat: LONDON.lat, lng: LONDON.lng }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{
        instanceId: string;
        orgName: string;
        url: string;
        archetype?: string;
        distanceKm: number;
        locality?: string;
      }>;
    };
    expect(body.results).toHaveLength(1);
    expect(body.results[0].instanceId).toBe("ORG-ACME");
    expect(body.results[0].url).toBe("https://acme.example");
    expect(body.results[0].archetype).toBe(
      "trades-maintenance/hvac-contractor",
    );
    expect(body.results[0].distanceKm).toBeLessThan(5);
    expect(body.results[0].locality).toBe("London, UK");
  });

  it("returns an empty list when the query point is outside the radius", async () => {
    mockOrgFindFirst.mockResolvedValueOnce(ORG);
    mockStorefrontFindFirst.mockResolvedValueOnce(null);

    const res = await GET(req({ lat: SYDNEY.lat, lng: SYDNEY.lng }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  it("returns an empty list when PUBLIC_URL is not configured", async () => {
    delete process.env.PUBLIC_URL;
    mockOrgFindFirst.mockResolvedValueOnce(ORG);
    mockStorefrontFindFirst.mockResolvedValueOnce(null);

    const res = await GET(req({ lat: LONDON.lat, lng: LONDON.lng }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  it("returns an empty list when the install has no lat/long seeded", async () => {
    mockOrgFindFirst.mockResolvedValueOnce({
      ...ORG,
      address: { city: "London" },
    });
    mockStorefrontFindFirst.mockResolvedValueOnce(null);

    const res = await GET(req({ lat: LONDON.lat, lng: LONDON.lng }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  it("clamps an extreme radius without returning every install on the planet", async () => {
    mockOrgFindFirst.mockResolvedValueOnce(ORG);
    mockStorefrontFindFirst.mockResolvedValueOnce(null);

    // 999_999 → clamps to 500 km. The query point is Sydney → London is
    // ~17_000 km away → still excluded.
    const res = await GET(req({ lat: SYDNEY.lat, lng: SYDNEY.lng, radiusKm: 999_999 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });
});
