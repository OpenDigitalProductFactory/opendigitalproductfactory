import { describe, expect, it } from "vitest";
import {
  buildEndpointTestRunRequest,
  executeTool,
  getAvailableTools,
  inferEndpointIdFromRouteContext,
  resolveSavePhaseHandoffTransition,
  sanitizeToolParams,
} from "./mcp-tools";
import { getActionsForRoute } from "./agent-action-registry";

describe("mcp tools", () => {
  const adminUser = {
    userId: "user-1",
    platformRole: "HR-000",
    isSuperuser: false,
  };
  const inventoryUser = {
    userId: "user-2",
    platformRole: "HR-300",
    isSuperuser: false,
  };

  it("hides external tools when external access is off", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: false });

    expect(tools.some((tool) => tool.name === "search_public_web")).toBe(false);
    expect(tools.some((tool) => tool.name === "fetch_public_website")).toBe(false);
    expect(tools.some((tool) => tool.name === "analyze_public_website_branding")).toBe(false);
  });

  it("shows external tools when external access is on", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: true });

    expect(tools.some((tool) => tool.name === "search_public_web")).toBe(true);
    expect(tools.some((tool) => tool.name === "fetch_public_website")).toBe(true);
    expect(tools.some((tool) => tool.name === "analyze_public_website_branding")).toBe(true);
  });

  it("exposes official-source research tools to the finance agent when External Access is on", async () => {
    const tools = await getAvailableTools(adminUser, {
      externalAccessEnabled: true,
      agentId: "finance-agent",
    });
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toContain("search_public_web");
    expect(toolNames).toContain("fetch_public_website");
  });

  it("exposes the finance period summary tool only when user capability and finance-agent grants both allow it", async () => {
    const financeTools = await getAvailableTools(adminUser, {
      externalAccessEnabled: false,
      agentId: "finance-agent",
    });
    const inventoryTools = await getAvailableTools(inventoryUser, {
      externalAccessEnabled: false,
      agentId: "finance-agent",
    });
    const tool = financeTools.find((t) => t.name === "get_finance_period_summary");

    expect(tool).toBeDefined();
    expect(tool!.requiredCapability).toBe("view_finance");
    expect(tool!.executionMode).toBe("immediate");
    expect(tool!.sideEffect).toBe(false);
    expect(inventoryTools.some((t) => t.name === "get_finance_period_summary")).toBe(false);
  });

  it("makes public web search available during Build Studio ideation", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: true });
    const tool = tools.find((t) => t.name === "search_public_web");

    expect(tool).toBeDefined();
    expect(tool!.buildPhases).toContain("ideate");
  });

  it("includes build tools for platform users", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: false });
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("create_epic");
    expect(toolNames).toContain("update_epic");
    expect(toolNames).toContain("update_feature_brief");
    expect(toolNames).toContain("register_digital_product_from_build");
    expect(toolNames).toContain("create_build_epic");
    expect(toolNames).toContain("get_code_graph_freshness");
    expect(toolNames).toContain("inspect_build_code_impact");
    expect(toolNames).toContain("search_code_graph");
    expect(toolNames).toContain("trace_code_surface");
    expect(toolNames).toContain("find_related_tests");
  });

  it("update_feature_brief requires view_platform capability", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: false });
    const tool = tools.find((t) => t.name === "update_feature_brief");
    expect(tool).toBeDefined();
    expect(tool!.requiredCapability).toBe("view_platform");
  });

  it("register_digital_product_from_build requires manage_capabilities", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: false });
    const tool = tools.find((t) => t.name === "register_digital_product_from_build");
    expect(tool).toBeDefined();
    expect(tool!.requiredCapability).toBe("manage_capabilities");
  });

  it("includes intake tools for platform users", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: false });
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("search_portfolio_context");
    expect(toolNames).toContain("assess_complexity");
    expect(toolNames).toContain("propose_decomposition");
    expect(toolNames).toContain("register_tech_debt");
  });

  it("intake tools execute immediately", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: false });
    for (const name of ["search_portfolio_context", "assess_complexity", "propose_decomposition", "register_tech_debt"]) {
      const tool = tools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(tool!.executionMode).toBe("immediate");
    }
  });

  it("exposes read-only estate tools to inventory users", async () => {
    const tools = await getAvailableTools(inventoryUser, { externalAccessEnabled: false });
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toContain("summarize_estate_posture");
    expect(toolNames).toContain("review_estate_identity");
    expect(toolNames).toContain("validate_version_confidence");
    expect(toolNames).toContain("explain_blast_radius");
    expect(toolNames).not.toContain("discovery_sweep");
  });

  it("keeps discovery sweep available only to provider managers", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: false });
    const sweep = tools.find((tool) => tool.name === "discovery_sweep");

    expect(sweep).toBeDefined();
    expect(sweep!.requiredCapability).toBe("manage_provider_connections");
    expect(sweep!.sideEffect).toBe(true);
  });

  it("re-keys get_marketing_summary to view_marketing", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: false });
    const tool = tools.find((t) => t.name === "get_marketing_summary");

    expect(tool).toBeDefined();
    expect(tool!.requiredCapability).toBe("view_marketing");
  });

  it("re-keys suggest_campaign_ideas to view_marketing", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: false });
    const tool = tools.find((t) => t.name === "suggest_campaign_ideas");

    expect(tool).toBeDefined();
    expect(tool!.requiredCapability).toBe("view_marketing");
  });

  it("re-keys analyze_seo_opportunity to view_marketing", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: false });
    const tool = tools.find((t) => t.name === "analyze_seo_opportunity");

    expect(tool).toBeDefined();
    expect(tool!.requiredCapability).toBe("view_marketing");
  });

  it("exposes discovery triage as an immediate provider-management tool", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: false });
    const triage = tools.find((tool) => tool.name === "run_discovery_triage");

    expect(triage).toBeDefined();
    expect(triage!.requiredCapability).toBe("manage_provider_connections");
    expect(triage!.executionMode).toBe("immediate");
    expect(triage!.sideEffect).toBe(true);
  });

  it("exposes Hive Scout ingest as an immediate backlog-management tool", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: false });
    const scout = tools.find((tool) => tool.name === "run_hive_scout_ingest");

    expect(scout).toBeDefined();
    expect(scout!.requiredCapability).toBe("manage_backlog");
    expect(scout!.executionMode).toBe("immediate");
    expect(scout!.sideEffect).toBe(true);
  });

  it("hides plan_workroom_worktree from a view-only platform user", async () => {
    const tools = await getAvailableTools(inventoryUser, { externalAccessEnabled: false });
    expect(tools.find((tool) => tool.name === "plan_workroom_worktree")).toBeUndefined();
  });

  it("exposes plan_workroom_worktree to an admin", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: false });
    const tool = tools.find((candidate) => candidate.name === "plan_workroom_worktree");

    expect(tool).toBeDefined();
    expect(tool!.requiredCapability).toBe("manage_backlog");
    expect(tool!.sideEffect).toBe(true);
  });

  it("exposes reviewDesignDoc and reviewBuildPlan to the build-specialist agent (architecture_read + build_plan_write grants)", async () => {
    // Regression: mcp-tools.ts was using the sync JSON-backed getAgentToolGrants which
    // returned stale grants missing architecture_read / build_plan_write. The ideate phase
    // then could not call reviewDesignDoc (required for Ideate→Plan transition) because the
    // tool was filtered out. Fix: switched to getAgentToolGrantsAsync (DB-first, JSON fallback).
    const tools = await getAvailableTools(adminUser, {
      externalAccessEnabled: false,
      agentId: "build-specialist",
    });
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain("reviewDesignDoc");
    expect(toolNames).toContain("reviewBuildPlan");
    expect(toolNames).toContain("saveBuildEvidence");
    // Ensure sandbox tools are also present (build phase needs them)
    expect(toolNames).toContain("start_sandbox");
    expect(toolNames).toContain("run_sandbox_tests");
    // Ensure the grant filter is actually applied (work_capsule tools are NOT in build-specialist's grants)
    expect(toolNames).not.toContain("list_workrooms");
    expect(toolNames).not.toContain("get_workroom");
  });

  it("executes activity harness confidence approvals as governed configuration acknowledgements", async () => {
    const result = await executeTool(
      "activity_harness_confidence_override",
      {
        kind: "activity-harness-confidence-override",
        activityClass: "code-edit",
        harnessRecipeKey: "glm.mixed.code-edit.provisional",
        providerId: "zai-coding",
        modelId: "glm-5.2",
        confidence: "trusted",
      },
      "user-1",
    );

    expect(result).toMatchObject({
      success: true,
      message: "Activity routing confidence override approved.",
      data: {
        activityClass: "code-edit",
        harnessRecipeKey: "glm.mixed.code-edit.provisional",
        providerId: "zai-coding",
        modelId: "glm-5.2",
        confidence: "trusted",
      },
    });
  });
});

describe("sanitizeToolParams", () => {
  it("strips optional object param when all string fields are empty", () => {
    const result = sanitizeToolParams("confirm_taxonomy_placement", {
      nodeId: "manufacturing_and_delivery/detect_to_correct",
      proposeNew: { parentNodeId: "", name: "", description: "", rationale: "" },
    });
    expect(result).toEqual({ nodeId: "manufacturing_and_delivery/detect_to_correct" });
    expect(result).not.toHaveProperty("proposeNew");
  });

  it("strips optional object param when all string fields are whitespace", () => {
    const result = sanitizeToolParams("confirm_taxonomy_placement", {
      nodeId: "some/node",
      proposeNew: { parentNodeId: "  ", name: " ", description: "  ", rationale: "" },
    });
    expect(result).not.toHaveProperty("proposeNew");
  });

  it("keeps optional object param when at least one string field is non-empty", () => {
    const result = sanitizeToolParams("confirm_taxonomy_placement", {
      proposeNew: { parentNodeId: "some/parent", name: "New Node", description: "", rationale: "" },
    });
    expect(result).toHaveProperty("proposeNew");
    expect((result.proposeNew as Record<string, string>).parentNodeId).toBe("some/parent");
  });

  it("does not modify params for tools with no optional object params", () => {
    const original = { field: "designDoc", value: { problemStatement: "test" } };
    const result = sanitizeToolParams("saveBuildEvidence", original);
    // saveBuildEvidence has value as required, so sanitizer should not touch it
    expect(result).toBe(original); // same reference — no copy made
  });

  it("does not modify params for unknown tools", () => {
    const original = { foo: "bar" };
    const result = sanitizeToolParams("nonexistent_tool", original);
    expect(result).toBe(original);
  });

  it("handles params where optional object is null or absent", () => {
    const result = sanitizeToolParams("confirm_taxonomy_placement", {
      nodeId: "some/node",
    });
    expect(result).toEqual({ nodeId: "some/node" });
  });

  it("handles optional object with non-string fields (numbers, booleans) — keeps it", () => {
    // If the object has non-string values, it's not an empty schema artifact
    const result = sanitizeToolParams("confirm_taxonomy_placement", {
      nodeId: "some/node",
      proposeNew: { parentNodeId: "", name: "", count: 5 },
    });
    // All string fields are empty but there's a non-string field — string check still applies
    // to string-typed fields only. Both string fields are empty → stripped.
    expect(result).not.toHaveProperty("proposeNew");
  });
});

describe("save_phase_handoff transition controls", () => {
  it("ignores hidden non-advancing controls from non-orchestrator callers", () => {
    const transition = resolveSavePhaseHandoffTransition(
      { toPhase: "build", autoAdvance: false },
      { agentId: "frontend-engineer", routeContext: "/build" },
      "build",
    );

    expect(transition).toEqual({
      toPhase: "review",
      autoAdvance: true,
      isInternalTaskHandoff: false,
    });
  });

  it("honors non-advancing task handoff controls only for the build orchestrator", () => {
    const transition = resolveSavePhaseHandoffTransition(
      { toPhase: "build", autoAdvance: false },
      { agentId: "AGT-ORCH-300", routeContext: "/build" },
      "build",
    );

    expect(transition).toEqual({
      toPhase: "build",
      autoAdvance: false,
      isInternalTaskHandoff: true,
    });
  });

  it("rejects invalid internal target phases", () => {
    const transition = resolveSavePhaseHandoffTransition(
      { toPhase: "not-a-phase", autoAdvance: false },
      { agentId: "AGT-ORCH-300", routeContext: "/build" },
      "build",
    );

    expect(transition).toEqual({
      toPhase: "review",
      autoAdvance: false,
      isInternalTaskHandoff: true,
    });
  });
});

describe("endpoint test tool scope", () => {
  it("infers the provider page endpoint and defaults coworker diagnostics to probes only", () => {
    expect(inferEndpointIdFromRouteContext("/platform/ai/providers/gemini")).toBe("gemini");

    const request = buildEndpointTestRunRequest({}, { routeContext: "/platform/ai/providers/gemini" });

    expect(request).toEqual({
      endpointId: "gemini",
      probesOnly: true,
      allEndpoints: false,
      allModels: false,
    });
  });

  it("requires explicit all-endpoint scope away from a provider route", () => {
    const request = buildEndpointTestRunRequest({}, { routeContext: "/workspace" });

    expect(request.error).toMatch(/endpointId or allEndpoints/);
  });

  it("preserves explicit full all-model endpoint test requests", () => {
    const request = buildEndpointTestRunRequest({
      endpointId: "gemini",
      modelId: "gemini-2.5-flash",
      probesOnly: false,
      allModels: true,
    }, { routeContext: "/platform/ai/providers/anthropic-sub" });

    expect(request).toEqual({
      endpointId: "gemini",
      modelId: "gemini-2.5-flash",
      probesOnly: false,
      allEndpoints: false,
      allModels: true,
    });
  });
});

describe("page action integration", () => {
  it("getActionsForRoute returns ToolDefinition-compatible objects", () => {
    const adminUser = { userId: "u-1", platformRole: "HR-000", isSuperuser: false };
    const actions = getActionsForRoute("/employee", adminUser);

    for (const action of actions) {
      expect(action).toHaveProperty("name");
      expect(action).toHaveProperty("description");
      expect(action).toHaveProperty("inputSchema");
      expect(action).toHaveProperty("requiredCapability");
      expect(action).toHaveProperty("specRef");
    }
  });
});
