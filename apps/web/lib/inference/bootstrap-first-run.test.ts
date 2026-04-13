import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    modelProvider: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    agent: {
      upsert: vi.fn(),
    },
    platformSetupProgress: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    organization: {
      count: vi.fn(),
    },
  },
}));

vi.mock("./ollama", () => ({
  checkBundledProviders: vi.fn(),
}));

vi.mock("../actions/setup-progress", () => ({
  isFirstRun: vi.fn(),
  createSetupProgress: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { checkBootstrapNeeded, seedOnboardingAgent } from "./bootstrap-first-run";
import { isFirstRun } from "../actions/setup-progress";

describe("bootstrap-first-run", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe("checkBootstrapNeeded", () => {
    it("returns true when isFirstRun is true", async () => {
      (isFirstRun as any).mockResolvedValue(true);
      expect(await checkBootstrapNeeded()).toBe(true);
    });

    it("returns false when isFirstRun is false", async () => {
      (isFirstRun as any).mockResolvedValue(false);
      expect(await checkBootstrapNeeded()).toBe(false);
    });
  });

  describe("seedOnboardingAgent", () => {
    it("upserts the onboarding-coo agent and pins provider via AgentModelConfig", async () => {
      (prisma.agent.upsert as any).mockResolvedValue({
        agentId: "onboarding-coo",
      });
      (prisma.agentModelConfig.upsert as any).mockResolvedValue({
        agentId: "onboarding-coo",
      });
      await seedOnboardingAgent();
      expect(prisma.agent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { agentId: "onboarding-coo" },
          create: expect.objectContaining({
            agentId: "onboarding-coo",
            name: "Onboarding COO",
            type: "onboarding",
            tier: 1,
          }),
        }),
      );
      expect(prisma.agentModelConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { agentId: "onboarding-coo" },
          create: expect.objectContaining({
            pinnedProviderId: "local",
          }),
        }),
      );
    });
  });
});
