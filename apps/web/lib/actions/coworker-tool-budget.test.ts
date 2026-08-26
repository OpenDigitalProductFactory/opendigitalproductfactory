import { describe, it, expect } from "vitest";
import type { ToolDefinition } from "@/lib/mcp-tools";
import {
  scoreToolIntentRelevance,
  selectLoadableTools,
  tokenizeIntent,
} from "@/lib/tak/tool-intent";
import {
  selectCoworkerToolBudget,
  deriveCoworkerToolCap,
  deriveSkillCatalogCap,
  capSkillCatalog,
  LOAD_TOOLS_TOOL,
  LOAD_TOOLS_TOOL_NAME,
  MAX_COWORKER_ATTACHED_TOOLS,
  MIN_COWORKER_ATTACHED_TOOLS,
  SKILL_CATALOG_CLIFF_CAP,
} from "./coworker-tool-budget";
import { AUTHORIZED_SURFACE_TOOL_NAMES } from "@/lib/coworker/authorized-surface-coworker-contract";
import { resolveLocalToolCeiling } from "@/lib/routing/local-tool-ceiling";

// THE joint invariant (BI-A8BFEFCE, hardened by BI-8634F0BE).
//
// The attachment budget and the routing local-fallback gate are two ends of one
// policy. Whenever a local model is in the serving path, whatever the budget
// attaches must be something `callWithFallbackChain` will agree to run — it
// refuses any surface above `resolveLocalToolCeiling(measured)`. When the two
// disagree the surface is refused for exceeding a limit nothing else applied,
// local silently leaves the fallback chain, and a cloud outage on top of that
// produces a turn that executes no tools at all.
//
// Both ends were previously only tested in isolation: `fallback.test.ts` held
// zero references to the budget, and the cases below pinned one hardcoded cap-15
// example. This matrix is the guard that actually holds them together.
describe("budget/gate joint invariant", () => {
  const WINDOWS = [null, undefined, 0, 4_096, 12_000, 16_000, 24_576, 32_768, 131_072, 262_144];
  const MEASURED = [null, undefined, -1, 0, 4, 8, 10, 12, 15, 30, 48, 200];
  const PRESENCES = ["present", "unknown"] as const;

  it("never attaches more tools than the routing gate will run locally", () => {
    const violations: string[] = [];
    for (const window of WINDOWS) {
      for (const measured of MEASURED) {
        for (const localPresence of PRESENCES) {
          const cap = deriveCoworkerToolCap(window, {
            localPresence,
            measuredToolFidelityCeiling: measured,
          });
          const gate = resolveLocalToolCeiling(measured);
          if (cap > gate) {
            violations.push(
              `window=${window} measured=${measured} presence=${localPresence} → cap=${cap} > gate=${gate}`,
            );
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("follows a measured ceiling BELOW the minimum floor rather than overriding it", () => {
    // The regression this guard exists for. `max(MIN, min(ceiling, fitted))` put
    // the floor last, so a model measured at 8 was handed 12 tools and then
    // refused by the gate at 8 — nothing ran.
    for (const measured of [4, 8, 10]) {
      expect(deriveCoworkerToolCap(24_576, { localPresence: "present", measuredToolFidelityCeiling: measured }))
        .toBe(measured);
      expect(deriveCoworkerToolCap(null, { localPresence: "unknown", measuredToolFidelityCeiling: measured }))
        .toBe(measured);
    }
  });

  it("still floors WINDOW-fit shrinkage at the minimum — the floor's real purpose", () => {
    // A tiny window drives fitted below the floor; with no measured evidence the
    // ceiling is the cliff (15), so the floor legitimately binds at 12.
    expect(deriveCoworkerToolCap(4_096, { localPresence: "present" })).toBe(MIN_COWORKER_ATTACHED_TOOLS);
    expect(deriveCoworkerToolCap(1_000, { localPresence: "present" })).toBe(MIN_COWORKER_ATTACHED_TOOLS);
    expect(deriveCoworkerToolCap(16_000, { localPresence: "present" })).toBe(MIN_COWORKER_ATTACHED_TOOLS);
  });

  it("leaves a cloud turn unbounded by the local gate", () => {
    // `absent` means local is not a candidate, so the gate never runs and the
    // full ceiling is correct even though it exceeds the local cliff.
    expect(deriveCoworkerToolCap(null, { localPresence: "absent" })).toBe(MAX_COWORKER_ATTACHED_TOOLS);
    expect(deriveCoworkerToolCap(131_072, { localPresence: "absent" })).toBe(MAX_COWORKER_ATTACHED_TOOLS);
  });
});

describe("deriveCoworkerToolCap", () => {
  it("caps an exact 32k local window at the 15-tool accuracy cliff", () => {
    expect(deriveCoworkerToolCap(32_768)).toBe(15);
  });

  it("caps a cliff-prone 24,576 window at the 15-tool accuracy cliff (BI-2B2F59EB)", () => {
    // Window-fit alone would allow ~38 tools ((24576-12000)/330), well past the
    // ~15-tool cliff where a small local model's selection accuracy collapses.
    const cap = deriveCoworkerToolCap(24_576);
    expect(cap).toBe(15);
    // Still well within the window (prompt+history+reply fit comfortably).
    expect(cap * 330).toBeLessThan(24_576 - 8_000);
  });

  it("floors the cap rather than returning zero on a tiny window", () => {
    expect(deriveCoworkerToolCap(4_096)).toBe(MIN_COWORKER_ATTACHED_TOOLS);
    expect(deriveCoworkerToolCap(1_000)).toBe(MIN_COWORKER_ATTACHED_TOOLS);
  });

  it("returns the full ceiling when there is NO local model in the serving path (cloud)", () => {
    // Legacy shape: with no explicit presence, an absent window still reads as a
    // cloud turn, unaffected by the local selection cliff. Callers that CAN tell
    // an absent model from an unread one pass localPresence — see below.
    expect(deriveCoworkerToolCap(null)).toBe(MAX_COWORKER_ATTACHED_TOOLS);
    expect(deriveCoworkerToolCap(undefined)).toBe(MAX_COWORKER_ATTACHED_TOOLS);
    expect(deriveCoworkerToolCap(0)).toBe(MAX_COWORKER_ATTACHED_TOOLS);
    // Explicit absence is the same answer, stated honestly.
    expect(deriveCoworkerToolCap(null, { localPresence: "absent" })).toBe(
      MAX_COWORKER_ATTACHED_TOOLS,
    );
  });

  it("cliff-caps an UNREADABLE local window rather than widening it (BI-A8BFEFCE)", () => {
    // The reviewer incident: the DMR probe failed, the window read as null, and
    // the cap lifted to 48 — the one value callWithFallbackChain refuses to run
    // locally (48 > the 15 cliff). With the cloud provider rate-limited the turn
    // executed zero tools and the review gate got no evidence at all. An unread
    // local model must behave like a present one, never like an absent one.
    expect(deriveCoworkerToolCap(null, { localPresence: "unknown" })).toBe(15);
    expect(deriveCoworkerToolCap(null, { localPresence: "present" })).toBe(15);
    expect(deriveCoworkerToolCap(undefined, { localPresence: "unknown" })).toBe(15);
    expect(deriveCoworkerToolCap(0, { localPresence: "unknown" })).toBe(15);
  });

  it("keeps an unreadable window inside the measured ceiling when one exists", () => {
    // Measured fidelity still applies without a window — it is a property of the
    // model, not of the probe that failed to read its serving config.
    expect(
      deriveCoworkerToolCap(null, { localPresence: "unknown", measuredToolFidelityCeiling: 30 }),
    ).toBe(30);
    expect(
      deriveCoworkerToolCap(null, { localPresence: "present", measuredToolFidelityCeiling: 200 }),
    ).toBe(MAX_COWORKER_ATTACHED_TOOLS);
  });

  it("lets explicit presence override the window-derived guess", () => {
    // A known window with an explicitly absent local model is a cloud turn: the
    // window belongs to something that is no longer in the serving path.
    expect(deriveCoworkerToolCap(131_072, { localPresence: "absent" })).toBe(
      MAX_COWORKER_ATTACHED_TOOLS,
    );
  });

  it("cliff-caps a LARGE local window — capacity is not selection fidelity (BI-B5C358B1)", () => {
    // The Scrum Master incident: qwen3.6 served 131,072 tokens, was handed 48
    // tools, made zero tool calls, and fabricated. A large window measures FIT,
    // not tool-SELECTION skill — a small local model still collapses past ~15.
    expect(deriveCoworkerToolCap(131_072)).toBe(15);
    expect(deriveCoworkerToolCap(200_000)).toBe(15);
    expect(deriveCoworkerToolCap(32_769)).toBe(15);
    expect(deriveCoworkerToolCap(31_999)).toBe(15);
  });

  it("honors a MEASURED tool-fidelity ceiling (the Phase-2 exemption path)", () => {
    // When a model has measured evidence it selects reliably from more than the
    // cliff, the caller passes that ceiling and the cap follows it (bounded by 48).
    expect(deriveCoworkerToolCap(131_072, { measuredToolFidelityCeiling: 40 })).toBe(40);
    expect(deriveCoworkerToolCap(131_072, { measuredToolFidelityCeiling: 200 })).toBe(
      MAX_COWORKER_ATTACHED_TOOLS,
    );
    // An unmeasured/absent ceiling stays fail-safe at the cliff.
    expect(deriveCoworkerToolCap(131_072, { measuredToolFidelityCeiling: null })).toBe(15);
  });

  it("is monotonic — a larger window never yields fewer tools", () => {
    const sizes = [4_096, 12_000, 16_000, 20_000, 24_576, 28_000, 32_768, 64_000];
    const caps = sizes.map((s) => deriveCoworkerToolCap(s));
    for (let i = 1; i < caps.length; i++) expect(caps[i]).toBeGreaterThanOrEqual(caps[i - 1]);
  });
});

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
describe("deriveSkillCatalogCap", () => {
  it("caps to the selection cliff on a cliff-prone small local window", () => {
    expect(deriveSkillCatalogCap(24_576)).toBe(SKILL_CATALOG_CLIFF_CAP);
    expect(deriveSkillCatalogCap(32_768)).toBe(SKILL_CATALOG_CLIFF_CAP);
    expect(deriveSkillCatalogCap(31_999)).toBe(SKILL_CATALOG_CLIFF_CAP);
  });

  it("is uncapped (Infinity) on a capable window — cloud/large installs unchanged", () => {
    expect(deriveSkillCatalogCap(32_769)).toBe(Number.POSITIVE_INFINITY);
    expect(deriveSkillCatalogCap(131_072)).toBe(Number.POSITIVE_INFINITY);
  });

  it("is uncapped when the served context is unknown (no local model / cloud)", () => {
    // Legacy shape: with no explicit presence, an absent window still reads as a
    // cloud turn. Callers that CAN tell absent from unread pass localPresence.
    expect(deriveSkillCatalogCap(null)).toBe(Number.POSITIVE_INFINITY);
    expect(deriveSkillCatalogCap(undefined)).toBe(Number.POSITIVE_INFINITY);
    expect(deriveSkillCatalogCap(0)).toBe(Number.POSITIVE_INFINITY);
    // Explicit absence is the same answer, stated honestly.
    expect(deriveSkillCatalogCap(null, { localPresence: "absent" })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("caps an UNREADABLE window rather than uncapping it (BI-DBEEC15B)", () => {
    // The null carries two facts — no local model, and a probe that could not
    // read one. Only the first justifies enumerating the whole catalog. Eight
    // agents on the live install sit above this cap (platform-engineer holds 45
    // skills ≈ 3.8k tokens), so the uncapped path is genuinely reachable.
    expect(deriveSkillCatalogCap(null, { localPresence: "unknown" })).toBe(
      SKILL_CATALOG_CLIFF_CAP,
    );
    expect(deriveSkillCatalogCap(null, { localPresence: "present" })).toBe(
      SKILL_CATALOG_CLIFF_CAP,
    );
    expect(deriveSkillCatalogCap(undefined, { localPresence: "unknown" })).toBe(
      SKILL_CATALOG_CLIFF_CAP,
    );
    expect(deriveSkillCatalogCap(0, { localPresence: "unknown" })).toBe(SKILL_CATALOG_CLIFF_CAP);
  });

  it("still lets a KNOWN large local window stay uncapped — this axis is fit, not fidelity", () => {
    // Deliberately unlike the tool cap, which binds on presence alone. A local
    // model with room for the catalog keeps the whole catalog.
    expect(deriveSkillCatalogCap(131_072, { localPresence: "present" })).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(deriveSkillCatalogCap(24_576, { localPresence: "present" })).toBe(
      SKILL_CATALOG_CLIFF_CAP,
    );
  });

  it("lets explicit absence override a known window", () => {
    expect(deriveSkillCatalogCap(24_576, { localPresence: "absent" })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("capSkillCatalog", () => {
  const skills = Array.from({ length: 38 }, (_, i) => ({ skillId: `skill-${i}`, n: i }));

  it("returns a copy unchanged when the cap is Infinity (capable/cloud window)", () => {
    const out = capSkillCatalog(skills, Number.POSITIVE_INFINITY);
    expect(out).toHaveLength(38);
    expect(out).not.toBe(skills); // copy, not the same reference
    expect(out.map((s) => s.skillId)).toEqual(skills.map((s) => s.skillId));
  });

  it("keeps the top-N (relevance order preserved) when over the cap", () => {
    const out = capSkillCatalog(skills, 15);
    expect(out).toHaveLength(15);
    expect(out[0]?.skillId).toBe("skill-0");
    expect(out[14]?.skillId).toBe("skill-14");
  });

  it("never drops an explicitly-invoked skill even when it falls beyond the cap", () => {
    const out = capSkillCatalog(skills, 15, "skill-30");
    expect(out.some((s) => s.skillId === "skill-30")).toBe(true);
    // top-15 are retained plus the pinned one appended.
    expect(out).toHaveLength(16);
  });

  it("does not duplicate a pinned skill that is already within the cap", () => {
    const out = capSkillCatalog(skills, 15, "skill-3");
    expect(out).toHaveLength(15);
    expect(out.filter((s) => s.skillId === "skill-3")).toHaveLength(1);
  });

  it("is a no-op copy when the list is already within the cap", () => {
    const few = skills.slice(0, 10);
    const out = capSkillCatalog(few, 15);
    expect(out).toHaveLength(10);
    expect(out).not.toBe(few);
  });
});

describe("selectCoworkerToolBudget", () => {
  it("keeps every authorized ASC protocol tool attached under the normal local cap", () => {
    const surfaceTools = [...AUTHORIZED_SURFACE_TOOL_NAMES].map((name) => tool(name));
    const tools = [...surfaceTools, ...Array.from({ length: 30 }, (_, i) => tool(`tail_${i}`))];
    const { attached } = selectCoworkerToolBudget({
      tools,
      roleGrants: [],
      alwaysIncludeNames: AUTHORIZED_SURFACE_TOOL_NAMES,
      cap: 15,
    });
    const names = new Set(attached.map((entry) => entry.name));
    for (const name of AUTHORIZED_SURFACE_TOOL_NAMES) expect(names.has(name)).toBe(true);
    expect(attached.length).toBeLessThanOrEqual(15);
  });
  it("bounds the TOTAL attached surface — essentials take priority within the cap, not on top of it", () => {
    // BI-CAP-F2D39F8F follow-through: essentials riding on top of the cap made
    // the attached set exceed the routing layer's local-fallback gate (cap 15 +
    // route tools + load_tools = 20 → local serving disqualified).
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
      cap: 3,
    });
    const names = attached.map((t) => t.name);
    // Total stays within the cap; tier-0 wins the first slots, then tier-1.
    expect(attached).toHaveLength(3);
    expect(names).toContain(LOAD_TOOLS_TOOL_NAME);
    expect(names).toContain("page_action_x");
    expect(names).toContain("create_backlog_item");
    expect(deferred.map((t) => t.name)).toEqual(["wiki_query", "search_code_graph"]);
  });

  it("keeps route domain tools first under the cap so route-relevant tools survive (BI-B5C358B1)", () => {
    // The Scrum Master incident shape: the backlog tools do not lexically match
    // "pressing/issues/resolved", so the intent ranker scores them 0 and, under a
    // tight local cap, they would be deferred. Tier-0 priority (as agent-coworker
    // passes route domainTools) attaches them ahead of everything else.
    const tools = [
      tool("wiki_query", "wiki"),
      tool("search_code_graph", "code graph"),
      tool("get_backlog_item", "Fetch one backlog item by id"),
      tool("query_backlog", "Query backlog items and epics"),
    ];
    const intentQuery = "have the pressing issues been resolved";
    const { attached, deferred } = selectCoworkerToolBudget({
      tools,
      roleGrants: ["backlog_read"],
      pageActionNames: new Set(["query_backlog", "get_backlog_item"]), // route domainTools
      alwaysIncludeNames: new Set([LOAD_TOOLS_TOOL_NAME]),
      cap: 2,
      intentQuery,
    });
    const names = attached.map((t) => t.name);
    expect(attached).toHaveLength(2);
    expect(names).toContain("query_backlog");
    expect(names).toContain("get_backlog_item");
    expect(deferred.map((t) => t.name)).not.toContain("query_backlog");
  });

  it("never exceeds the local-fallback gate: cap-15 + route tools + load_tools attach ≤ 15 total", () => {
    // Regression for the live TR-SCHED-7044CD4F miss: 115 authorized, cap 15,
    // 4 route domain tools + load_tools rode on top → attached=20 → routing
    // skipped the local fallback ("20 tools > 15 threshold") and the run died
    // on exhausted cloud pools. Total-inclusive budgeting keeps the surface
    // servable locally.
    const surface = [
      tool(LOAD_TOOLS_TOOL_NAME),
      ...Array.from({ length: 4 }, (_, i) => tool(`storefront_action_${i}`)),
      ...Array.from({ length: 110 }, (_, i) => tool(`breadth_${i}`, "misc")),
    ];
    const { attached, deferred } = selectCoworkerToolBudget({
      tools: surface,
      roleGrants: [],
      pageActionNames: new Set(["storefront_action_0", "storefront_action_1", "storefront_action_2", "storefront_action_3"]),
      alwaysIncludeNames: new Set([LOAD_TOOLS_TOOL_NAME]),
      cap: 15,
    });
    expect(attached.length).toBeLessThanOrEqual(15);
    const names = attached.map((t) => t.name);
    expect(names).toContain(LOAD_TOOLS_TOOL_NAME);
    for (let i = 0; i < 4; i++) expect(names).toContain(`storefront_action_${i}`);
    expect(attached.length + deferred.length).toBe(surface.length);
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

describe("task-intent tool prioritization (BI-ACE1EBA4)", () => {
  it("scores a tool by intent-token overlap with its name + description", () => {
    const t = tool("create_invoice", "draft and send a customer invoice");
    const tokens = tokenizeIntent("please draft an invoice for the customer");
    expect(scoreToolIntentRelevance(t, tokens)).toBeGreaterThanOrEqual(2); // invoice + customer
    expect(scoreToolIntentRelevance(t, tokenizeIntent("check the weather"))).toBe(0);
  });

  it("keeps the intent-relevant tools within a tier when the cap forces deferral", () => {
    // All three are tier-3 breadth tools; the cap (1) can keep only one.
    const tools = [
      tool("weather_lookup", "forecast the weather"),
      tool("invoice_search", "search invoices and billing records"),
      tool("song_lyrics", "fetch song lyrics"),
    ];
    const { attached, deferred } = selectCoworkerToolBudget({
      tools,
      roleGrants: [], // none are role tools → all tier 3
      cap: 1,
      intentQuery: "find an invoice for billing",
    });
    expect(attached.map((t) => t.name)).toEqual(["invoice_search"]);
    expect(deferred.map((t) => t.name).sort()).toEqual(["song_lyrics", "weather_lookup"]);
  });

  it("never lets intent relevance override tier priority", () => {
    // A highly-relevant breadth tool must still lose to a role tool under the cap.
    const tools = [
      tool("invoice_search", "search invoices billing invoice invoice"), // tier 3, very relevant
      tool("create_backlog_item", "file a backlog item"), // tier 1 (role)
    ];
    const { attached } = selectCoworkerToolBudget({
      tools,
      roleGrants: ["backlog_write"],
      cap: 1,
      intentQuery: "invoice invoice invoice billing",
    });
    // The role tool (tier 1) is kept even though the breadth tool scores higher.
    expect(attached.map((t) => t.name)).toEqual(["create_backlog_item"]);
  });

  it("is identical to the prior stable order when no intent query is given", () => {
    const tools = [tool("a_tool"), tool("b_tool"), tool("c_tool")];
    const withNoIntent = selectCoworkerToolBudget({ tools, roleGrants: [], cap: 2 });
    expect(withNoIntent.attached.map((t) => t.name)).toEqual(["a_tool", "b_tool"]);
  });
});
