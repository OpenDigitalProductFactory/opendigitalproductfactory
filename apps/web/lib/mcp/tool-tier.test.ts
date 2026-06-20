import { describe, it, expect } from "vitest";
import {
  resolveMcpToolTier,
  selectToolsByTier,
  CORE_MCP_TOOL_NAMES,
} from "./tool-tier";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";

describe("resolveMcpToolTier", () => {
  it("defaults to full (back-compat) for absent/unknown values", () => {
    expect(resolveMcpToolTier(undefined)).toBe("full");
    expect(resolveMcpToolTier(null)).toBe("full");
    expect(resolveMcpToolTier("")).toBe("full");
    expect(resolveMcpToolTier("everything")).toBe("full");
  });

  it("selects core case-insensitively", () => {
    expect(resolveMcpToolTier("core")).toBe("core");
    expect(resolveMcpToolTier("CORE")).toBe("core");
  });
});

describe("selectToolsByTier", () => {
  const tools = [{ name: "query_backlog" }, { name: "deploy_feature" }, { name: "search_knowledge" }];

  it("full tier is identity", () => {
    expect(selectToolsByTier(tools, "full")).toEqual(tools);
  });

  it("core tier keeps only core names", () => {
    expect(selectToolsByTier(tools, "core").map((t) => t.name)).toEqual([
      "query_backlog",
      "search_knowledge",
    ]);
  });
});

describe("CORE_MCP_TOOL_NAMES drift guard", () => {
  it("every core tool name exists in PLATFORM_TOOLS (a rename can't leave a dangling entry)", () => {
    const real = new Set(PLATFORM_TOOLS.map((t) => t.name));
    const missing = [...CORE_MCP_TOOL_NAMES].filter((name) => !real.has(name));
    expect(missing, `core tool names not found in PLATFORM_TOOLS: ${missing.join(", ")}`).toEqual([]);
  });

  it("core is a strict, lean subset (well under the full surface)", () => {
    expect(CORE_MCP_TOOL_NAMES.size).toBeLessThan(PLATFORM_TOOLS.length);
    expect(CORE_MCP_TOOL_NAMES.size).toBeLessThanOrEqual(30);
  });
});
