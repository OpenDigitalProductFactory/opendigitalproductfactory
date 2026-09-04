import { describe, it, expect } from "vitest";
import { generateCannedResponse, resolveAgentForRoute } from "./agent-routing";

// High-risk route/agent/tool/QA-ID summary coverage lives in
// apps/web/lib/testing/route-contracts.test.ts. Keep the role-conditional
// access assertions here so the matrix does not flatten route permission
// behavior into a single superuser-only view.
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

  it("binds the internal leave-decision context to the propose-only Time-off Advisor", () => {
    const result = resolveAgentForRoute("/coworker/leave-decision", superuser);
    expect(result.agentId).toBe("time-off-advisor");
    expect(result.agentName).toBe("Time-off Advisor");
    expect(result.sensitivity).toBe("confidential");
    expect(result.systemPrompt).toContain("never approve or reject");
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

  it("uses the selected coworker on a coworker record route", () => {
    const result = resolveAgentForRoute(
      "/platform/ai/agent/customer-advisor",
      superuser,
    );

    expect(result.agentId).toBe("customer-advisor");
    expect(result.agentName).toBe("Customer Advisor");
    expect(result.canAssist).toBe(true);
  });

  it("does not bypass platform access for a selected coworker", () => {
    const result = resolveAgentForRoute(
      "/platform/ai/agent/customer-advisor",
      noRole,
    );

    expect(result.agentId).toBe("customer-advisor");
    expect(result.canAssist).toBe(false);
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

  it("routes authorized Performance questions to a metric-safe COO context", () => {
    const result = resolveAgentForRoute("/performance", opsUser);

    expect(result.agentId).toBe("coo");
    expect(result.canAssist).toBe(true);
    expect(result.systemPrompt).toContain("historical business performance");
    expect(result.systemPrompt).toContain("Never invent");
  });

  it("keeps the Software Engineer on /build and routes governed work to the Change Reviewer", () => {
    const build = resolveAgentForRoute("/build", superuser);
    const work = resolveAgentForRoute("/build/work/WC-123", superuser);

    expect(build.agentId).toBe("build-specialist");
    expect(work.agentId).toBe("change-reviewer");
    expect(work.agentName).toBe("Change Reviewer");
    expect(work.sensitivity).toBe("confidential");
    expect(work.systemPrompt).toContain("You are not the author");
    expect(work.systemPrompt).toContain("cannot edit code");
  });

  it("routes finance pages to the finance agent", () => {
    const result = resolveAgentForRoute("/finance/settings/tax", superuser);
    expect(result.agentId).toBe("finance-agent");
    expect(result.agentName).toBe("Finance Specialist");
    expect(result.canAssist).toBe(true);
    expect(result.systemPrompt).toContain("tax remittance");
    expect(result.systemPrompt).toContain("handoff");
    expect(result.systemPrompt).toContain("one concrete next move");
    expect(result.systemPrompt).toContain("External Access");
    expect(result.systemPrompt).toContain("search_public_web");
    expect(result.systemPrompt).toContain("fetch_public_website");
    expect(result.systemPrompt).toContain("DPF tax processing proposal");
    expect(result.systemPrompt).toContain("get_finance_period_summary");
    expect(result.systemPrompt).toContain("browser-use");
    expect(result.systemPrompt).toContain("billing portal");
    expect(result.systemPrompt).toContain("queue the human ask");
    expect(result.skills.some((skill) => skill.label === "Income vs expenses this month")).toBe(true);
    expect(result.skills.some((skill) => skill.label === "Research tax processing proposal")).toBe(true);
    expect(result.skills.some((skill) => skill.label === "Retrieve billing portal costs")).toBe(true);
  });

  it("describes the finance specialist without forcing commercial billing or tax language", () => {
    const result = resolveAgentForRoute("/finance", superuser);
    expect(result.agentDescription).toBe("Money in, money out, cash position, reporting, and execution control");
    expect(result.agentDescription).not.toMatch(/recurring billing|tax remittance/i);
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

  it("routes /customer/marketing to the marketing specialist instead of the CRM advisor", () => {
    const result = resolveAgentForRoute("/customer/marketing/strategy", superuser);
    expect(result.agentId).toBe("marketing-specialist");
    expect(result.agentName).toBe("Marketing Strategist");
    expect(result.canAssist).toBe(true);
  });

  it("routes /compliance/licensing to the licensing specialist instead of the workspace COO", () => {
    const result = resolveAgentForRoute("/compliance/licensing", superuser);
    expect(result.agentId).toBe("licensing-specialist");
    expect(result.agentName).toBe("Licensing & Permit Specialist");
    expect(result.canAssist).toBe(true);
    expect(result.systemPrompt).toContain("jurisdictional readiness");
    expect(result.systemPrompt).toContain("Never guess legal facts");
    expect(result.modelRequirements?.preferredProviderId).toBe("anthropic");
  });

  it("keeps licensing route access gated by compliance permissions", () => {
    const result = resolveAgentForRoute("/compliance/licensing", noRole);
    expect(result.agentId).toBe("licensing-specialist");
    expect(result.canAssist).toBe(false);
  });

  it("gives the marketing specialist an operator lifecycle for persistent work", () => {
    const result = resolveAgentForRoute("/customer/marketing/strategy", superuser);

    expect(result.systemPrompt).toContain("ACTIVE MARKETING WORK");
    expect(result.systemPrompt).toContain("If the user replies with ok, yes, continue, next, or similar");
    expect(result.systemPrompt).toContain("call save_marketing_review before your final response");
    expect(result.systemPrompt).toContain("Do not repeat the same baseline diagnosis");
    expect(result.systemPrompt).toContain("log the issue");
  });

  it("keeps marketing access gated separately from core customer routes", () => {
    const result = resolveAgentForRoute("/customer/marketing", opsUser);
    expect(result.agentId).toBe("marketing-specialist");
    expect(result.canAssist).toBe(false);
  });

  it("routes /storefront to the storefront operations persona", () => {
    const result = resolveAgentForRoute("/storefront", superuser);
    expect(result.agentId).toBe("storefront-advisor");
    expect(result.agentName).toBe("Storefront Operations Manager");
    expect(result.canAssist).toBe(true);
  });

  it("returns correct agent metadata", () => {
    const result = resolveAgentForRoute("/ops", superuser);
    expect(result.agentName).toBeTruthy();
    expect(result.agentDescription).toBeTruthy();
  });

  it("does not pin the build route to a single provider by default", () => {
    const result = resolveAgentForRoute("/build", superuser);
    expect(result.modelRequirements?.preferredProviderId).toBeUndefined();
    expect(result.modelRequirements?.defaultMinimumTier).toBe("strong");
  });

  it("mentions public website branding analysis in the admin assistant prompt", () => {
    const result = resolveAgentForRoute("/admin", superuser);
    expect(result.systemPrompt).toContain("public website");
    expect(result.systemPrompt).toContain("branding");
  });

  it("keeps admin issue triage operational and out of Build Studio", () => {
    const result = resolveAgentForRoute("/admin/issue-reports", superuser);

    expect(result.agentId).toBe("admin-assistant");
    expect(result.systemPrompt).toContain("issue reports");
    expect(result.systemPrompt).toContain("Do not redirect issue-report triage to Build Studio");
    expect(result.systemPrompt).not.toContain("tell the user to run it manually");
    expect(result.systemPrompt).not.toContain("give the user the exact SQL to run manually");
    expect(result.skills.some((skill) => skill.label === "Triage issue reports")).toBe(true);
    expect(result.skills.some((skill) => skill.label === "Investigate open report")).toBe(true);
  });

  it("returns a non-empty systemPrompt", () => {
    const result = resolveAgentForRoute("/portfolio", superuser);
    expect(result.systemPrompt).toBeTruthy();
    expect(result.systemPrompt).toContain("Portfolio Analyst");
  });

  it("every route agent has a non-empty systemPrompt", () => {
    const routes = ["/portfolio", "/inventory", "/platform/tools/discovery", "/ea", "/employee", "/customer", "/customer/marketing", "/storefront", "/ops", "/finance", "/platform", "/admin", "/workspace"];
    for (const route of routes) {
      const result = resolveAgentForRoute(route, superuser);
      expect(result.systemPrompt.length).toBeGreaterThan(0);
    }
  });

  it("returns skills array for each agent", () => {
    const routes = ["/portfolio", "/inventory", "/platform/tools/discovery", "/ea", "/employee", "/customer", "/customer/marketing", "/storefront", "/ops", "/finance", "/platform", "/admin", "/workspace"];
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
    expect(response).toContain("cash position");
    expect(response).not.toMatch(/recurring billing|tax remittance/i);
  });

  it("uses licensing-oriented canned copy for the licensing specialist", () => {
    const response = generateCannedResponse("licensing-specialist", "/compliance/licensing", "HR-000");

    expect(response).toContain("Licensing & Permit Specialist");
    expect(response).toContain("jurisdiction");
  });
});
