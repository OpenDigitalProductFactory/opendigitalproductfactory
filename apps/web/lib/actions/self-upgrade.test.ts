import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    selfUpgradeRun: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/config", () => ({
  getSelfUpgradeConfig: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/version", () => ({
  getUpgradeVersionState: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/request", () => ({
  requestSelfUpgrade: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { requestSelfUpgrade } from "@/lib/self-upgrade/request";
import { requestPortalSelfUpgradeAction } from "./self-upgrade";

describe("requestPortalSelfUpgradeAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "user-ops-1",
        platformRole: "owner",
        isSuperuser: true,
      },
    } as never);
    vi.mocked(can).mockReturnValue(true);
    vi.mocked(requestSelfUpgrade).mockResolvedValue({
      success: true,
      status: "queued",
      runId: "SUR-QUEUED1",
      triggeredBy: "manual:user-ops-1",
      eventIds: ["evt-1"],
    } as never);
  });

  it("delegates to the shared request service as a human manual trigger", async () => {
    await requestPortalSelfUpgradeAction();

    expect(requestSelfUpgrade).toHaveBeenCalledWith({
      requestedBy: "manual:user-ops-1",
      actorKind: "human",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/ops/self-upgrade");
  });

  it.each(["running", "queued", "pending"])(
    "delegates duplicate suppression to the shared service when latest run is %s",
    async (status) => {
      vi.mocked(requestSelfUpgrade).mockResolvedValueOnce({
        success: true,
        status: "already_active",
        runId: "SUR-ACTIVE1",
      } as never);

      await requestPortalSelfUpgradeAction();

      expect(requestSelfUpgrade).toHaveBeenCalledWith({
        requestedBy: "manual:user-ops-1",
        actorKind: "human",
      });
      expect(revalidatePath).toHaveBeenCalledWith("/ops/self-upgrade");
    },
  );

  it("still revalidates when the shared request service reports dispatch failure", async () => {
    vi.mocked(requestSelfUpgrade).mockResolvedValueOnce({
      success: false,
      status: "dispatch_failed",
      runId: "SUR-QUEUED1",
      message: "queue-dispatch-failed: inngest offline",
    } as never);

    await requestPortalSelfUpgradeAction();

    expect(requestSelfUpgrade).toHaveBeenCalledWith({
      requestedBy: "manual:user-ops-1",
      actorKind: "human",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/ops/self-upgrade");
  });
});
