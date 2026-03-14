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

  it("returns workspace-guide for unknown routes", () => {
    const result = resolveAgentForRoute("/unknown/path", superuser);
    expect(result.agentId).toBe("workspace-guide");
    expect(result.canAssist).toBe(true);
  });

  it("returns canAssist=false when user lacks capability", () => {
    // HR-500 has view_operations but not view_ea_modeler
    const result = resolveAgentForRoute("/ea", opsUser);
    expect(result.agentId).toBe("ea-architect");
    expect(result.canAssist).toBe(false);
  });

  it("returns canAssist=true for ungated routes (capability null)", () => {
    const result = resolveAgentForRoute("/workspace", noRole);
    expect(result.agentId).toBe("workspace-guide");
    expect(result.canAssist).toBe(true);
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
});
