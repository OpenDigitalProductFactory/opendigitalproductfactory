import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, load } = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/twin/map-region-recommendation.server", () => ({ loadMapRegionRecommendation: load }));

import { GET } from "./route";

describe("GET /api/map-assets/recommendation", () => {
  beforeEach(() => {
    auth.mockReset();
    load.mockReset();
  });

  it("refuses a signed-out caller", async () => {
    auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(load).not.toHaveBeenCalled();
  });

  it("refuses a caller without manage_platform", async () => {
    auth.mockResolvedValue({ user: { platformRole: null, isSuperuser: false } });
    expect((await GET()).status).toBe(403);
    expect(load).not.toHaveBeenCalled();
  });

  it("returns the recommendation to an administrator", async () => {
    auth.mockResolvedValue({ user: { platformRole: null, isSuperuser: true } });
    load.mockResolvedValue({ status: "covered", groups: [] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "covered", groups: [] });
  });
});
