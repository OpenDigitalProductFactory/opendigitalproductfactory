import { describe, expect, it } from "vitest";
import registry from "../../../../packages/db/data/agent_registry.json";
import { DELIVERY_WORKFLOW_TOOLS } from "@dpf/integration-shared/delivery-readiness-contract";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { getMcpTokenTemplate } from "@/lib/mcp-token-scopes";
describe("approved development profiles", () => {
  it("covers every delivery stage for fresh tokens and every supported external coworker", () => {
    const token = getMcpTokenTemplate("development")!.grants;
    expect(DELIVERY_WORKFLOW_TOOLS.filter(name => !isToolAllowedByGrants(name, [...token]))).toEqual([]);
    for (const id of ["AGT-EXT-CLAUDE", "AGT-EXT-CODEX", "AGT-EXT-GROK"]) {
      const agent = (registry.agents as Array<{ agent_id: string; config_profile: { tool_grants?: string[] } }>).find(row => row.agent_id === id)!;
      const grants = agent.config_profile.tool_grants!;
      expect(DELIVERY_WORKFLOW_TOOLS.filter(name => !isToolAllowedByGrants(name, grants)), id).toEqual([]);
      expect(grants).not.toContain("admin_write");
      expect(grants).not.toContain("registry_write");
    }
  });
});
