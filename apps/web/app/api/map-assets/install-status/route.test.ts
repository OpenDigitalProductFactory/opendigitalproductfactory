import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), snapshot: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/twin/map-pack-install/status.server", () => ({ readInstallSnapshot: mocks.snapshot }));

import { GET } from "./route";

describe("GET /api/map-assets/install-status (BI-43BBCC26)", () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.snapshot.mockReset();
  });

  it("refuses anyone who is not signed in", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("refuses a user without manage_platform", async () => {
    mocks.auth.mockResolvedValue({ user: { platformRole: "HR-500", isSuperuser: false } });
    expect((await GET()).status).toBe(403);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("returns the uncached status projection to an administrator", async () => {
    mocks.auth.mockResolvedValue({ user: { platformRole: "HR-000", isSuperuser: true } });
    const snapshot = { status: { state: "downloading", packId: "us-kansas" }, running: true };
    mocks.snapshot.mockResolvedValue(snapshot);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual(snapshot);
  });
});
