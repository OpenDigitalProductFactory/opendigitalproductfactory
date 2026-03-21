import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    platformSetupProgress: {
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    organization: {
      count: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import {
  isFirstRun,
  getSetupProgress,
  createSetupProgress,
  advanceStep,
  skipStep,
  pauseSetup,
  completeSetup,
  SETUP_STEPS,
} from "./setup-progress";

describe("setup-progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isFirstRun", () => {
    it("returns true when no org and no completed setup exist", async () => {
      (prisma.organization.count as any).mockResolvedValue(0);
      (prisma.platformSetupProgress.findFirst as any).mockResolvedValue(null);
      expect(await isFirstRun()).toBe(true);
    });

    it("returns false when an org exists", async () => {
      (prisma.organization.count as any).mockResolvedValue(1);
      expect(await isFirstRun()).toBe(false);
    });

    it("returns false when a completed setup exists", async () => {
      (prisma.organization.count as any).mockResolvedValue(0);
      (prisma.platformSetupProgress.findFirst as any).mockResolvedValue({
        completedAt: new Date(),
      });
      expect(await isFirstRun()).toBe(false);
    });
  });

  describe("createSetupProgress", () => {
    it("creates record with all steps pending", async () => {
      (prisma.platformSetupProgress.create as any).mockResolvedValue({
        id: "test-id",
        currentStep: "business-identity",
      });
      const result = await createSetupProgress();
      expect(prisma.platformSetupProgress.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          currentStep: "business-identity",
          steps: expect.any(Object),
          context: {},
        }),
      });
      expect(result.id).toBe("test-id");
    });
  });

  describe("advanceStep", () => {
    it("marks current step completed and moves to next", async () => {
      const mockProgress = {
        id: "test-id",
        currentStep: "business-identity",
        steps: Object.fromEntries(SETUP_STEPS.map((s) => [s, "pending"])),
        context: {},
      };
      (prisma.platformSetupProgress.findUniqueOrThrow as any).mockResolvedValue(mockProgress);
      (prisma.platformSetupProgress.update as any).mockResolvedValue({
        ...mockProgress,
        currentStep: "owner-account",
      });

      await advanceStep("test-id", { orgName: "Test Co" });

      expect(prisma.platformSetupProgress.update).toHaveBeenCalledWith({
        where: { id: "test-id" },
        data: expect.objectContaining({
          currentStep: "owner-account",
        }),
      });
    });
  });

  describe("skipStep", () => {
    it("marks current step skipped and moves to next", async () => {
      const mockProgress = {
        id: "test-id",
        currentStep: "branding",
        steps: Object.fromEntries(SETUP_STEPS.map((s) => [s, "pending"])),
        context: {},
      };
      (prisma.platformSetupProgress.findUniqueOrThrow as any).mockResolvedValue(mockProgress);
      (prisma.platformSetupProgress.update as any).mockResolvedValue({
        ...mockProgress,
        currentStep: "financial-basics",
      });

      await skipStep("test-id");

      const updateCall = (prisma.platformSetupProgress.update as any).mock.calls[0][0];
      expect(updateCall.data.steps.branding).toBe("skipped");
    });
  });
});
