// apps/web/lib/actions/coworker-tool-budget.ts
//
// Per-turn tool ATTACHMENT budget for in-portal coworkers (EP-COWORKER-INTERACTIVITY,
// BI-F75E897A / BI-6A745E3C). Separates AUTHORITY (what a coworker may do — its
// grants, unchanged) from ATTACHMENT (which tool schemas we send to the model each
// turn). A tier-2 page coworker like the Scrum Master (ops-coordinator) holds only
// 5 grants but those grants + the universal read baseline expand to ~104 tools; at
// ~330 tokens of JSON schema apiece that is ~34k tokens, which overflows a budget
// local model's served context (e.g. n_ctx 32768) and makes every tool-using turn
// fail with exceed_context_size_error. Since a fully-local install has no cloud
// fallback, the coworker dies.
//
// The fix (operator decision 2026-06-22, "cap + load on demand"): attach only a
// right-sized core+role set each turn and DEFER the long tail. Deferred tools are
// NOT revoked — the coworker keeps full authority (BI-FD7E4D72 "every coworker can
// read source + the code graph" survives) and can pull any deferred tool back on
// demand via the load_tools meta-tool. This honors both the breadth criterion and
// the context budget.
//
// Pure + dependency-light so it unit-tests without next-auth or the action surface.

import type { ToolDefinition } from "@/lib/mcp-tools";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { CORE_MCP_TOOL_NAMES } from "@/lib/mcp/tool-tier";
import { LOCAL_TOOL_SELECTION_CLIFF } from "@/lib/tak/context-economy-metrics";

/**
 * Default ceiling on the NON-essential (role/core/breadth) tool schemas attached
 * per coworker turn; the few essential tools (load_tools + route page actions)
 * ride on top. Chosen to keep the serialized tool block comfortably inside a
 * budget local model's served context with room for the system prompt,
 * conversation history, and the reply: ~48 tools * ~330 tok ≈ ~16k tok of schemas,
 * leaving ~16k of a 32k window for everything else. Deferred tools remain
 * authorized and loadable on demand, so this caps cost, never capability. Tune
 * per install as served context grows.
 */
export const MAX_COWORKER_ATTACHED_TOOLS = 48;

/** Rough serialized-JSON token cost of one tool schema. The 48-tool default was
 *  sized against ~330 tok apiece. */
export const TOOL_SCHEMA_TOKEN_ESTIMATE = 330;

/** Tokens reserved per turn for everything that is NOT tool schemas — the system
 *  prompt, accumulated conversation history, and the model's reply. The default
 *  48-tool ceiling implicitly assumed a ~32k window (16k tools + ~16k else); on a
 *  smaller window we must reserve this explicitly or a long thread overflows. */
export const COWORKER_NON_TOOL_RESERVE_TOKENS = 12_000;

/** Never attach fewer than this — below it a coworker is too crippled to be
 *  useful, and the agentic loop's overflow handling covers the pathological case. */
export const MIN_COWORKER_ATTACHED_TOOLS = 12;

/**
 * A small local model's tool-SELECTION accuracy collapses once it is handed more
 * than ~15 tools (`LOCAL_TOOL_SELECTION_CLIFF`) — a soft quality cliff that the
 * window-fit math alone doesn't see (a 24,576 window fits ~38 schemas, well past
 * the cliff). Below this served-context line the model is the cliff-prone small
 * local class, so the attachment cap is bounded by the cliff, not just the window.
 * At/above it the model is capable enough to select from the full window-fit set.
 */
export const ACCURACY_CLIFF_PRONE_MAX_CONTEXT = 32_768;

/**
 * Derive the per-turn tool-attachment cap from the served context window of the
 * model that will run the turn. Two ceilings apply, whichever is smaller:
 *   1. WINDOW-FIT — the hardcoded 48 was sized for a ~32k window; on a
 *      VRAM-constrained local model served at 24,576 tokens, 48 tool schemas
 *      (~16k tokens) plus a long conversation overflow `exceed_context_size_error`.
 *   2. ACCURACY-CLIFF (BI-2B2F59EB) — for a cliff-prone small local window
 *      (< 32k), bound the cap at the ~15-tool selection cliff so a small model
 *      isn't handed a surface it can't select from. Deferred tools stay
 *      authorized and loadable via load_tools, so this caps accuracy cost, never
 *      capability.
 *
 * It binds on the LOCAL model's served context even when a cloud provider is
 * preferred, because the cloud→local FALLBACK path is exactly where these
 * overflows/cliffs happen; the cost on a cloud turn is only a few extra
 * load_tools round-trips, never a failure. `null`/unknown (no small-context
 * local model) → the full 48.
 *
 *   32_768 → 48 (capable; ceiling)   24_576 → 15 (accuracy cliff)   16_000 → 12 (floor)   null → 48
 */
export function deriveCoworkerToolCap(servedContextTokens: number | null | undefined): number {
  if (!servedContextTokens || servedContextTokens <= 0) return MAX_COWORKER_ATTACHED_TOOLS;
  const toolBudgetTokens = servedContextTokens - COWORKER_NON_TOOL_RESERVE_TOKENS;
  const fitted = Math.floor(toolBudgetTokens / TOOL_SCHEMA_TOKEN_ESTIMATE);
  // A cliff-prone small local model also caps at the selection cliff, not just
  // the window fit. Larger/capable windows keep the full window-fit ceiling.
  const ceiling =
    servedContextTokens < ACCURACY_CLIFF_PRONE_MAX_CONTEXT
      ? Math.min(MAX_COWORKER_ATTACHED_TOOLS, LOCAL_TOOL_SELECTION_CLIFF)
      : MAX_COWORKER_ATTACHED_TOOLS;
  return Math.max(MIN_COWORKER_ATTACHED_TOOLS, Math.min(ceiling, fitted));
}

/** Name of the meta-tool that lets a coworker pull deferred tools back on demand. */
export const LOAD_TOOLS_TOOL_NAME = "load_tools";

/** Max tools a single load_tools call may attach — prevents re-overflow when a
 *  broad query matches a large slice of the deferred pool. */
export const LOAD_TOOLS_BATCH_MAX = 16;

/**
 * The load_tools meta-tool. Intercepted inside the agentic loop (it never reaches
 * governedExecuteTool); calling it moves matching deferred tools into the active
 * provider tool set for subsequent iterations. requiredCapability is null because
 * it only re-attaches tools the coworker is ALREADY authorized to use — it grants
 * no new authority.
 */
export const LOAD_TOOLS_TOOL: ToolDefinition = {
  name: LOAD_TOOLS_TOOL_NAME,
  description:
    "Attach additional tools you are authorized to use but that are not in your current set. " +
    "Your everyday tools are already attached; specialised or rarely-used ones (e.g. reading " +
    "source code, the code graph, the wiki, portfolio or estate data) are available on demand to " +
    "keep each turn small. Call this with a keyword `query` (e.g. \"code graph\", \"wiki\", " +
    "\"source file\") or exact `names` when you need a capability you don't currently see, then " +
    "call the newly-loaded tool on the next step.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Keyword to find deferred tools by name or purpose, e.g. 'code graph', 'wiki', 'source', 'portfolio'.",
      },
      names: {
        type: "array",
        items: { type: "string" },
        description: "Exact tool names to attach, when you already know them.",
      },
    },
    additionalProperties: false,
  },
  requiredCapability: null,
  sideEffect: false,
  executionMode: "immediate",
};

export interface ToolBudgetResult {
  /** Tools attached to the model this turn (mandatory always-include + as many
   *  of role/core as fit under the cap). */
  attached: ToolDefinition[];
  /** Authorized tools held back from this turn's schema payload; still callable
   *  via load_tools and still authorized by governedExecuteTool. */
  deferred: ToolDefinition[];
}

/**
 * Right-size the per-turn attachment without touching authority.
 *
 * Priority (highest kept first):
 *   tier 0 — alwaysInclude (e.g. load_tools) + page actions (route-specific, few)
 *   tier 1 — the agent's own role-granted tools (its job)
 *   tier 2 — the curated universal core (CORE_MCP_TOOL_NAMES)
 *   tier 3 — everything else (the read-baseline breadth: source/code-graph/wiki/…)
 *
 * tier 0 is always attached and does NOT consume the cap (essentials ride on top);
 * the cap bounds how many tier 1–3 tools ride along, filled in priority order. So
 * total attached ≈ cap + a small route-scoped essentials set. Ordering within a
 * tier is preserved (stable). The split is deterministic.
 */
export function selectCoworkerToolBudget(params: {
  tools: ToolDefinition[];
  /** Names of route/page action tools — always attached (tier 0). */
  pageActionNames?: ReadonlySet<string>;
  /** The agent's OWN grants (NOT the universal read baseline) — classifies tier 1. */
  roleGrants: readonly string[];
  /** Extra names to force into tier 0 (e.g. load_tools). */
  alwaysIncludeNames?: ReadonlySet<string>;
  cap?: number;
}): ToolBudgetResult {
  const cap = params.cap ?? MAX_COWORKER_ATTACHED_TOOLS;
  const pageActions = params.pageActionNames ?? new Set<string>();
  const always = params.alwaysIncludeNames ?? new Set<string>();
  const roleGrants = [...params.roleGrants];

  const tierOf = (t: ToolDefinition): number => {
    if (always.has(t.name) || pageActions.has(t.name)) return 0;
    if (isToolAllowedByGrants(t.name, roleGrants)) return 1;
    if (CORE_MCP_TOOL_NAMES.has(t.name)) return 2;
    return 3;
  };

  const ranked = params.tools
    .map((t, i) => ({ t, i, tier: tierOf(t) }))
    .sort((a, b) => a.tier - b.tier || a.i - b.i);

  const attached: Array<{ t: ToolDefinition; i: number }> = [];
  const deferred: Array<{ t: ToolDefinition; i: number }> = [];
  // tier-0 (load_tools + page actions) is essential and always attached; it does
  // NOT consume the cap. The cap bounds the non-essential (role/core/breadth)
  // tools, filled in priority order.
  let nonEssentialCount = 0;
  for (const entry of ranked) {
    if (entry.tier === 0) {
      attached.push(entry);
    } else if (nonEssentialCount < cap) {
      attached.push(entry);
      nonEssentialCount++;
    } else {
      deferred.push(entry);
    }
  }

  // Restore original ordering for stable logs / UX.
  attached.sort((a, b) => a.i - b.i);
  deferred.sort((a, b) => a.i - b.i);
  return { attached: attached.map((e) => e.t), deferred: deferred.map((e) => e.t) };
}

/**
 * Select which deferred tools a load_tools({ names?, query? }) call should attach.
 * Matches exact names first, then keyword-matches name/description, dedupes by
 * name, and caps the batch so one broad query cannot re-overflow the context.
 */
export function selectLoadableTools(
  deferred: ToolDefinition[],
  request: { names?: string[]; query?: string },
  batchMax: number = LOAD_TOOLS_BATCH_MAX,
): ToolDefinition[] {
  const picked = new Map<string, ToolDefinition>();

  const wantNames = new Set((request.names ?? []).map((n) => n.trim()).filter(Boolean));
  if (wantNames.size > 0) {
    for (const t of deferred) {
      if (wantNames.has(t.name) && !picked.has(t.name)) picked.set(t.name, t);
    }
  }

  const q = (request.query ?? "").trim().toLowerCase();
  if (q.length > 0) {
    for (const t of deferred) {
      if (picked.size >= batchMax) break;
      if (picked.has(t.name)) continue;
      if (t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)) {
        picked.set(t.name, t);
      }
    }
  }

  return Array.from(picked.values()).slice(0, batchMax);
}
