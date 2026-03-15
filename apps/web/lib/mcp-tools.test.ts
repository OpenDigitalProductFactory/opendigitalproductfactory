import { describe, it, expect } from "vitest";
import { PLATFORM_TOOLS, getAvailableTools, toolsToOpenAIFormat } from "./mcp-tools";

describe("PLATFORM_TOOLS", () => {
  it("has 5 tools", () => {
    expect(PLATFORM_TOOLS).toHaveLength(5);
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
    expect(tools).toHaveLength(5);
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

describe("toolsToOpenAIFormat", () => {
  it("converts to OpenAI function format", () => {
    const converted = toolsToOpenAIFormat(PLATFORM_TOOLS.slice(0, 1));
    expect(converted[0]).toHaveProperty("type", "function");
    expect(converted[0]).toHaveProperty("function.name", "create_backlog_item");
    expect(converted[0]).toHaveProperty("function.parameters");
  });
});
