import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: { platformDevConfig: { upsert: vi.fn() } },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: vi.fn() }));
vi.mock("@/lib/forge/managed-repository-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forge/managed-repository-access")>()),
  loadManagedRepositoryStatus: vi.fn(),
  invalidateManagedRepositoryStatus: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { requireCapability } from "@/lib/actions/shared/guards";
import { invalidateManagedRepositoryStatus, loadManagedRepositoryStatus } from "@/lib/forge/managed-repository-access";
import { checkManagedRepository, saveManagedRepository } from "./managed-repository";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCapability).mockResolvedValue({ userId: "user-1" });
});

describe("saveManagedRepository", () => {
  it("is gated by manage_platform", async () => {
    vi.mocked(requireCapability).mockRejectedValueOnce(new Error("Unauthorized"));
    expect(await saveManagedRepository("acme/widgets")).toEqual({ ok: false, error: "Unauthorized" });
    expect(requireCapability).toHaveBeenCalledWith("manage_platform");
    expect(prisma.platformDevConfig.upsert).not.toHaveBeenCalled();
  });

  it("refuses input that is not a GitHub repository", async () => {
    const result = await saveManagedRepository("https://gitlab.com/acme/widgets");
    expect(result.ok).toBe(false);
    expect(prisma.platformDevConfig.upsert).not.toHaveBeenCalled();
  });

  it("writes the explicit repository to upstreamRemoteUrl without recording a contribution decision", async () => {
    const result = await saveManagedRepository(" acme/widgets ");

    expect(result).toEqual({ ok: true, data: { fullName: "acme/widgets" } });
    expect(prisma.platformDevConfig.upsert).toHaveBeenCalledWith({
      where: { id: "singleton" },
      update: { upstreamRemoteUrl: "https://github.com/acme/widgets.git" },
      create: { id: "singleton", contributionMode: "private", upstreamRemoteUrl: "https://github.com/acme/widgets.git" },
    });
    const call = vi.mocked(prisma.platformDevConfig.upsert).mock.calls[0]![0];
    expect(call.create).not.toHaveProperty("configuredById");
    expect(invalidateManagedRepositoryStatus).toHaveBeenCalled();
  });
});

describe("checkManagedRepository", () => {
  it("forces a fresh check", async () => {
    const view = { repository: null, status: "not-connected" as const, checkedAt: "2026-10-14T00:00:00.000Z", lastAnsweredAt: null };
    vi.mocked(loadManagedRepositoryStatus).mockResolvedValueOnce(view);
    expect(await checkManagedRepository()).toEqual({ ok: true, data: view });
    expect(loadManagedRepositoryStatus).toHaveBeenCalledWith(prisma, { force: true });
  });

  it("is gated by manage_platform", async () => {
    vi.mocked(requireCapability).mockRejectedValueOnce(new Error("Unauthorized"));
    expect(await checkManagedRepository()).toEqual({ ok: false, error: "Unauthorized" });
    expect(loadManagedRepositoryStatus).not.toHaveBeenCalled();
  });
});
