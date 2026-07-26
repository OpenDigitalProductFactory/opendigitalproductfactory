import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@dpf/db", () => ({
  prisma: {
    agent: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("./agent-routing", () => ({
  coworkerIdFromRecordRoute: vi.fn(),
  resolveAgentForRoute: vi.fn(),
}));

vi.mock("./prompt-loader", () => ({
  loadPrompt: vi.fn(),
}));

vi.mock("@/lib/actions/agent-skills", () => ({
  getSkillsForAgentLegacy: vi.fn(),
}));

vi.mock("@/lib/identity/principal-linking", () => ({
  ensureAgentPrincipalIdentity: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));

vi.mock("@/lib/coworker-lifecycle/lifecycle-gate", () => ({
  evaluateLifecycleGate: vi.fn(),
}));

import { prisma } from "@dpf/db";
import {
  coworkerIdFromRecordRoute,
  resolveAgentForRoute,
} from "./agent-routing";
import { loadPrompt } from "./prompt-loader";
import { getSkillsForAgentLegacy } from "@/lib/actions/agent-skills";
import { ensureAgentPrincipalIdentity } from "@/lib/identity/principal-linking";
import { can } from "@/lib/permissions";
import { evaluateLifecycleGate } from "@/lib/coworker-lifecycle/lifecycle-gate";
import {
  resolveAgentByIdWithPrompts,
  resolveAgentForRouteWithPrompts,
} from "./agent-routing-server";

describe("resolveAgentForRouteWithPrompts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coworkerIdFromRecordRoute).mockReturnValue(null);
    vi.mocked(resolveAgentForRoute).mockReturnValue({
      agentId: "hr-specialist",
      agentName: "HR Specialist",
      agentDescription: "HR support",
      canAssist: true,
      sensitivity: "restricted",
      systemPrompt: "Built-in prompt",
      skills: [{ label: "Help", description: "Assist", capability: null, prompt: "Assist" }],
    });
    vi.mocked(getSkillsForAgentLegacy).mockResolvedValue([]);
    vi.mocked(loadPrompt).mockImplementation(async (_kind: string, key: string, fallback?: string) => {
      if (key === "identity-block") return "Identity block";
      if (key === "platform-preamble") return "Platform preamble";
      if (key === "company-mission") return "Company mission";
      return fallback ?? "";
    });
    vi.mocked(can).mockReturnValue(true);
    vi.mocked(prisma.agent.findFirst).mockResolvedValue({
      agentId: "AGT-WS-SCOUT",
      slugId: "external-catalog-scout",
      displayName: "External Catalog Scout",
      name: "External Catalog Scout",
      description: "Researches external providers.",
      sensitivity: "internal",
    });
    vi.mocked(evaluateLifecycleGate).mockResolvedValue({ allowed: true });
    vi.mocked(ensureAgentPrincipalIdentity).mockResolvedValue(null);
  });

  it("ensures the routed agent has a principal identity before returning it", async () => {
    const result = await resolveAgentForRouteWithPrompts("/employee", {
      platformRole: "HR-100",
      isSuperuser: false,
    });

    expect(ensureAgentPrincipalIdentity).toHaveBeenCalledWith("hr-specialist");
    expect(result.agentId).toBe("hr-specialist");
  });

  it("can resolve a scheduled agent directly by agentId when the route persona does not match", async () => {
    vi.mocked(getSkillsForAgentLegacy).mockResolvedValue([
      {
        label: "Scout external catalogs",
        description: "Scan external catalogs",
        capability: null,
        prompt: "Run the scout.",
      },
    ]);

    const result = await resolveAgentByIdWithPrompts("external-catalog-scout", {
      platformRole: "HR-000",
      isSuperuser: true,
    });

    expect(ensureAgentPrincipalIdentity).toHaveBeenCalledWith("external-catalog-scout");
    expect(loadPrompt).toHaveBeenCalledWith(
      "route-persona",
      "external-catalog-scout",
      expect.stringContaining("External Catalog Scout"),
    );
    expect(result.agentId).toBe("external-catalog-scout");
    expect(result.agentName).toBe("External Catalog Scout");
    expect(result.skills).toEqual([
      {
        label: "Scout external catalogs",
        description: "Scan external catalogs",
        capability: null,
        prompt: "Run the scout.",
      },
    ]);
  });

  it("loads the selected coworker for a coworker record route", async () => {
    vi.mocked(coworkerIdFromRecordRoute).mockReturnValue(
      "external-catalog-scout",
    );

    const result = await resolveAgentForRouteWithPrompts(
      "/platform/ai/agent/external-catalog-scout",
      {
        platformRole: "HR-000",
        isSuperuser: true,
      },
    );

    expect(resolveAgentForRoute).not.toHaveBeenCalled();
    expect(ensureAgentPrincipalIdentity).toHaveBeenCalledWith(
      "external-catalog-scout",
    );
    expect(result.agentId).toBe("external-catalog-scout");
    expect(result.agentName).toBe("External Catalog Scout");
  });

  it("does not create a principal for an unknown or archived coworker", async () => {
    vi.mocked(prisma.agent.findFirst).mockResolvedValue(null);

    const result = await resolveAgentByIdWithPrompts("missing-coworker", {
      platformRole: "HR-000",
      isSuperuser: true,
    });

    expect(result.canAssist).toBe(false);
    expect(ensureAgentPrincipalIdentity).not.toHaveBeenCalled();
    expect(getSkillsForAgentLegacy).not.toHaveBeenCalled();
  });

  it("does not load or provision a coworker blocked by lifecycle", async () => {
    vi.mocked(evaluateLifecycleGate).mockResolvedValue({
      allowed: false,
      agentId: "AGT-WS-SCOUT",
      stage: "draft",
      certification: null,
      reason: "Draft coworkers cannot be summoned.",
    });

    const result = await resolveAgentByIdWithPrompts(
      "external-catalog-scout",
      {
        platformRole: "HR-000",
        isSuperuser: true,
      },
    );

    expect(result.canAssist).toBe(false);
    expect(ensureAgentPrincipalIdentity).not.toHaveBeenCalled();
  });

  it("does not disclose or provision a selected coworker without platform access", async () => {
    vi.mocked(can).mockReturnValue(false);

    const result = await resolveAgentByIdWithPrompts(
      "external-catalog-scout",
      {
        platformRole: null,
        isSuperuser: false,
      },
    );

    expect(result.canAssist).toBe(false);
    expect(prisma.agent.findFirst).not.toHaveBeenCalled();
    expect(ensureAgentPrincipalIdentity).not.toHaveBeenCalled();
  });
});
