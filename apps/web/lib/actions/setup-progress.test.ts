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
    storefrontConfig: {
      findFirst: vi.fn(),
    },
  },
  projectArchetypeSupply: vi.fn(),
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
        currentStep: "business-context",
      });

      await advanceStep("test-id", { orgName: "Test Co" });

      expect(prisma.platformSetupProgress.update).toHaveBeenCalledWith({
        where: { id: "test-id" },
        data: expect.objectContaining({
          currentStep: "business-context",
        }),
      });
    });

    it("blocks advancing past the storefront step until a StorefrontConfig exists", async () => {
      const mockProgress = {
        id: "test-id",
        organizationId: "org-1",
        currentStep: "storefront",
        steps: Object.fromEntries(
          SETUP_STEPS.map((step) => [
            step,
            SETUP_STEPS.indexOf(step) < SETUP_STEPS.indexOf("storefront")
              ? "completed"
              : "pending",
          ]),
        ),
        context: {},
      };
      (prisma.platformSetupProgress.findUniqueOrThrow as any).mockResolvedValue(mockProgress);
      (prisma.storefrontConfig.findFirst as any).mockResolvedValue(null);

      const result = await advanceStep("test-id");

      expect((result as { blocked?: string }).blocked).toBe("storefront-required");
      expect(prisma.platformSetupProgress.update).not.toHaveBeenCalled();
    });

    it("advances past the storefront step once a StorefrontConfig exists", async () => {
      const mockProgress = {
        id: "test-id",
        organizationId: "org-1",
        currentStep: "storefront",
        steps: Object.fromEntries(
          SETUP_STEPS.map((step) => [
            step,
            SETUP_STEPS.indexOf(step) < SETUP_STEPS.indexOf("storefront")
              ? "completed"
              : "pending",
          ]),
        ),
        context: {},
      };
      (prisma.platformSetupProgress.findUniqueOrThrow as any).mockResolvedValue(mockProgress);
      (prisma.storefrontConfig.findFirst as any).mockResolvedValue({ id: "sf-1" });
      (prisma.platformSetupProgress.update as any).mockResolvedValue({
        ...mockProgress,
        currentStep: "platform-development",
      });

      await advanceStep("test-id");

      expect(prisma.storefrontConfig.findFirst).toHaveBeenCalledWith({
        where: { organizationId: "org-1" },
        select: { id: true },
      });
      expect(prisma.platformSetupProgress.update).toHaveBeenCalledWith({
        where: { id: "test-id" },
        data: expect.objectContaining({ currentStep: "platform-development" }),
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

    // BI-575F0046 Slice 2: readiness is computed live rather than read from the
    // stored blob, because a stored answer goes stale the moment the owner
    // connects a provider or completes its trust review.
    it("computes cloud readiness live, not from the stored context", async () => {
      (prisma.platformSetupProgress.findFirst as any).mockResolvedValue({
        context: { orgName: "Acme Ltd", cloudProviderReadiness: "ready" },
      });
      (prisma as any).modelProvider = {
        findMany: async () => [
          { providerId: "chatgpt", name: "ChatGPT", status: "active", sensitivityClearance: ["public"] },
        ],
      };

      expect((await getSetupContext())?.cloudProviderReadiness).toBe("public-only");
    });

    it("says it does not know rather than guessing when providers cannot be read", async () => {
      (prisma.platformSetupProgress.findFirst as any).mockResolvedValue({
        context: { orgName: "Acme Ltd" },
      });
      (prisma as any).modelProvider = {
        findMany: async () => { throw new Error("db down"); },
      };

      expect((await getSetupContext())?.cloudProviderReadiness).toBeUndefined();
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
