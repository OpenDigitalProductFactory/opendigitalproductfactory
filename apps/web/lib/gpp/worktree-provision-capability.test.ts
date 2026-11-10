import { describe, expect, it } from "vitest";

import agentRegistry from "../../../../packages/db/data/agent_registry.json";
import { HARDCODED_COWORKER_GRANTS } from "../../../../packages/db/src/coworker-grants";
import { EPHEMERAL_SHIP_TOKEN_SCOPES } from "@/lib/auth/ephemeral-ship-tokens";
import { PUBLIC_SCOPE_TO_GRANTS } from "@/lib/auth/oauth-scope-map";
import { WORKROOM_SESSION_SCOPES } from "@/lib/auth/workroom-session-token";
import { grantsSatisfyRequirement, TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";
import { DELIVERY_SHAPE_REFS } from "@/lib/work-management/delivery-shapes";
import { roomAuthorizesTool, roomGrantsFromWorkShape } from "@/lib/work-management/room-turn-authority";
import { WORK_CASE_SOURCE_REGISTRY } from "@/lib/work-management/source-registry";
import { getWorkShape } from "@/lib/work-management/work-shapes";

// BI-D1FB8C4D AC-WPG-4 and AC-WPG-5. Splitting worktree provisioning out of
// work_capsule_write must not change what any delivery shape or standing
// principal can reach; it only takes provisioning away from shapes and
// principals that should never have had it.

const PROVISION_TOOLS = ["plan_workroom_worktree", "claim_workroom_scope", "plan_capsule_worktree", "claim_capsule_scope"];

/** The requirement each tool had before the split. */
function requirementBeforeSplit(tool: string): readonly string[] {
  return PROVISION_TOOLS.includes(tool) ? ["work_capsule_write"] : TOOL_TO_GRANTS[tool]!;
}

describe("AC-WPG-4: delivery shapes reach the same tools after the split", () => {
  const tools = Object.keys(TOOL_TO_GRANTS);

  for (const ref of DELIVERY_SHAPE_REFS) {
    it(ref, () => {
      const shape = getWorkShape(ref.split("@")[0]!)!;
      const before = roomGrantsFromWorkShape(shape.grants.filter((g) => g !== "tool:worktree-provision"));
      const after = roomGrantsFromWorkShape(shape.grants);
      const reachBefore = tools.filter((tool) => grantsSatisfyRequirement(requirementBeforeSplit(tool), before));
      const reachAfter = tools.filter((tool) => roomAuthorizesTool(tool, after));
      expect(reachAfter).toEqual(reachBefore);
      // The resolved grant set differs only by the new grant, and only where
      // the shape provisions at all (xlarge decomposes; it never did).
      const added = after.filter((g) => !before.includes(g));
      expect(added).toEqual(shape.grants.includes("tool:worktree-provision") ? ["worktree_provision"] : []);
      expect(before.filter((g) => !after.includes(g))).toEqual([]);
    });
  }

  it("write-internal alone no longer reaches provisioning", () => {
    const grants = roomGrantsFromWorkShape(["tool:read", "tool:write-internal"]);
    for (const tool of PROVISION_TOOLS) expect(roomAuthorizesTool(tool, grants), tool).toBe(false);
  });
});

describe("AC-WPG-5: every principal that could provision still can", () => {
  const lists: Array<[string, readonly string[]]> = [
    ["WORKROOM_SESSION_SCOPES", WORKROOM_SESSION_SCOPES],
    ["EPHEMERAL_SHIP_TOKEN_SCOPES", EPHEMERAL_SHIP_TOKEN_SCOPES],
    ...Object.entries(PUBLIC_SCOPE_TO_GRANTS).map(([scope, grants]) => [`oauth:${scope}`, grants] as [string, readonly string[]]),
    ...Object.entries(HARDCODED_COWORKER_GRANTS).map(([id, grants]) => [`coworker:${id}`, grants] as [string, readonly string[]]),
    ...(agentRegistry as { agents: Array<{ agent_id: string; config_profile?: { tool_grants?: string[] } }> }).agents
      .map((agent) => [`registry:${agent.agent_id}`, agent.config_profile?.tool_grants ?? []] as [string, readonly string[]]),
    ...WORK_CASE_SOURCE_REGISTRY.map((entry) => [`source:${entry.sourceKey}`, entry.toolGrant.grantKeys] as [string, readonly string[]]),
  ];

  it("covers some principals that hold work_capsule_write", () => {
    expect(lists.filter(([, grants]) => grants.includes("work_capsule_write")).length).toBeGreaterThan(5);
  });

  for (const [name, grants] of lists) {
    if (!grants.includes("work_capsule_write")) continue;
    it(name, () => {
      expect(grantsSatisfyRequirement(["worktree_provision"], grants)).toBe(true);
    });
  }

  it("work_capsule_adopt implies provisioning, one way", () => {
    expect(grantsSatisfyRequirement(["worktree_provision"], ["work_capsule_adopt"])).toBe(true);
    expect(grantsSatisfyRequirement(["work_capsule_adopt"], ["worktree_provision"])).toBe(false);
  });
});
