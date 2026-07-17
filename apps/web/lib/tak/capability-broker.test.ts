import { describe, it, expect } from "vitest";
import type { ToolDefinition } from "@/lib/mcp-tools";
import { brokerCapabilities, DEFAULT_MAX_BROKERED_TOOLS } from "./capability-broker";

const tool = (name: string, description = ""): ToolDefinition => ({
  name,
  description,
  inputSchema: { type: "object" },
  requiredCapability: null,
});

describe("brokerCapabilities", () => {
  it("surfaces the classified intent's authoritative tools (planner-driven, not model-driven)", () => {
    const tools = [
      tool("wiki_query", "search the wiki"),
      tool("query_backlog", "Query backlog items and epics"),
      tool("get_backlog_item", "Fetch one backlog item"),
      tool("search_code_graph", "search code"),
    ];
    const r = brokerCapabilities({ routeContext: "/ops", message: "how many items are still open?", tools });
    expect(r.taskClass).toBe("backlog-status");
    expect(r.brokeredNames).toContain("query_backlog");
    expect(r.brokeredNames).toContain("get_backlog_item");
  });

  it("brokers capabilities BEYOND the route's static domainTools when intent differs", () => {
    // /ops/self-upgrade + a provider question classifies as provider-health, whose
    // authoritative tool (resolve_model_selection) is NOT in /ops domainTools.
    const tools = [
      tool("query_backlog", "Query backlog"),
      tool("resolve_model_selection", "resolve which model runs each phase"),
    ];
    const r = brokerCapabilities({
      routeContext: "/ops/self-upgrade",
      message: "is the local model provider healthy?",
      tools,
    });
    expect(r.taskClass).toBe("provider-health");
    expect(r.brokeredNames).toContain("resolve_model_selection");
  });

  it("only surfaces tools the coworker actually has (authority intact, INV-3)", () => {
    // query_backlog is authoritative for the intent but NOT in availableTools.
    const tools = [tool("wiki_query", "wiki")];
    const r = brokerCapabilities({ routeContext: "/ops", message: "how many items are open?", tools });
    expect(r.brokeredNames).not.toContain("query_backlog");
  });

  it("falls back to keyword relevance when no task class matches", () => {
    const tools = [
      tool("draft_marketing_asset", "draft a marketing campaign asset"),
      tool("wiki_query", "search wiki"),
    ];
    const r = brokerCapabilities({ routeContext: "/customer/marketing", message: "draft a marketing asset", tools });
    expect(r.taskClass).toBeNull();
    expect(r.brokeredNames).toContain("draft_marketing_asset");
  });

  it("bounds the brokered set", () => {
    const tools = Array.from({ length: 40 }, (_, i) => tool(`backlog_tool_${i}`, "backlog items status open"));
    const r = brokerCapabilities({ routeContext: "/ops", message: "backlog items status open?", tools });
    expect(r.brokeredNames.length).toBeLessThanOrEqual(DEFAULT_MAX_BROKERED_TOOLS);
  });

  it("returns an empty set for a non-live-state chat message", () => {
    const tools = [tool("query_backlog", "Query backlog")];
    const r = brokerCapabilities({ routeContext: "/ops", message: "thanks!", tools });
    expect(r.brokeredNames).toEqual([]);
  });
});
