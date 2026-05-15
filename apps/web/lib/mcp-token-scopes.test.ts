import { describe, expect, it } from "vitest";

import {
  CODING_AGENT_MCP_TOKEN_SCOPES,
  defaultMcpTokenScopes,
} from "./mcp-token-scopes";

describe("defaultMcpTokenScopes", () => {
  it("selects the scopes coding agents need for repo-grounded coordinated work", () => {
    const availableScopes = [
      "admin_write",
      "architecture_read",
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
      "work_capsule_write",
      "work_capsule_adopt",
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
