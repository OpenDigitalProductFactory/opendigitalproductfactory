import { describe, expect, it } from "vitest";
import registry from "../../../../packages/db/data/agent_registry.json";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

describe("external development profile", () => {
  for (const agentId of ["AGT-EXT-CLAUDE", "AGT-EXT-CODEX", "AGT-EXT-GROK"]) {
    it(`${agentId} can coordinate development but cannot deploy production`, () => {
      const agent = registry.agents.find((entry) => entry.agent_id === agentId);
      expect(agent).toBeDefined();
      const grants = agent!.config_profile.tool_grants;
      for (const tool of ["claim_backlog_item_for_work", "record_workroom_evidence", "get_backlog_item",
        "read_project_file", "claim_nonprod_environment_lease", "record_local_integration_result",
        "review_semantic_change", "promote_to_build_studio", "start_build"]) {
        expect(isToolAllowedByGrants(tool, grants), tool).toBe(true);
      }
      for (const tool of ["deploy_feature", "execute_promotion", "admin_run_command"]) {
        expect(isToolAllowedByGrants(tool, grants), tool).toBe(false);
      }
    });
  }
});
