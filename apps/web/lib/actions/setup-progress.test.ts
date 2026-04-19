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
      findFirst: vi.fn(),
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
  getSetupContext,
  updateSetupContext,
} from "./setup-progress";
import { SETUP_STEPS } from "./setup-constants";

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
      (prisma.organization.findFirst as any).mockResolvedValue(null);
      expect(await isFirstRun()).toBe(false);
    });

    it("returns false when a completed setup exists", async () => {
      (prisma.organization.count as any).mockResolvedValue(0);
      (prisma.organization.findFirst as any).mockResolvedValue(null);
      (prisma.platformSetupProgress.findFirst as any).mockResolvedValue({
        completedAt: new Date(),
      });
      expect(await isFirstRun()).toBe(false);
    });

    it("treats an unlinked bootstrap platform org as still first-run", async () => {
      (prisma.organization.count as any).mockResolvedValue(1);
      (prisma.organization.findFirst as any).mockResolvedValue({ id: "bootstrap-org" });
      (prisma.platformSetupProgress.findFirst as any).mockResolvedValue(null);

      expect(await isFirstRun()).toBe(true);
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
          currentStep: "account-bootstrap",
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
        currentStep: "account-bootstrap",
        steps: Object.fromEntries(SETUP_STEPS.map((s) => [s, "pending"])),
        context: {},
      };
      (prisma.platformSetupProgress.findUniqueOrThrow as any).mockResolvedValue(mockProgress);
      (prisma.platformSetupProgress.update as any).mockResolvedValue({
        ...mockProgress,
        currentStep: "ai-providers",
      });

      await advanceStep("test-id", { orgName: "Test Co" });

      expect(prisma.platformSetupProgress.update).toHaveBeenCalledWith({
        where: { id: "test-id" },
        data: expect.objectContaining({
          currentStep: "ai-providers",
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
        currentStep: "business-context",
      });

      await skipStep("test-id");

      const updateCall = (prisma.platformSetupProgress.update as any).mock.calls[0][0];
      expect(updateCall.data.steps.branding).toBe("skipped");
    });
  });

  describe("getSetupContext", () => {
    it("returns null when no active setup record exists", async () => {
      (prisma.platformSetupProgress.findFirst as any).mockResolvedValue(null);
      expect(await getSetupContext()).toBeNull();
    });

    it("returns the context object from the active setup record", async () => {
      (prisma.platformSetupProgress.findFirst as any).mockResolvedValue({
        context: { orgName: "Acme Ltd", suggestedCurrency: "EUR" },
      });
      const ctx = await getSetupContext();
      expect(ctx?.orgName).toBe("Acme Ltd");
      expect(ctx?.suggestedCurrency).toBe("EUR");
    });
  });

  describe("updateSetupContext", () => {
    it("is a no-op when no active setup record exists", async () => {
      (prisma.platformSetupProgress.findFirst as any).mockResolvedValue(null);
      await updateSetupContext({ suggestedCurrency: "AUD" });
      expect(prisma.platformSetupProgress.update).not.toHaveBeenCalled();
    });

    it("merges the patch into the existing context without overwriting other keys", async () => {
      (prisma.platformSetupProgress.findFirst as any).mockResolvedValue({
        id: "test-id",
        context: { orgName: "Acme Ltd", suggestedCurrency: "GBP" },
      });
      (prisma.platformSetupProgress.update as any).mockResolvedValue({});

      await updateSetupContext({ suggestedCurrency: "EUR", suggestedCountryCode: "DE" });

      const updateCall = (prisma.platformSetupProgress.update as any).mock.calls[0][0];
      expect(updateCall.data.context).toEqual({
        orgName: "Acme Ltd",
        suggestedCurrency: "EUR",
        suggestedCountryCode: "DE",
      });
    });
  });
});
