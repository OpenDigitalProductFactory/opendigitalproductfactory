import { describe, it, expect } from "vitest";
import type { ToolDefinition } from "@/lib/mcp-tools";
import {
  selectCoworkerToolBudget,
  selectLoadableTools,
  LOAD_TOOLS_TOOL,
  LOAD_TOOLS_TOOL_NAME,
  MAX_COWORKER_ATTACHED_TOOLS,
} from "./coworker-tool-budget";

const tool = (name: string, description = ""): ToolDefinition => ({
  name,
  description,
  inputSchema: { type: "object" },
  requiredCapability: null,
});

// Tier fixtures use REAL grant mappings so the test pins live classification:
//   create_backlog_item  -> requires backlog_write  => tier 1 (role) under ["backlog_write"]
//   search_code_graph    -> in CORE, requires code_graph_read => tier 2 (core, not role)
//   wiki_query           -> requires registry_read, not in CORE => tier 3 (breadth tail)
describe("selectCoworkerToolBudget", () => {
  it("always attaches tier-0 (load_tools + page actions) even past the cap", () => {
    const tools = [
      tool("wiki_query"),
      tool("create_backlog_item"),
      tool("search_code_graph"),
      tool(LOAD_TOOLS_TOOL_NAME),
      tool("page_action_x"),
    ];
    const { attached, deferred } = selectCoworkerToolBudget({
      tools,
      roleGrants: ["backlog_write"],
      pageActionNames: new Set(["page_action_x"]),
      alwaysIncludeNames: new Set([LOAD_TOOLS_TOOL_NAME]),
      cap: 2,
    });
    const names = attached.map((t) => t.name);
    expect(names).toContain(LOAD_TOOLS_TOOL_NAME);
    expect(names).toContain("page_action_x");
    // cap=2 fills with role (tier1) then core (tier2); the tier-3 tail defers.
    expect(names).toContain("create_backlog_item");
    expect(names).toContain("search_code_graph");
    expect(deferred.map((t) => t.name)).toEqual(["wiki_query"]);
  });

  it("prefers role tools over core, and core over the breadth tail, when the cap bites", () => {
    const tools = [tool("wiki_query"), tool("search_code_graph"), tool("create_backlog_item")];
    const { attached, deferred } = selectCoworkerToolBudget({
      tools,
      roleGrants: ["backlog_write"],
      cap: 1,
    });
    expect(attached.map((t) => t.name)).toEqual(["create_backlog_item"]); // tier 1 wins the only slot
    expect(deferred.map((t) => t.name)).toEqual(["wiki_query", "search_code_graph"]);
  });

  it("returns everything attached when under the cap (no deferral)", () => {
    const tools = [tool("create_backlog_item"), tool("search_code_graph")];
    const { attached, deferred } = selectCoworkerToolBudget({ tools, roleGrants: ["backlog_write"] });
    expect(attached).toHaveLength(2);
    expect(deferred).toHaveLength(0);
  });

  it("preserves original ordering within the attached set (stable)", () => {
    const tools = [tool("search_code_graph"), tool("create_backlog_item")];
    const { attached } = selectCoworkerToolBudget({ tools, roleGrants: ["backlog_write"], cap: 10 });
    expect(attached.map((t) => t.name)).toEqual(["search_code_graph", "create_backlog_item"]);
  });

  it("defaults the cap to MAX_COWORKER_ATTACHED_TOOLS", () => {
    const tools = Array.from({ length: MAX_COWORKER_ATTACHED_TOOLS + 5 }, (_, i) => tool(`wiki_query_${i}`, "x"));
    // none are role/core → tier 3; exactly cap attach, the rest defer.
    const { attached, deferred } = selectCoworkerToolBudget({ tools, roleGrants: [] });
    expect(attached).toHaveLength(MAX_COWORKER_ATTACHED_TOOLS);
    expect(deferred).toHaveLength(5);
  });
});

describe("selectLoadableTools", () => {
  const deferred = [
    tool("search_code_graph", "Search the code intelligence graph"),
    tool("trace_code_surface", "Trace a code surface across the graph"),
    tool("wiki_query", "Query the platform wiki"),
    tool("search_integrations", "Search configured integrations"),
  ];

  it("matches exact names", () => {
    const got = selectLoadableTools(deferred, { names: ["wiki_query"] });
    expect(got.map((t) => t.name)).toEqual(["wiki_query"]);
  });

  it("keyword-matches name or description", () => {
    const got = selectLoadableTools(deferred, { query: "code" });
    expect(got.map((t) => t.name).sort()).toEqual(["search_code_graph", "trace_code_surface"]);
  });

  it("dedupes when names and query overlap", () => {
    const got = selectLoadableTools(deferred, { names: ["wiki_query"], query: "wiki" });
    expect(got.map((t) => t.name)).toEqual(["wiki_query"]);
  });

  it("caps the batch size", () => {
    const many = Array.from({ length: 30 }, (_, i) => tool(`graph_tool_${i}`, "graph"));
    expect(selectLoadableTools(many, { query: "graph" }, 16)).toHaveLength(16);
  });

  it("returns nothing for an empty request", () => {
    expect(selectLoadableTools(deferred, {})).toEqual([]);
  });
});

describe("LOAD_TOOLS_TOOL definition", () => {
  it("is read-only and grants no new authority (intercepted, never governed-executed)", () => {
    expect(LOAD_TOOLS_TOOL.name).toBe(LOAD_TOOLS_TOOL_NAME);
    expect(LOAD_TOOLS_TOOL.requiredCapability).toBeNull();
    expect(LOAD_TOOLS_TOOL.sideEffect).toBe(false);
  });
});
