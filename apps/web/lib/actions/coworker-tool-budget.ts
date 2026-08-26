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
import { resolveLocalToolCeiling, type LocalPresence } from "@/lib/routing/local-tool-ceiling";
import {
  LOAD_TOOLS_TOOL_NAME,
  scoreToolIntentRelevance,
  tokenizeIntent,
} from "@/lib/tak/tool-intent";
export {
  LOAD_TOOLS_BATCH_MAX,
  LOAD_TOOLS_TOOL_NAME,
  selectLoadableTools,
} from "@/lib/tak/tool-intent";

/**
 * Default ceiling on the TOTAL tool schemas attached per coworker turn —
 * essentials (load_tools + route page actions) take top priority within it,
 * they do not ride on top (the local selection cliff and the routing-layer
 * local-fallback gate both judge the whole attached set). Chosen to keep the
 * serialized tool block comfortably inside a budget local model's served
 * context with room for the system prompt, conversation history, and the
 * reply: ~48 tools * ~330 tok ≈ ~16k tok of schemas, leaving ~16k of a 32k
 * window for everything else. Deferred tools remain authorized and loadable on
 * demand, so this caps cost, never capability. Tune per install as served
 * context grows.
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
 *  useful, and the agentic loop's overflow handling covers the pathological case.
 *
 *  Scope of the floor (BI-8634F0BE): it bounds the WINDOW-FIT term only. A
 *  MEASURED tool-fidelity ceiling below this value wins, and the cap follows the
 *  measurement. Attaching more than a model has proven it can select from is not
 *  a kindness — `callWithFallbackChain` refuses the surface outright, so the
 *  coworker gets nothing instead of a small working set. */
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

/** Options for the per-turn tool-attachment cap (EP-E431FC8A · BI-B5C358B1). */
export interface CoworkerToolCapOptions {
  /**
   * A MEASURED tool-selection-fidelity ceiling for the local model that will run
   * the turn: the largest attached-tool surface at which its measured accuracy
   * stays above threshold (produced by the Phase-2 eval harness). When present
   * and positive, it replaces the fail-safe cliff ceiling — this is the ONLY way
   * a local model is trusted with more than `LOCAL_TOOL_SELECTION_CLIFF` tools.
   * Absent/null/≤0 → the fail-safe cliff applies. Never lets a model exceed the
   * window-fit or the 48 hard ceiling.
   */
  measuredToolFidelityCeiling?: number | null;
  /**
   * Whether a local generation model is in the serving path (BI-A8BFEFCE).
   *
   * Supply this from `resolveLocalServingPosture`. Only `absent` lifts the cap
   * to the full 48; `present` and `unknown` both bind to the selection ceiling.
   * Omitted → derived from `servedContextTokens` for backward compatibility,
   * which cannot tell an absent model from an unread one.
   */
  localPresence?: LocalPresence;
}

/**
 * Derive the per-turn tool-attachment cap. Three ceilings apply, whichever is
 * smallest:
 *   1. WINDOW-FIT — 48 was sized for a ~32k window; a VRAM-constrained local
 *      model served at 24,576 tokens overflows `exceed_context_size_error` with
 *      48 schemas (~16k tokens) plus a long thread.
 *   2. SELECTION-CLIFF (BI-2B2F59EB, BI-B5C358B1) — a small local model's tool-
 *      SELECTION accuracy collapses past ~15 tools. This is a property of the
 *      MODEL, not its context window: a large served window (e.g. 131,072) means
 *      the tools *fit*, NOT that the model can *choose* among them. So whenever a
 *      local model is in the serving path (any non-null served context) the cliff
 *      binds — regardless of window size — unless there is measured fidelity
 *      evidence to the contrary (`measuredToolFidelityCeiling`). Deferred tools
 *      stay authorized and loadable via load_tools, so this caps accuracy cost,
 *      never capability.
 *   3. HARD CEILING — never above `MAX_COWORKER_ATTACHED_TOOLS` (48).
 *
 * `servedContextTokens` is the LOCAL model's served context (from the DMR truth);
 * it binds even when a cloud provider is preferred, because the cloud→local
 * FALLBACK is exactly where these cliffs bite.
 *
 * PRESENCE, not the window, decides whether the cliff applies (BI-A8BFEFCE).
 * A null window used to mean "pure cloud turn → the full 48", but the probe that
 * produces it returns null for an unread local model too. On a flaky probe that
 * lifted the surface to 48 — the one value the routing layer refuses to run
 * locally — so a transient read failure silently deleted the install's only
 * fallback, and a cloud rate-limit on top of it produced a turn that executed
 * nothing. Now only `localPresence: "absent"` lifts the cap; `unknown` fails safe.
 *
 * This function is the SINGLE SOURCE of the coworker tool-count policy (INV-6),
 * deriving its local ceiling from `resolveLocalToolCeiling` — the same function
 * the routing-layer fallback gate uses, so the two cannot disagree.
 *
 *   131_072 (local, unmeasured) → 15   131_072 + measured 40 → 40   24_576 → 15   16_000 → 12   null (cloud) → 48
 *   null + presence "unknown" → 15     null + presence "present" → 15
 */
export function deriveCoworkerToolCap(
  servedContextTokens: number | null | undefined,
  opts?: CoworkerToolCapOptions,
): number {
  const hasWindow = typeof servedContextTokens === "number" && servedContextTokens > 0;
  // Legacy callers report presence only through the window, which cannot tell an
  // absent model from an unread one. Explicit presence always wins.
  const presence: LocalPresence = opts?.localPresence ?? (hasWindow ? "present" : "absent");

  // No local model in the serving path → cloud turn, no cliff, full ceiling.
  if (presence === "absent") return MAX_COWORKER_ATTACHED_TOOLS;

  // Fail-safe: a local model is cliff-prone by CLASS. Only measured fidelity
  // evidence lifts the ceiling above the selection cliff; a bigger window never
  // does (that was the BI-B5C358B1 defect — capacity mistaken for fidelity).
  const ceiling = Math.min(
    MAX_COWORKER_ATTACHED_TOOLS,
    resolveLocalToolCeiling(opts?.measuredToolFidelityCeiling),
  );

  // Window-fit needs a real window. When the probe could not read one, the
  // selection ceiling alone binds — an unknown window must never WIDEN the
  // surface, which is the whole defect this branch exists to prevent.
  if (!hasWindow) return ceiling;

  // The MIN floor applies to the WINDOW-FIT term only, never on top of the
  // ceiling (BI-8634F0BE). Written as `max(MIN, min(ceiling, fitted))` the floor
  // came last and overrode the ceiling, so a measured fidelity below 12 attached
  // 12 tools while the routing gate refused anything above the measured value —
  // reinstating the exact BI-A8BFEFCE failure by a different route. The floor
  // exists to stop window arithmetic shrinking a coworker into uselessness on a
  // small context; it was never evidence about what the model can select from.
  const toolBudgetTokens = servedContextTokens! - COWORKER_NON_TOOL_RESERVE_TOKENS;
  const fitted = Math.floor(toolBudgetTokens / TOOL_SCHEMA_TOKEN_ESTIMATE);
  return Math.min(ceiling, Math.max(MIN_COWORKER_ATTACHED_TOOLS, fitted));
}

/**
 * Max skills to ENUMERATE in the coworker system-prompt catalog on a cliff-prone
 * small local window. The tool cap (above) sizes tool schemas to the window, but
 * the skills catalog ("- skillId: label - description" per skill) is the largest
 * UNCAPPED non-tool block, and it is heavier than this comment used to claim.
 * Measured on the live install (2026-08-26, `SkillAssignment` joined to
 * `SkillDefinition` on skillId, enabled + active only): platform-engineer holds
 * 45 skills ≈ 15,281 chars ≈ 3.8k tokens, build-specialist 43 ≈ 3.5k, and EIGHT
 * agents sit above this cap. That block can push the assembled prompt past a
 * small local window even after the tool cap. Bound it to the same
 * selection-cliff the tool cap uses — a small local model can't usefully choose
 * from dozens of skills either — and rely on per-turn re-ranking
 * (rankSkillsByRelevance orders to the current message) to surface others when a
 * later turn is about them.
 */
export const SKILL_CATALOG_CLIFF_CAP = 15;

/**
 * Max skills to list in the coworker prompt, sized to the LOCAL served context —
 * the symmetric partner to deriveCoworkerToolCap.
 *
 * PRESENCE gates it; the WINDOW then decides (BI-DBEEC15B). Note the axis differs
 * from the tool cap deliberately: the tool cap binds on presence alone because
 * tool-SELECTION accuracy is a property of the model class, whereas this is a
 * question of context FIT. So a local model with a genuinely large window still
 * gets an uncapped catalog, exactly as before.
 *
 * What changed is the unread case. This used to return Infinity for a null
 * window, but that null carries two different facts — no local model, and a
 * probe that could not read one (see `LocalPresence`). Only the first justifies
 * uncapping. A failed probe on an install that does have a small local model
 * used to enumerate the whole catalog, compounding with the tool-surface
 * widening that BI-A8BFEFCE fixed: on a 24,576-token window that was ~11k extra
 * tokens of tool schemas plus ~2.5k of catalog, from one unread value.
 *
 *   null + "absent" → Infinity   null + "unknown"/"present" → 15
 *   24_576 → 15   131_072 → Infinity   null (no presence given) → Infinity
 */
export function deriveSkillCatalogCap(
  servedContextTokens: number | null | undefined,
  opts?: { localPresence?: LocalPresence },
): number {
  const hasWindow = typeof servedContextTokens === "number" && servedContextTokens > 0;
  // Legacy callers report presence only through the window, which cannot tell an
  // absent model from an unread one. Explicit presence always wins.
  const presence: LocalPresence = opts?.localPresence ?? (hasWindow ? "present" : "absent");

  // No local model in the serving path → cloud turn, nothing to fit inside.
  if (presence === "absent") return Number.POSITIVE_INFINITY;

  // Local IS in the path but its window is unreadable. Fail safe to the cliff
  // cap: an unknown window must never be treated as a large one.
  if (!hasWindow) return SKILL_CATALOG_CLIFF_CAP;

  return servedContextTokens! <= ACCURACY_CLIFF_PRONE_MAX_CONTEXT
    ? SKILL_CATALOG_CLIFF_CAP
    : Number.POSITIVE_INFINITY;
}

/**
 * Apply the catalog cap to relevance-ordered skills, but NEVER drop a skill the
 * user explicitly invoked (`pinnedSkillId`, e.g. an explicit "Use the X skill."
 * marker) even when it falls beyond the cap — else the invocation would silently
 * stop resolving. Pure; `cap = Infinity` (or a list already within the cap) is a
 * no-op that returns a copy.
 */
export function capSkillCatalog<T extends { skillId: string }>(
  rankedSkills: readonly T[],
  cap: number,
  pinnedSkillId?: string | null,
): T[] {
  if (!Number.isFinite(cap) || rankedSkills.length <= cap) return [...rankedSkills];
  const kept = rankedSkills.slice(0, cap);
  if (pinnedSkillId && !kept.some((s) => s.skillId === pinnedSkillId)) {
    const pinned = rankedSkills.find((s) => s.skillId === pinnedSkillId);
    if (pinned) kept.push(pinned);
  }
  return kept;
}

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
    "keep each turn small. Call this with a natural-language capability `query` (e.g. \"code graph\", \"wiki\", " +
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
  /** EP-27FD96BC · P3 (BI-ACE1EBA4). The current turn's intent (the user
   *  message). When present, tools are ranked by relevance to it WITHIN their
   *  priority tier, so the cap keeps the most task-relevant tools instead of
   *  whichever happened to come first. Omitted → today's stable order. */
  intentQuery?: string;
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

  const intentTokens = params.intentQuery ? tokenizeIntent(params.intentQuery) : null;
  const scoreOf = (t: ToolDefinition): number =>
    intentTokens ? scoreToolIntentRelevance(t, intentTokens) : 0;

  // tier ASC (priority), then intent-relevance DESC within tier, then stable
  // original index. Absent an intent query every score is 0, so this reduces to
  // the prior `tier, index` order exactly.
  const ranked = params.tools
    .map((t, i) => ({ t, i, tier: tierOf(t), score: scoreOf(t) }))
    .sort((a, b) => a.tier - b.tier || b.score - a.score || a.i - b.i);

  const attached: Array<{ t: ToolDefinition; i: number }> = [];
  const deferred: Array<{ t: ToolDefinition; i: number }> = [];
  // The cap bounds the TOTAL attached surface (BI-CAP-F2D39F8F follow-through):
  // the local selection cliff and the routing-layer local-fallback gate both
  // judge the WHOLE tool set the model sees, so essentials riding on top of the
  // cap silently disqualified local serving (live repro: cap 15 + 4 route tools
  // + load_tools = 20 attached → "Skipping local fallback (20 tools > 15)").
  // Tier-0 (page actions) keeps top PRIORITY within the cap rather than a free
  // pass past it; with the real cap floor (12) route domain tools always fit.
  // The always-include set (load_tools — the escape hatch that reaches every
  // deferred tool) attaches unconditionally and counts toward the cap.
  let attachedCount = 0;
  for (const entry of ranked) {
    if (always.has(entry.t.name)) {
      attached.push(entry);
      attachedCount++;
    } else if (attachedCount < cap) {
      attached.push(entry);
      attachedCount++;
    } else {
      deferred.push(entry);
    }
  }

  // Restore original ordering for stable logs / UX.
  attached.sort((a, b) => a.i - b.i);
  deferred.sort((a, b) => a.i - b.i);
  return { attached: attached.map((e) => e.t), deferred: deferred.map((e) => e.t) };
}
