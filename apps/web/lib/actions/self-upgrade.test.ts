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

vi.mock("@/lib/queue/inngest-client", () => ({
  inngest: {
    send: vi.fn(),
  },
}));

vi.mock("@/lib/queue/functions/self-upgrade", () => ({
  SELF_UPGRADE_EVENT: "ops/self-upgrade.run",
}));

vi.mock("@/lib/self-upgrade/config", () => ({
  getSelfUpgradeConfig: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/version", () => ({
  getUpgradeVersionState: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/run-store", () => ({
  createRun: vi.fn(),
  failRun: vi.fn(),
  getLatestRun: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { inngest } from "@/lib/queue/inngest-client";
import { createRun, failRun, getLatestRun } from "@/lib/self-upgrade/run-store";
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
    vi.mocked(getLatestRun).mockResolvedValue(null);
    vi.mocked(createRun).mockResolvedValue({
      runId: "SUR-QUEUED1",
      status: "queued",
    } as never);
  });

  it("creates a durable queued run before sending the worker event", async () => {
    await requestPortalSelfUpgradeAction();

    expect(createRun).toHaveBeenCalledWith({ triggeredBy: "manual:user-ops-1" });
    expect(inngest.send).toHaveBeenCalledWith({
      name: "ops/self-upgrade.run",
      data: {
        runId: "SUR-QUEUED1",
        triggeredBy: "manual:user-ops-1",
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/ops/self-upgrade");
  });

  it.each(["running", "queued", "pending"])(
    "does not dispatch a duplicate event while the latest run is %s",
    async (status) => {
      vi.mocked(getLatestRun).mockResolvedValue({
        runId: "SUR-ACTIVE1",
        status,
      } as never);

      await requestPortalSelfUpgradeAction();

      expect(createRun).not.toHaveBeenCalled();
      expect(inngest.send).not.toHaveBeenCalled();
      expect(revalidatePath).toHaveBeenCalledWith("/ops/self-upgrade");
    },
  );

  it("marks the queued run failed when event dispatch fails", async () => {
    vi.mocked(inngest.send).mockRejectedValueOnce(new Error("inngest offline"));

    await requestPortalSelfUpgradeAction();

    expect(failRun).toHaveBeenCalledWith(
      "SUR-QUEUED1",
      "queue-dispatch-failed: inngest offline",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/ops/self-upgrade");
  });
});
