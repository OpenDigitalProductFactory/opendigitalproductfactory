import { describe, expect, it } from "vitest";

import {
  MCP_PROGRESSIVE_DISCLOSURE_INSTRUCTIONS,
  buildLoadToolsResult,
  buildUnknownToolResult,
} from "./load-tools";

describe("MCP progressive-disclosure bootstrap contract", () => {
  it("keeps the complete recovery workflow in the first 512 initialize characters", () => {
    const preamble = MCP_PROGRESSIVE_DISCLOSURE_INSTRUCTIONS.slice(0, 512);

    expect(MCP_PROGRESSIVE_DISCLOSURE_INSTRUCTIONS.length).toBeLessThanOrEqual(512);
    expect(preamble).toContain("load_tools");
    expect(preamble).toContain("names");
    expect(preamble).toContain("query");
    expect(preamble).toContain("tools/list");
    expect(preamble).toMatch(/programmatic tool catalog/i);
    expect(preamble).toMatch(/resource/i);
    expect(preamble).toMatch(/authorization/i);
  });

  it("explains the programmatic fallback when a host top-level registry stays stale", () => {
    const result = buildLoadToolsResult(
      [{ name: "create_epic", description: "Create a governed epic." }],
      ["create_epic"],
    );

    expect(result.structuredContent).toMatchObject({
      listChanged: true,
      recovery: {
        reListTools: true,
        programmaticCatalogFallback: true,
      },
    });
    expect(result.structuredContent.note).toMatch(/top-level registry/i);
    expect(result.structuredContent.note).toMatch(/programmatic tool catalog/i);
  });

  it("returns machine-readable unknown-tool recovery without calling it authorization", () => {
    const result = buildUnknownToolResult("totally_made_up_tool");

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: "unknown_tool",
      toolName: "totally_made_up_tool",
      recovery: { tool: "load_tools" },
    });
    expect(result.structuredContent.recovery).toHaveProperty("exactName");
    expect(result.structuredContent.recovery).toHaveProperty("intentQuery");
    expect(result.structuredContent.error).not.toBe("insufficient_token_scope");
  });
});
