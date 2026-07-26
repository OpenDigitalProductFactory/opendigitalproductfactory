import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

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

vi.mock("@/lib/coworker-identity", () => ({
  resolveCoworkerIdentity: vi.fn(),
}));

import {
  coworkerIdFromRecordRoute,
  resolveAgentForRoute,
} from "./agent-routing";
import { loadPrompt } from "./prompt-loader";
import { getSkillsForAgentLegacy } from "@/lib/actions/agent-skills";
import { ensureAgentPrincipalIdentity } from "@/lib/identity/principal-linking";
import { resolveCoworkerIdentity } from "@/lib/coworker-identity";
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
    vi.mocked(resolveCoworkerIdentity).mockReturnValue({
      agentId: "external-catalog-scout",
      agentName: "external-catalog-scout",
      displayName: "External Catalog Scout",
      aliases: ["hive-scout"],
    });
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
});
