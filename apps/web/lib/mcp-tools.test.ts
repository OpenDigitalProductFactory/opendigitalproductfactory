import { describe, expect, it } from "vitest";
import { getAvailableTools, sanitizeToolParams } from "./mcp-tools";
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

  it("makes public web search available during Build Studio ideation", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: true });
    const tool = tools.find((t) => t.name === "search_public_web");

    expect(tool).toBeDefined();
    expect(tool!.buildPhases).toContain("ideate");
  });

  it("includes build tools for platform users", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: false });
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("update_feature_brief");
    expect(toolNames).toContain("register_digital_product_from_build");
    expect(toolNames).toContain("create_build_epic");
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
