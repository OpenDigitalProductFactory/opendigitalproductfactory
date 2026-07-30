import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  can: vi.fn(),
  getSelfUpgradeStatus: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/permissions", () => ({ can: mocks.can }));
vi.mock("@/lib/actions/promotions", () => ({
  getSelfUpgradeStatus: mocks.getSelfUpgradeStatus,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({
    user: { platformRole: "admin", isSuperuser: false },
  });
  mocks.can.mockReturnValue(true);
  mocks.getSelfUpgradeStatus.mockResolvedValue({
    enabled: true,
    isFresh: false,
    targetSha: "target",
    latestRun: null,
    jobEngine: { healthy: true },
    windowSource: "operating-hours",
  });
});

describe("GET /api/ops/self-upgrade/purpose-state", () => {
  it("returns an independently resolved state oracle", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      routePath: "/ops/self-upgrade",
      stateKey: "update-available",
      sourceRef: "apps/web/lib/self-upgrade/purpose-scenario.ts",
    });
  });

  it("fails closed without operations permission", async () => {
    mocks.can.mockReturnValue(false);

    const response = await GET();

    expect(response.status).toBe(403);
  });
});
