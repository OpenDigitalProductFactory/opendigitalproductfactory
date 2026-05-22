import { describe, expect, it } from "vitest";

import {
  CODING_AGENT_MCP_TOKEN_SCOPES,
  MCP_TOKEN_REVOKED_ARCHIVE_DAYS,
  MCP_TOKEN_TEMPLATES,
  WRITE_MCP_TOKEN_SCOPES,
  defaultMcpTokenScopes,
  getMcpTokenTemplate,
  isMcpTokenArchived,
  resolveTemplateGrants,
} from "./mcp-token-scopes";

describe("defaultMcpTokenScopes", () => {
  it("defaults coding-agent tokens to read-only scopes", () => {
    const availableScopes = [
      "admin_write",
      "architecture_read",
      "backlog_write",
      "backlog_read",
      "code_graph_read",
      "file_read",
      "spec_plan_read",
      "work_capsule_adopt",
      "work_capsule_read",
      "work_capsule_write",
    ];

    expect(defaultMcpTokenScopes(availableScopes)).toEqual([
      "architecture_read",
      "backlog_read",
      "code_graph_read",
      "file_read",
      "spec_plan_read",
      "work_capsule_read",
    ]);
  });

  it("selects write scopes only when the operator issues a write token", () => {
    expect(defaultMcpTokenScopes([...WRITE_MCP_TOKEN_SCOPES], "write")).toEqual([
      ...WRITE_MCP_TOKEN_SCOPES,
    ]);
  });

  it("only selects scopes that are actually available in this install", () => {
    expect(defaultMcpTokenScopes(["backlog_read", "file_read"])).toEqual([
      "backlog_read",
      "file_read",
    ]);
  });

  it("keeps the public catalog aligned with the helper output", () => {
    expect(defaultMcpTokenScopes([...CODING_AGENT_MCP_TOKEN_SCOPES])).toEqual([
      ...CODING_AGENT_MCP_TOKEN_SCOPES,
    ]);
  });
});

describe("MCP_TOKEN_TEMPLATES", () => {
  it("exposes the canonical role catalog in display order", () => {
    expect(MCP_TOKEN_TEMPLATES.map((t) => t.id)).toEqual([
      "admin",
      "development",
      "employee_finance",
      "employee_hr",
      "employee_ea",
      "employee_marketing",
      "observer",
      "custom",
    ]);
  });

  it("tags each template with a coarse tier consistent with its grants", () => {
    const admin = getMcpTokenTemplate("admin");
    const development = getMcpTokenTemplate("development");
    const observer = getMcpTokenTemplate("observer");
    const custom = getMcpTokenTemplate("custom");

    expect(admin?.tier).toBe("admin");
    expect(admin?.grants).toContain("admin_write");
    expect(admin?.grants).toContain("iac_execute");

    expect(development?.tier).toBe("write");
    expect(development?.grants).toContain("sandbox_execute");
    expect(development?.grants).toContain("iac_execute");
    expect(development?.grants).not.toContain("admin_write");

    expect(observer?.tier).toBe("read");
    // An observer must never have a write or sandbox_execute grant.
    expect(observer?.grants.some((g) => g.endsWith("_write"))).toBe(false);
    expect(observer?.grants).not.toContain("sandbox_execute");
    expect(observer?.grants).not.toContain("iac_execute");

    // Custom is a UI-only sentinel; it must not pre-select any grants.
    expect(custom?.grants).toEqual([]);
  });

  it("groups employee surfaces under the employee category", () => {
    const employees = MCP_TOKEN_TEMPLATES.filter((t) => t.category === "employee");
    expect(employees.map((t) => t.id).sort()).toEqual([
      "employee_ea",
      "employee_finance",
      "employee_hr",
      "employee_marketing",
    ]);
    // Employee surfaces must not include the platform admin/iac grants.
    for (const t of employees) {
      expect(t.grants).not.toContain("admin_write");
      expect(t.grants).not.toContain("iac_execute");
      expect(t.grants).not.toContain("sandbox_execute");
    }
  });

  it("returns undefined for unknown template ids", () => {
    expect(getMcpTokenTemplate("does_not_exist")).toBeUndefined();
  });
});

describe("resolveTemplateGrants", () => {
  it("filters template grants down to the install's available scope catalog", () => {
    const development = getMcpTokenTemplate("development")!;
    const resolved = resolveTemplateGrants(development, ["backlog_read", "iac_execute"]);
    expect(resolved.sort()).toEqual(["backlog_read", "iac_execute"]);
  });

  it("returns empty when no grants overlap (do-not-issue signal)", () => {
    const finance = getMcpTokenTemplate("employee_finance")!;
    expect(resolveTemplateGrants(finance, ["unrelated_grant"])).toEqual([]);
  });
});

describe("isMcpTokenArchived", () => {
  const now = new Date("2026-05-22T12:00:00Z");

  it("returns false for active (non-revoked) tokens", () => {
    expect(isMcpTokenArchived(null, now)).toBe(false);
    expect(isMcpTokenArchived(undefined, now)).toBe(false);
  });

  it("returns false for tokens revoked within the window", () => {
    // 89 days ago — just inside the window.
    const recent = new Date(now.getTime() - 89 * 86_400_000);
    expect(isMcpTokenArchived(recent, now)).toBe(false);
  });

  it("returns true at exactly the threshold so we never get stuck on a boundary", () => {
    const atThreshold = new Date(
      now.getTime() - MCP_TOKEN_REVOKED_ARCHIVE_DAYS * 86_400_000,
    );
    expect(isMcpTokenArchived(atThreshold, now)).toBe(true);
  });

  it("returns true for tokens revoked well past the window", () => {
    const old = new Date(now.getTime() - 365 * 86_400_000);
    expect(isMcpTokenArchived(old, now)).toBe(true);
  });
});
