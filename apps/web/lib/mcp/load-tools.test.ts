import { describe, expect, it } from "vitest";

import {
  MCP_PROGRESSIVE_DISCLOSURE_INSTRUCTIONS,
  buildLoadToolsResult,
  buildUnknownToolResult,
  classifyLoadToolsNoMatch,
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

  it("distinguishes an unknown exact name from a known reviewer-only writer", () => {
    const known = new Set(["get_backlog_item", "record_initiative_design_review"]);
    const granted = new Set(["get_backlog_item"]);
    const unknown = buildLoadToolsResult([], [], classifyLoadToolsNoMatch(
      { names: ["record_initiative_plan_review"] }, known, granted, 0,
    ));
    const reviewerOnly = buildLoadToolsResult([], [], classifyLoadToolsNoMatch(
      { names: ["record_initiative_design_review"] }, known, granted, 0,
    ));

    expect(unknown.structuredContent.noMatch).toMatchObject({
      reason: "unknown-tool-name",
      requestedNames: ["record_initiative_plan_review"],
    });
    expect(reviewerOnly.structuredContent.noMatch).toMatchObject({
      reason: "reviewer-route-required",
      supportedEntryPoint: { toolName: "get_backlog_item" },
    });
  });

  it("returns no no-match reason when discovery selected a tool", () => {
    expect(classifyLoadToolsNoMatch(
      { names: ["get_backlog_item"] }, new Set(["get_backlog_item"]), new Set(["get_backlog_item"]), 1,
    )).toBeUndefined();
  });
});
