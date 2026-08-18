import { describe, expect, it } from "vitest";

import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

describe("manage_coworker_tool_grant MCP surface", () => {
  const tool = PLATFORM_TOOLS.find((t) => t.name === "manage_coworker_tool_grant");

  it("is registered as a governed side-effect tool", () => {
    expect(tool).toBeDefined();
    expect(tool?.sideEffect).toBe(true);
    expect(tool?.requiredCapability).toBe("manage_platform");
  });

  it("requires coworker, grantKey, and a grant|revoke action", () => {
    const schema = tool?.inputSchema as
      | { required?: string[]; properties?: Record<string, { enum?: string[] }> }
      | undefined;
    expect(schema?.required).toEqual(expect.arrayContaining(["coworker", "grantKey", "action"]));
    expect(schema?.properties?.action?.enum).toEqual(["grant", "revoke"]);
  });

  it("is grant-gated on agent_control_read (the AI-ops management tier)", () => {
    expect(TOOL_TO_GRANTS.manage_coworker_tool_grant).toEqual(["agent_control_read"]);
  });
});
