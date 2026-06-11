import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockGetLatest } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockGetLatest: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/assurance/bom-export", () => ({
  getLatestCycloneDxForProduct: mockGetLatest,
}));

// Import under test AFTER mocks are registered
import { GET } from "./route";

beforeEach(() => {
  mockAuth.mockReset();
  mockGetLatest.mockReset();
});

async function call(id: string) {
  const params = Promise.resolve({ id });
  return GET(new Request("http://localhost/ignored"), { params });
}

describe("GET /api/portfolio/product/:id/supply-chain/bom", () => {
  it("returns 401 when there's no session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await call("prod-1");
    expect(res.status).toBe(401);
    // The SBOM must not be loaded or leaked to an unauthenticated caller.
    expect(mockGetLatest).not.toHaveBeenCalled();
  });

  it("returns 404 when authenticated but no BOM exists", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } });
    mockGetLatest.mockResolvedValue(null);
    const res = await call("prod-1");
    expect(res.status).toBe(404);
  });

  it("returns the shareable CycloneDX document for an authenticated caller", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } });
    mockGetLatest.mockResolvedValue({
      documentId: "BOM-123",
      raw: { bomFormat: "CycloneDX", specVersion: "1.7", components: [] },
    });
    const res = await call("prod-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/vnd.cyclonedx+json; charset=utf-8",
    );
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="BOM-123.shareable.cdx.json"',
    );
    const body = JSON.parse(await res.text());
    expect(body).toMatchObject({ bomFormat: "CycloneDX", specVersion: "1.7" });
  });
});
