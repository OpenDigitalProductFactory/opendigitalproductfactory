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
 * FALLBACK is exactly where these cliffs bite. `null`/unknown = NO local model in
 * the serving path (a pure cloud turn) → the full 48, unaffected by the cliff.
 *
 * This function is the SINGLE SOURCE of the coworker tool-count policy (INV-6):
 * the cliff constant lives in `context-economy-metrics.ts` and is consumed here.
 *
 *   131_072 (local, unmeasured) → 15   131_072 + measured 40 → 40   24_576 → 15   16_000 → 12   null (cloud) → 48
 */
export function deriveCoworkerToolCap(
  servedContextTokens: number | null | undefined,
  opts?: CoworkerToolCapOptions,
): number {
  // No local model in the serving path → cloud turn, no cliff, full ceiling.
  if (!servedContextTokens || servedContextTokens <= 0) return MAX_COWORKER_ATTACHED_TOOLS;
  const toolBudgetTokens = servedContextTokens - COWORKER_NON_TOOL_RESERVE_TOKENS;
  const fitted = Math.floor(toolBudgetTokens / TOOL_SCHEMA_TOKEN_ESTIMATE);
  // Fail-safe: a local model is cliff-prone by CLASS. Only measured fidelity
  // evidence lifts the ceiling above the selection cliff; a bigger window never
  // does (that was the BI-B5C358B1 defect — capacity mistaken for fidelity).
  const measured = opts?.measuredToolFidelityCeiling;
  const selectionCeiling =
    measured && measured > 0 ? measured : LOCAL_TOOL_SELECTION_CLIFF;
  const ceiling = Math.min(MAX_COWORKER_ATTACHED_TOOLS, selectionCeiling);
  return Math.max(MIN_COWORKER_ATTACHED_TOOLS, Math.min(ceiling, fitted));
}

/**
 * Max skills to ENUMERATE in the coworker system-prompt catalog on a cliff-prone
 * small local window. The tool cap (above) sizes tool schemas to the window, but
 * the skills catalog ("- skillId: label - description" per skill) is the largest
 * UNCAPPED non-tool block: a heavy coworker (build/platform hold 36-38 skills ≈
 * ~4k tokens) can push the assembled prompt past a small local window even after
 * the tool cap. Bound it to the same selection-cliff the tool cap uses — a small
 * local model can't usefully choose from dozens of skills either — and rely on
 * per-turn re-ranking (rankSkillsByRelevance orders to the current message) to
 * surface others when a later turn is about them.
 */
export const SKILL_CATALOG_CLIFF_CAP = 15;

/**
 * Max skills to list in the coworker prompt, sized to the LOCAL served context —
 * the symmetric partner to deriveCoworkerToolCap. A cliff-prone small local window
 * (<= ACCURACY_CLIFF_PRONE_MAX_CONTEXT) enumerates only the most relevant skills;
 * a capable/unknown window (null or > cliff) is uncapped (Infinity) so cloud and
 * large-window installs are byte-identical.
 */
export function deriveSkillCatalogCap(servedContextTokens: number | null | undefined): number {
  if (!servedContextTokens || servedContextTokens <= 0) return Number.POSITIVE_INFINITY;
  return servedContextTokens <= ACCURACY_CLIFF_PRONE_MAX_CONTEXT
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

// EP-27FD96BC · P3 (BI-ACE1EBA4) — cheap task-intent relevance for tool ranking.
// Token overlap between the turn and a tool's name+description; no embedding call
// on the hot path. Used only to order tools WITHIN a priority tier so the cap
// keeps the most relevant ones.

const INTENT_STOPWORDS: ReadonlySet<string> = new Set([
  "the", "and", "for", "you", "your", "with", "this", "that", "can", "will",
  "please", "how", "what", "when", "get", "let", "are", "from", "about", "need",
  "want", "help", "into", "have",
]);

export function tokenizeIntent(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !INTENT_STOPWORDS.has(t)),
  );
}

/** Distinct intent tokens found in the tool's name + description. Pure. */
export function scoreToolIntentRelevance(
  tool: ToolDefinition,
  intentTokens: ReadonlySet<string>,
): number {
  if (intentTokens.size === 0) return 0;
  const haystack = new Set(
    `${tool.name} ${tool.description ?? ""}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  let score = 0;
  for (const token of intentTokens) if (haystack.has(token)) score += 1;
  return score;
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
