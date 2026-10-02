import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ authenticate: vi.fn(), loadMap: vi.fn(), listPacks: vi.fn() }));
vi.mock("@/lib/api/auth-middleware", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth-middleware")>()),
  authenticateRequest: m.authenticate,
}));
vi.mock("@/lib/crm/customer-map.server", () => ({ loadCustomerMap: m.loadMap }));
vi.mock("@/lib/twin/map-assets.server", () => ({ listInstalledMapPacks: m.listPacks }));

import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  m.loadMap.mockResolvedValue({ layout: null, presentations: {}, placedCount: 0, unplaced: [], coverage: {} });
  m.listPacks.mockResolvedValue([]);
});

describe("GET /api/v1/map/customer-sites (AC-PMR-SCENE-1)", () => {
  it("refuses a caller without view_customer", async () => {
    m.authenticate.mockResolvedValue({ capabilities: ["view_operations"] });
    const response = await GET(new Request("https://dpf.local/api/v1/map/customer-sites"));
    expect(response.status).toBe(403);
    expect(m.loadMap).not.toHaveBeenCalled();
  });

  it("returns the payload with view_customer", async () => {
    m.authenticate.mockResolvedValue({ capabilities: ["view_customer"] });
    const response = await GET(new Request("https://dpf.local/api/v1/map/customer-sites"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ model: null, notOnMap: 0, pack: null, basemap: "nothing-to-show" });
  });
});
