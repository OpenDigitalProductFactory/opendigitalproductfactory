import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("./agent-routing", () => ({
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

import { resolveAgentForRoute } from "./agent-routing";
import { loadPrompt } from "./prompt-loader";
import { getSkillsForAgentLegacy } from "@/lib/actions/agent-skills";
import { ensureAgentPrincipalIdentity } from "@/lib/identity/principal-linking";
import { resolveAgentForRouteWithPrompts } from "./agent-routing-server";

describe("resolveAgentForRouteWithPrompts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
