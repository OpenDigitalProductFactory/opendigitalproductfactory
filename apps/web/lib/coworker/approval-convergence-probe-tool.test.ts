// probe_pending_approval_conversion (BI-129EFFD1): the AC-PROBE dry run as an
// MCP tool. Read-only, advise-safe, platform-admin capability, granted through
// the central grant map to the admin assistant and the external development
// identities.
import { beforeEach, describe, expect, it, vi } from "vitest";

import registry from "../../../../packages/db/data/agent_registry.json";
import { HARDCODED_COWORKER_GRANTS } from "../../../../packages/db/src/coworker-grants";

const mocks = vi.hoisted(() => ({ user: vi.fn(), run: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { marker: "global-client" } }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: mocks.user }));
vi.mock("@/lib/coworker/approval-convergence-probe-run", () => ({ runApprovalConvergenceProbe: mocks.run }));

import { coworkerPack } from "@/lib/mcp/packs/coworker-pack";
import { PUBLIC_SCOPE_TO_GRANTS } from "@/lib/auth/oauth-scope-map";
import { filterToolsForCoworkerRuntime } from "@/lib/actions/coworker-tool-filter";
import { requiredTokenScopeForTool } from "@/lib/mcp/token-tool-scope";
import { TOOL_TO_GRANTS, isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const TOOL = "probe_pending_approval_conversion";
const definition = () => coworkerPack.definitions.find((tool) => tool.name === TOOL);
const registryGrants = (agentId: string) =>
  registry.agents.find((agent) => agent.agent_id === agentId)!.config_profile.tool_grants;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.run.mockResolvedValue({ probedAt: "2026-10-13T12:00:00.000Z", summary: { rows: 0, byRefusal: {}, byOwner: {} }, rows: [] });
});

describe("probe_pending_approval_conversion — classification", () => {
  it("is a read-only, immediate, platform-admin tool with no inputs", () => {
    expect(definition()).toMatchObject({
      requiredCapability: "manage_platform",
      sideEffect: false,
      executionMode: "immediate",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    });
    expect(definition()?.consequence).toBeUndefined();
  });

  it("is advise-safe: an advise-mode coworker keeps it", () => {
    const kept = filterToolsForCoworkerRuntime([definition()!], { coworkerMode: "advise", activeBuildPhase: null });
    expect(kept.map((tool) => tool.name)).toEqual([TOOL]);
  });

  it("is gated by its own narrow read grant, which a read token admits", () => {
    expect(TOOL_TO_GRANTS[TOOL]).toEqual(["approval_probe_read"]);
    expect(requiredTokenScopeForTool(definition(), TOOL_TO_GRANTS[TOOL])).toBe("read");
    expect(PUBLIC_SCOPE_TO_GRANTS["dpf.read"]).toContain("approval_probe_read");
  });

  it("is granted to the admin assistant and AGT-EXT-CLAUDE, durably and in the registry", () => {
    for (const [agentId, slug] of [["AGT-WS-ADMIN", "admin-assistant"], ["AGT-EXT-CLAUDE", "external-claude-code"]] as const) {
      expect(isToolAllowedByGrants(TOOL, registryGrants(agentId)), agentId).toBe(true);
      expect(HARDCODED_COWORKER_GRANTS[slug], slug).toContain("approval_probe_read");
    }
    // A coworker without the grant cannot call it.
    expect(isToolAllowedByGrants(TOOL, registryGrants("AGT-ORCH-000"))).toBe(false);
  });
});

describe("probe_pending_approval_conversion — handler", () => {
  it("refuses a caller without platform-admin capability before reading anything", async () => {
    mocks.user.mockResolvedValue({ userId: "u-2", platformRole: "HR-100", isSuperuser: false });
    const result = await coworkerPack.handlers[TOOL]({}, "u-2");
    expect(result).toMatchObject({ success: false, error: "forbidden" });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("refuses an unknown or inactive caller", async () => {
    mocks.user.mockResolvedValue(null);
    const result = await coworkerPack.handlers[TOOL]({}, "ghost");
    expect(result).toMatchObject({ success: false, error: "forbidden" });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("refuses inputs: there is nothing to select", async () => {
    mocks.user.mockResolvedValue({ userId: "u-1", platformRole: "HR-000", isSuperuser: false });
    const result = await coworkerPack.handlers[TOOL]({ proposalId: "prop-1" }, "u-1");
    expect(result).toMatchObject({ success: false, error: "invalid_params" });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("returns the probe report for a platform admin", async () => {
    mocks.user.mockResolvedValue({ userId: "u-1", platformRole: "HR-000", isSuperuser: false });
    const result = await coworkerPack.handlers[TOOL]({}, "u-1");
    expect(mocks.run).toHaveBeenCalledWith({ marker: "global-client" });
    expect(result).toMatchObject({
      success: true,
      data: { probedAt: "2026-10-13T12:00:00.000Z", summary: { rows: 0 }, rows: [] },
    });
  });
});
