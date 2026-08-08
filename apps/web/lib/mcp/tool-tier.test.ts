import { describe, it, expect } from "vitest";
import {
  resolveMcpToolTier,
  parseExplicitTier,
  defaultTierForClient,
  resolveEffectiveTier,
  selectToolsByTier,
  selectToolsForListing,
  resolveLoadToolsSelection,
  mergeLoadedToolNames,
  isToolSessionExpired,
  LOAD_TOOLS_TOOL_NAME,
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

describe("parseExplicitTier", () => {
  it("returns the explicit tier only for exact core/full", () => {
    expect(parseExplicitTier("core")).toBe("core");
    expect(parseExplicitTier("FULL")).toBe("full");
  });
  it("returns null for absent/unknown (so the default can apply)", () => {
    expect(parseExplicitTier(null)).toBeNull();
    expect(parseExplicitTier(undefined)).toBeNull();
    expect(parseExplicitTier("")).toBeNull();
    expect(parseExplicitTier("lean")).toBeNull();
  });
});

describe("defaultTierForClient", () => {
  it("keeps Claude Code on full (it defers the catalogue client-side)", () => {
    expect(defaultTierForClient("claude-code/2.1")).toBe("full");
    expect(defaultTierForClient("claude-code")).toBe("full");
    expect(defaultTierForClient("Claude-Code/9")).toBe("full");
  });
  it("defaults every other / unknown client to the lean core surface", () => {
    expect(defaultTierForClient("codex/1.0")).toBe("core");
    expect(defaultTierForClient("grok/2")).toBe("core");
    expect(defaultTierForClient("some-customer-agent")).toBe("core");
    expect(defaultTierForClient(undefined)).toBe("core");
    expect(defaultTierForClient(null)).toBe("core");
  });
  it("does not match a client that merely contains 'claude-code' mid-token", () => {
    expect(defaultTierForClient("not-claude-code")).toBe("core");
  });
});

describe("resolveEffectiveTier", () => {
  it("an explicit ?tier= always wins over the client default", () => {
    expect(resolveEffectiveTier("full", "codex/1")).toBe("full"); // codex opts back in
    expect(resolveEffectiveTier("core", "claude-code/2")).toBe("core"); // CC opts down
  });
  it("falls back to the client default when no explicit tier is given", () => {
    expect(resolveEffectiveTier(null, "claude-code/2")).toBe("full");
    expect(resolveEffectiveTier(undefined, "codex/1")).toBe("core");
    expect(resolveEffectiveTier("", undefined)).toBe("core");
  });
});

describe("selectToolsByTier", () => {
  const tools = [
    { name: "query_backlog" },
    { name: "deploy_feature" },
    { name: "search_knowledge" },
    { name: "request_self_upgrade" },
    { name: "record_runtime_verification" },
  ];

  it("full tier is identity", () => {
    expect(selectToolsByTier(tools, "full")).toEqual(tools);
  });

  it("core tier keeps only core names", () => {
    expect(selectToolsByTier(tools, "core").map((t) => t.name)).toEqual([
      "query_backlog",
      "search_knowledge",
      "request_self_upgrade",
      "record_runtime_verification",
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

  it("keeps the governed live-delivery workflow discoverable for non-Claude external agents", () => {
    expect([...CORE_MCP_TOOL_NAMES]).toEqual(
      expect.arrayContaining([
        "get_quiescence_status",
        "get_self_upgrade_queue_status",
        "request_self_upgrade",
        "repair_promoter_image",
        "record_runtime_verification",
      ]),
    );
  });

  it("keeps WWMD kernel tools discoverable for Grok/Codex (no client ToolSearch)", () => {
    // Peer CLIs default to core; AGENTS.md requires principle_decide before
    // multi-option platform menus. Discovery-only gap was blocking Grok WWMD.
    expect(CORE_MCP_TOOL_NAMES.has("principle_decide")).toBe(true);
    expect(CORE_MCP_TOOL_NAMES.has("wiki_query")).toBe(true);
  });
});

describe("Phase 2 — deferred loading (selectToolsForListing / append-not-swap)", () => {
  const GRANTED = [
    { name: "query_backlog" }, // in core
    { name: "search_knowledge" }, // in core
    { name: "deploy_feature" }, // NOT in core
    { name: "create_quote" }, // NOT in core
  ];

  it("core tier with no loaded tools returns exactly the core floor", () => {
    const listed = selectToolsForListing(GRANTED, "core", new Set());
    expect(listed.map((t) => t.name)).toEqual(["query_backlog", "search_knowledge"]);
  });

  it("APPENDS session-loaded tools to the core floor (never swaps it)", () => {
    const listed = selectToolsForListing(GRANTED, "core", new Set(["deploy_feature"]));
    // Floor stays first and intact; the loaded tool is appended after it.
    expect(listed.map((t) => t.name)).toEqual([
      "query_backlog",
      "search_knowledge",
      "deploy_feature",
    ]);
  });

  it("never double-lists a loaded tool already in the floor", () => {
    const listed = selectToolsForListing(GRANTED, "core", new Set(["query_backlog"]));
    expect(listed.map((t) => t.name)).toEqual(["query_backlog", "search_knowledge"]);
  });

  it("full tier is unchanged by loaded state (whole granted surface already shown)", () => {
    const listed = selectToolsForListing(GRANTED, "full", new Set(["deploy_feature"]));
    expect(listed.map((t) => t.name)).toEqual(GRANTED.map((t) => t.name));
  });
});

describe("Phase 2 — resolveLoadToolsSelection", () => {
  const GRANTED = [
    { name: "deploy_feature", description: "Deploy a built feature to the live install." },
    { name: "create_quote", description: "Create a customer quote document." },
    { name: "list_quotes", description: "List existing customer quotes." },
  ];

  it("selects by exact names", () => {
    const sel = resolveLoadToolsSelection(GRANTED, { names: ["deploy_feature"] });
    expect(sel.map((t) => t.name)).toEqual(["deploy_feature"]);
  });

  it("selects by case-insensitive query over name and description", () => {
    const sel = resolveLoadToolsSelection(GRANTED, { query: "QUOTE" });
    expect(sel.map((t) => t.name).sort()).toEqual(["create_quote", "list_quotes"]);
  });

  it("de-duplicates when names and query overlap, preserving grant order", () => {
    const sel = resolveLoadToolsSelection(GRANTED, { names: ["create_quote"], query: "quote" });
    expect(sel.map((t) => t.name)).toEqual(["create_quote", "list_quotes"]);
  });

  it("returns nothing for an empty request or non-matching input", () => {
    expect(resolveLoadToolsSelection(GRANTED, {})).toEqual([]);
    expect(resolveLoadToolsSelection(GRANTED, { names: ["nope"], query: "zzz" })).toEqual([]);
  });

  it("ignores non-string names in the array", () => {
    const sel = resolveLoadToolsSelection(GRANTED, { names: ["deploy_feature", 42, null] as unknown[] });
    expect(sel.map((t) => t.name)).toEqual(["deploy_feature"]);
  });
});

describe("Phase 2 — session-store pure helpers", () => {
  it("merges loaded names de-duplicated and sorted", () => {
    expect(mergeLoadedToolNames(["b", "a"], ["a", "c"])).toEqual(["a", "b", "c"]);
    expect(mergeLoadedToolNames([], [])).toEqual([]);
  });

  it("treats a session as expired only once expiry has passed", () => {
    const now = new Date("2026-08-07T12:00:00Z");
    expect(isToolSessionExpired(new Date("2026-08-07T11:59:59Z"), now)).toBe(true);
    expect(isToolSessionExpired(new Date("2026-08-07T12:00:00Z"), now)).toBe(true); // boundary = expired
    expect(isToolSessionExpired(new Date("2026-08-07T12:00:01Z"), now)).toBe(false);
  });

  it("exposes the load_tools meta-tool name", () => {
    expect(LOAD_TOOLS_TOOL_NAME).toBe("load_tools");
  });
});
