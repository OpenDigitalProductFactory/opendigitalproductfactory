import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    aiProviderConnection: { updateMany: vi.fn() },
  },
}));

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));

import { reconcileProviderConnectionState } from "./provider-connection-reconcile";

describe("reconcileProviderConnectionState (BI-04E4F111)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("heals only disabled default connections behind an active provider", async () => {
    mockPrisma.aiProviderConnection.updateMany.mockResolvedValue({ count: 2 });

    const result = await reconcileProviderConnectionState();

    expect(result.healed).toBe(2);
    expect(mockPrisma.aiProviderConnection.updateMany).toHaveBeenCalledWith({
      where: {
        status: "disabled",
        connectionId: { startsWith: "provider-default-" },
        provider: { status: "active" },
      },
      data: { status: "active" },
    });
  });

  it("reports zero healed when the split state does not exist", async () => {
    mockPrisma.aiProviderConnection.updateMany.mockResolvedValue({ count: 0 });
    const result = await reconcileProviderConnectionState();
    expect(result.healed).toBe(0);
  });
});
