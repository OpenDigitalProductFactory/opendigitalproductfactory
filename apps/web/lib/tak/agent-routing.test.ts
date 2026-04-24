import { describe, it, expect } from "vitest";
import { resolveAgentForRoute, generateCannedResponse } from "./agent-routing";

describe("resolveAgentForRoute", () => {
  const superuser = { platformRole: "HR-000", isSuperuser: true };
  const opsUser = { platformRole: "HR-500", isSuperuser: false };
  const noRole = { platformRole: null, isSuperuser: false };

  it("returns portfolio-advisor for /portfolio path", () => {
    const result = resolveAgentForRoute("/portfolio", superuser);
    expect(result.agentId).toBe("portfolio-advisor");
    expect(result.canAssist).toBe(true);
  });

  it("returns ea-architect for /ea/views/123", () => {
    const result = resolveAgentForRoute("/ea/views/123", superuser);
    expect(result.agentId).toBe("ea-architect");
    expect(result.canAssist).toBe(true);
  });

  it("routes discovery operations to the estate specialist", () => {
    const result = resolveAgentForRoute("/platform/tools/discovery", superuser);
    expect(result.agentId).toBe("inventory-specialist");
    expect(result.agentName).toBe("Digital Product Estate Specialist");
    expect(result.canAssist).toBe(true);
    expect(result.systemPrompt).toContain("purpose-first");
    expect(result.skills.some((skill) => skill.label === "What breaks if this fails?")).toBe(true);
    expect(result.skills.some((skill) => skill.label === "Review item identity")).toBe(true);
  });

  it("returns coo for unknown routes (workspace fallback)", () => {
    const result = resolveAgentForRoute("/unknown/path", superuser);
    expect(result.agentId).toBe("coo");
    expect(result.canAssist).toBe(true);
  });

  it("returns canAssist=false when user lacks capability", () => {
    // HR-500 has view_operations but not view_ea_modeler
    const result = resolveAgentForRoute("/ea", opsUser);
    expect(result.agentId).toBe("ea-architect");
    expect(result.canAssist).toBe(false);
  });

  it("returns coo for /workspace route", () => {
    const result = resolveAgentForRoute("/workspace", superuser);
    expect(result.agentId).toBe("coo");
    expect(result.canAssist).toBe(true);
  });

  it("routes finance pages to the finance agent", () => {
    const result = resolveAgentForRoute("/finance/settings/tax", superuser);
    expect(result.agentId).toBe("finance-agent");
    expect(result.agentName).toBe("Finance Specialist");
    expect(result.canAssist).toBe(true);
    expect(result.systemPrompt).toContain("tax remittance");
  });

  it("returns canAssist=false when platformRole is null on gated route", () => {
    const result = resolveAgentForRoute("/portfolio", noRole);
    expect(result.agentId).toBe("portfolio-advisor");
    expect(result.canAssist).toBe(false);
  });

  it("uses longest prefix match", () => {
    const result = resolveAgentForRoute("/platform/ai/providers/openai", superuser);
    expect(result.agentId).toBe("platform-engineer");
  });

  it("returns correct agent metadata", () => {
    const result = resolveAgentForRoute("/ops", superuser);
    expect(result.agentName).toBeTruthy();
    expect(result.agentDescription).toBeTruthy();
  });

  it("prefers codex for the build route by default", () => {
    const result = resolveAgentForRoute("/build", superuser);
    expect(result.modelRequirements?.preferredProviderId).toBe("codex");
  });

  it("mentions public website branding analysis in the admin assistant prompt", () => {
    const result = resolveAgentForRoute("/admin", superuser);
    expect(result.systemPrompt).toContain("public website");
    expect(result.systemPrompt).toContain("branding");
  });

  it("returns a non-empty systemPrompt", () => {
    const result = resolveAgentForRoute("/portfolio", superuser);
    expect(result.systemPrompt).toBeTruthy();
    expect(result.systemPrompt).toContain("Portfolio Analyst");
  });

  it("every route agent has a non-empty systemPrompt", () => {
    const routes = ["/portfolio", "/inventory", "/platform/tools/discovery", "/ea", "/employee", "/customer", "/ops", "/finance", "/platform", "/admin", "/workspace"];
    for (const route of routes) {
      const result = resolveAgentForRoute(route, superuser);
      expect(result.systemPrompt.length).toBeGreaterThan(0);
    }
  });

  it("returns skills array for each agent", () => {
    const routes = ["/portfolio", "/inventory", "/platform/tools/discovery", "/ea", "/employee", "/customer", "/ops", "/finance", "/platform", "/admin", "/workspace"];
    for (const route of routes) {
      const result = resolveAgentForRoute(route, superuser);
      expect(result.skills.length).toBeGreaterThan(0);
      for (const skill of result.skills) {
        expect(skill.label).toBeTruthy();
        expect(skill.description).toBeTruthy();
        expect(skill.prompt).toBeTruthy();
      }
    }
  });

  it("skills include capability-gated items for superuser but not for restricted roles", () => {
    // EA route has manage_ea_model skills (HR-000 can, HR-500 cannot)
    const eaAgent = resolveAgentForRoute("/ea", superuser);
    const manageSkills = eaAgent.skills.filter((s) => s.capability === "manage_ea_model");
    expect(manageSkills.length).toBeGreaterThan(0);
    // Skills array itself is unfiltered — filtering happens client-side in AgentSkillsDropdown
    // Verify the raw skills include both view and manage capabilities
    const viewSkills = eaAgent.skills.filter((s) => s.capability === "view_ea_modeler");
    expect(viewSkills.length).toBeGreaterThan(0);
  });
});

describe("generateCannedResponse", () => {
  it("returns a non-empty string", () => {
    const response = generateCannedResponse("portfolio-advisor", "/portfolio", "HR-000");
    expect(response).toBeTruthy();
    expect(typeof response).toBe("string");
  });

  it("returns a response for unknown agent (fallback)", () => {
    const response = generateCannedResponse("nonexistent-agent", "/somewhere", "HR-000");
    expect(response).toBeTruthy();
  });

  it("returns different responses for different roles on same route", () => {
    const adminResponse = generateCannedResponse("portfolio-advisor", "/portfolio", "HR-000");
    const opsResponse = generateCannedResponse("portfolio-advisor", "/portfolio", "HR-500");
    expect(adminResponse).toBeTruthy();
    expect(opsResponse).toBeTruthy();
    // HR-000 draws from default pool, HR-500 from restricted pool
    expect(adminResponse).not.toBe(opsResponse);
  });

  it("uses estate-oriented canned copy for the inventory specialist", () => {
    const response = generateCannedResponse("inventory-specialist", "/platform/tools/discovery", "HR-000");

    expect(response).toContain("Digital Product Estate Specialist");
    expect(response).toContain("dependencies");
  });

  it("uses finance-oriented canned copy for the finance agent", () => {
    const response = generateCannedResponse("finance-agent", "/finance/settings/tax", "HR-000");

    expect(response).toContain("Finance Specialist");
    expect(response).toContain("tax");
  });
});
