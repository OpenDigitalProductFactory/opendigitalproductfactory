import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  getSnapshot: vi.fn(),
}));

vi.mock("@/lib/actions/shared/guards", () => ({
  requireCapability: mocks.requireCapability,
}));

vi.mock("@/lib/self-upgrade/status-snapshot", () => ({
  getSelfUpgradeStatusSnapshot: mocks.getSnapshot,
}));

import { GET } from "./route";

describe("GET /api/ops/self-upgrade/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCapability.mockResolvedValue({ userId: "operator" });
  });

  it("returns the targeted projection without caching it", async () => {
    mocks.getSnapshot.mockResolvedValue({ observedAt: "2026-08-01T00:00:00.000Z" });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.requireCapability).toHaveBeenCalledWith("view_operations");
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({
      observedAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("preserves the capability guard as an unauthorized response", async () => {
    mocks.requireCapability.mockRejectedValue(new Error("Unauthorized"));

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.getSnapshot).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  });
});
