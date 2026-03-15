import { describe, it, expect } from "vitest";
import { PLATFORM_TOOLS, getAvailableTools, toolsToOpenAIFormat } from "./mcp-tools";

describe("PLATFORM_TOOLS", () => {
  it("has 13 tools", () => {
    expect(PLATFORM_TOOLS).toHaveLength(13);
  });

  it("every tool has name, description, inputSchema, requiredCapability", () => {
    for (const tool of PLATFORM_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect("requiredCapability" in tool).toBe(true);
    }
  });
});

describe("getAvailableTools", () => {
  it("superuser sees all tools", () => {
    const tools = getAvailableTools({ platformRole: "HR-000", isSuperuser: true });
    expect(tools).toHaveLength(13);
  });

  it("null role sees only null-capability tools", () => {
    const tools = getAvailableTools({ platformRole: null, isSuperuser: false });
    const names = tools.map((t) => t.name);
    expect(names).toContain("report_quality_issue");
    expect(names).not.toContain("create_backlog_item");
  });

  it("HR-500 sees manage_backlog tools", () => {
    const tools = getAvailableTools({ platformRole: "HR-500", isSuperuser: false });
    const names = tools.map((t) => t.name);
    expect(names).toContain("create_backlog_item");
    expect(names).toContain("report_quality_issue");
  });
});

describe("Build studio tools", () => {
  const buildToolNames = [
    "start_feature_brief",
    "launch_sandbox",
    "generate_code",
    "iterate_sandbox",
    "preview_sandbox",
    "run_sandbox_tests",
    "deploy_feature",
    "contribute_to_hive",
  ];

  it("all build tools are registered", () => {
    const names = PLATFORM_TOOLS.map((t) => t.name);
    for (const name of buildToolNames) {
      expect(names).toContain(name);
    }
  });

  it("deploy_feature requires manage_capabilities", () => {
    const tool = PLATFORM_TOOLS.find((t) => t.name === "deploy_feature");
    expect(tool?.requiredCapability).toBe("manage_capabilities");
  });

  it("start_feature_brief requires view_platform", () => {
    const tool = PLATFORM_TOOLS.find((t) => t.name === "start_feature_brief");
    expect(tool?.requiredCapability).toBe("view_platform");
  });
});

describe("toolsToOpenAIFormat", () => {
  it("converts to OpenAI function format", () => {
    const converted = toolsToOpenAIFormat(PLATFORM_TOOLS.slice(0, 1));
    expect(converted[0]).toHaveProperty("type", "function");
    expect(converted[0]).toHaveProperty("function.name", "create_backlog_item");
    expect(converted[0]).toHaveProperty("function.parameters");
  });
});
