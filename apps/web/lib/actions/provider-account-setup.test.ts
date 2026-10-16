import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), progress: vi.fn(), firstRun: vi.fn(), create: vi.fn(), update: vi.fn(), finalize: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { platformSetupProgress: { updateMany: mocks.update } } }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: mocks.guard }));
vi.mock("./setup-progress", () => ({ getSetupProgress: mocks.progress, isFirstRun: mocks.firstRun, createSetupProgress: mocks.create }));
vi.mock("@/lib/onboarding/setup-progress-service.server", () => ({ finalizeSetupCompletion: mocks.finalize }));
import { completeProviderAccountSetup, getProviderAccountSetupState } from "./provider-account-setup";
const progress = { id: "setup-one", updatedAt: new Date("2026-10-01"), organizationId: null, currentStep: "business-context", steps: { "account-bootstrap": "completed", "business-context": "pending", "ai-providers": "pending" } };
beforeEach(() => { vi.resetAllMocks(); mocks.guard.mockResolvedValue({ userId: "operator" }); mocks.progress.mockResolvedValue(progress); mocks.firstRun.mockResolvedValue(true); mocks.create.mockResolvedValue(progress); mocks.update.mockResolvedValue({ count: 1 }); });
describe("provider selection setup", () => {
  it("retains Local-only completion independently of remote account count and unfinished business setup", async () => {
    expect(await getProviderAccountSetupState()).toEqual({ showCatalog: true });
    expect(await completeProviderAccountSetup()).toEqual({ ok: true });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "setup-one", updatedAt: progress.updatedAt, completedAt: null },
      data: { currentStep: "business-context", steps: { "account-bootstrap": "completed", "business-context": "pending", "ai-providers": "completed" } } });
    expect(mocks.finalize).not.toHaveBeenCalled();
    mocks.progress.mockResolvedValue({ ...progress, steps: { ...progress.steps, "ai-providers": "completed" } });
    expect(await getProviderAccountSetupState()).toEqual({ showCatalog: false });
  });
  it("does not reopen skipped or completed provider selection", async () => {
    for (const status of ["completed", "skipped"]) {
      mocks.progress.mockResolvedValue({ ...progress, steps: { "ai-providers": status } });
      expect(await getProviderAccountSetupState()).toEqual({ showCatalog: false });
      expect(await completeProviderAccountSetup()).toEqual({ ok: true });
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("requires capability and refuses a concurrent setup replacement", async () => {
    mocks.guard.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(completeProviderAccountSetup()).rejects.toThrow("Unauthorized");
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.update.mockResolvedValueOnce({ count: 0 });
    expect(await completeProviderAccountSetup()).toEqual({ ok: false, error: "Setup changed. Refresh and retry." });
  });
  it("does not create onboarding again on an existing install", async () => {
    mocks.progress.mockResolvedValue(null); mocks.firstRun.mockResolvedValue(false);
    expect(await getProviderAccountSetupState()).toEqual({ showCatalog: false });
    expect(await completeProviderAccountSetup()).toEqual({ ok: true });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
