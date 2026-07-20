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
    agentModelConfig: {
      upsert: vi.fn(),
    },
    agentToolGrant: {
      upsert: vi.fn(),
      createMany: vi.fn(),
    },
    agentToolGrantRevocation: {
      findMany: vi.fn().mockResolvedValue([]),
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

vi.mock("../identity/principal-linking", () => ({
  syncAgentPrincipal: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { checkBootstrapNeeded, seedOnboardingAgent } from "./bootstrap-first-run";
import { isFirstRun } from "../actions/setup-progress";
import { syncAgentPrincipal } from "../identity/principal-linking";

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
    it("upserts the onboarding-coo agent and configures capability-based routing", async () => {
      (prisma.agent.upsert as any).mockResolvedValue({
        id: "cuid-onboarding-coo",
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
            delegatesTo: ["AGT-902"],
          }),
          update: expect.objectContaining({
            delegatesTo: ["AGT-902"],
          }),
        }),
      );
      expect(prisma.agentModelConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { agentId: "onboarding-coo" },
          create: expect.objectContaining({
            minimumTier: "strong",
            budgetClass: "minimize_cost",
            minimumCapabilities: { toolUse: true },
          }),
          update: expect.objectContaining({
            pinnedProviderId: null,
          }),
        }),
      );
      expect(syncAgentPrincipal).toHaveBeenCalledWith("onboarding-coo");
    });

    // BI-25A1ADF7: the tool grants must be seeded via a single race-safe
    // createMany({ skipDuplicates }) — not a per-grant upsert loop that races
    // the (agentId, grantKey) composite unique on concurrent cold-install runs.
    it("seeds tool grants via a single idempotent createMany with skipDuplicates", async () => {
      (prisma.agent.upsert as any).mockResolvedValue({ id: "cuid-coo", agentId: "onboarding-coo" });
      (prisma.agentModelConfig.upsert as any).mockResolvedValue({ agentId: "onboarding-coo" });
      await seedOnboardingAgent();
      expect(prisma.agentToolGrant.upsert).not.toHaveBeenCalled();
      expect(prisma.agentToolGrant.createMany).toHaveBeenCalledTimes(1);
      const arg = (prisma.agentToolGrant.createMany as any).mock.calls[0][0];
      expect(arg.skipDuplicates).toBe(true);
      expect(arg.data).toEqual(
        expect.arrayContaining([
          { agentId: "cuid-coo", grantKey: "registry_write" },
          { agentId: "cuid-coo", grantKey: "email_config" },
          { agentId: "cuid-coo", grantKey: "thread_write" },
        ]),
      );
      // Every row is scoped to the resolved agent PK (not the semantic agentId).
      for (const row of arg.data) expect(row.agentId).toBe("cuid-coo");
    });

    it("omits revoked grants (BI-4FA040D5 tombstones) from the createMany insert", async () => {
      (prisma.agent.upsert as any).mockResolvedValue({ id: "cuid-coo", agentId: "onboarding-coo" });
      (prisma.agentModelConfig.upsert as any).mockResolvedValue({ agentId: "onboarding-coo" });
      (prisma.agentToolGrantRevocation.findMany as any).mockResolvedValueOnce([
        { grantKey: "web_search" },
      ]);
      await seedOnboardingAgent();
      const arg = (prisma.agentToolGrant.createMany as any).mock.calls[0][0];
      expect(arg.data.map((r: { grantKey: string }) => r.grantKey)).not.toContain("web_search");
      expect(arg.data.map((r: { grantKey: string }) => r.grantKey)).toContain("file_read");
    });
  });
});
