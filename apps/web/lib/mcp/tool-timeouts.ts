/**
 * MCP tool wait-budget registry (BI-QUIESCE-005).
 *
 * Central catalog of typical/max execution times + force-cancel safety per
 * MCP tool. Consumed by the Activity Quiescence Protocol coordinator to:
 *
 *   1. Predict the wait budget — coordinator sums maxMs for in-flight
 *      tools to know how long the drain might take.
 *   2. Decide whether to force-cancel — `killable: false` tools commit
 *      state irreversibly (e.g., start_build kicks off a Build Studio run
 *      that creates DB rows + external resources); the coordinator must
 *      wait, not force-cancel.
 *   3. Surface accurate ETAs in the operator-facing /ops/quiescence UI.
 *
 * Spec: docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md
 *   §6.6 (registry) + §12 Q3 (maintenance ownership decision: CI lint at
 *   tool registration; this file IS the lint target).
 *
 * Maintenance contract: every MCP tool registered via the @dpf/* MCP
 * server or any plugin MCP MUST appear in TOOL_WAIT_BUDGETS. CI lint
 * (apps/web/scripts/lint-tool-budgets.ts — future BI) walks the registered
 * tool list and fails the PR if any tool is missing here.
 *
 * Defaults for unknown tools (queried via getToolBudget): typicalMs=5000,
 * maxMs=60000, killable=true. Defaults are conservative — if a new tool
 * is added without a registry entry, the coordinator will assume bounded
 * runtime + killable, which is the right posture for the common case.
 */

export type ToolWaitBudget = {
  /** Typical execution time in normal operation. Used for ETA hints. */
  typicalMs: number;
  /** Hard upper bound — the coordinator's force-cancel deadline. */
  maxMs: number;
  /**
   * Whether the tool is safe to force-cancel mid-execution.
   *   - true  → coordinator may cancel past maxMs; tool's failure is non-
   *             destructive (retryable). Operator sees "tool was interrupted".
   *   - false → coordinator MUST wait until commit; the tool is mid-write
   *             to external state (DB, GitHub, container lifecycle, etc.).
   *             Defer the upgrade if needed.
   */
  killable: boolean;
};

/**
 * Per-tool budgets, keyed by the canonical tool name (matches what's
 * recorded in ToolExecution.toolName).
 *
 * Sorted by category for readability. When adding a new tool, please
 * place it under the matching category section.
 */
export const TOOL_WAIT_BUDGETS: Record<string, ToolWaitBudget> = {
  // ─── Build Studio / deliberation lifecycle ────────────────────────────

  // Kicks off an asynchronous Build Studio run. Returns once the run is
  // queued; the run itself proceeds independently. killable:false because
  // queuing IS a commit to DB state.
  start_build: { typicalMs: 5_000, maxMs: 30_000, killable: false },

  // Starts a multi-branch deliberation. Multiple LLM calls; bounded by
  // the deliberation function's own concurrency + timeout.
  start_deliberation: { typicalMs: 30_000, maxMs: 180_000, killable: true },

  // Mid-build inspection — read-only against sandbox state.
  inspect_build_code_impact: { typicalMs: 2_000, maxMs: 30_000, killable: true },

  // ─── MCP catalog + provider management ───────────────────────────────

  // Marked killable:false in spec §6.3 — sync is mid-upsert against
  // McpRegistry rows; killing it mid-flow corrupts catalog state.
  ops_mcp_catalog_sync: { typicalMs: 30_000, maxMs: 900_000, killable: false },

  // Provider add — single transactional row create.
  add_provider: { typicalMs: 500, maxMs: 5_000, killable: true },

  // ─── AI inference / probes / evals ───────────────────────────────────

  // Endpoint probes — read-only HTTP calls to provider /v1/models etc.
  run_endpoint_tests: { typicalMs: 60_000, maxMs: 300_000, killable: true },

  // Dimension eval — multi-prompt judge over a model.
  // Bounded but long; killable safely (eval results aren't committed
  // until the final step.run).
  ai_eval_run: { typicalMs: 120_000, maxMs: 300_000, killable: true },

  // ─── Brand / archetype / discovery ───────────────────────────────────

  // Brand extraction — single LLM call + DB writes. Killable; the
  // partial-write states are documented to be re-run safely.
  "brand/extract.run": { typicalMs: 7_000, maxMs: 30_000, killable: true },

  // Discovery sweeps — long, bounded operations writing to InventoryEntity.
  // killable:false because mid-sweep state would leave the inventory
  // half-updated and require operator reconciliation.
  ops_full_discovery_sweep: { typicalMs: 600_000, maxMs: 1_800_000, killable: false },

  // ─── Assurance / verification ────────────────────────────────────────

  // BoM generation — file scan + DB writes.
  "assurance/bom.generate": { typicalMs: 60_000, maxMs: 300_000, killable: true },

  // Assurance scan — code-graph + sandbox-evidence aggregation.
  "assurance/scan.run": { typicalMs: 120_000, maxMs: 600_000, killable: true },

  // ─── Misc admin actions ──────────────────────────────────────────────

  // Heartbeat — cheap; rarely in flight long enough to matter.
  heartbeat_workroom: { typicalMs: 100, maxMs: 1_000, killable: true },

  // Hive scout ingest — long batch with DB writes. killable:false because
  // partial-ingest state is hard to reason about.
  run_hive_scout_ingest: { typicalMs: 600_000, maxMs: 1_800_000, killable: false },
};

/**
 * Conservative defaults for tools not yet registered. New tools should be
 * added to TOOL_WAIT_BUDGETS at registration time (per §12 Q3 decision);
 * these defaults exist to make the coordinator robust to missing entries
 * rather than crashing on unknown tools.
 */
export const DEFAULT_TOOL_BUDGET: ToolWaitBudget = {
  typicalMs: 5_000,
  maxMs: 60_000,
  killable: true,
};

/**
 * Lookup helper. Returns the registered budget if present; otherwise the
 * conservative default.
 *
 * Logs a console.warn the first time an unknown tool name is queried so
 * the operator notices the registry gap during dogfooding. Subsequent
 * lookups for the same tool are silent.
 */
const _warnedTools = new Set<string>();

export function getToolBudget(toolName: string): ToolWaitBudget {
  const entry = TOOL_WAIT_BUDGETS[toolName];
  if (entry) return entry;
  if (!_warnedTools.has(toolName)) {
    _warnedTools.add(toolName);
    console.warn(
      `[tool-timeouts] Unknown MCP tool "${toolName}" — falling back to ` +
        `DEFAULT_TOOL_BUDGET (typicalMs=${DEFAULT_TOOL_BUDGET.typicalMs}ms, ` +
        `maxMs=${DEFAULT_TOOL_BUDGET.maxMs}ms, killable=${DEFAULT_TOOL_BUDGET.killable}). ` +
        `Add an entry to TOOL_WAIT_BUDGETS at tool registration time.`,
    );
  }
  return DEFAULT_TOOL_BUDGET;
}

/**
 * Sum the wait budgets for a set of in-flight tool names. Used by the
 * coordinator to compute the wait budget when MCP tools are blocking the
 * drain.
 */
export function sumWaitBudgets(toolNames: readonly string[]): {
  typicalMs: number;
  maxMs: number;
  anyKillableFalse: boolean;
} {
  let typicalMs = 0;
  let maxMs = 0;
  let anyKillableFalse = false;
  for (const name of toolNames) {
    const b = getToolBudget(name);
    typicalMs += b.typicalMs;
    maxMs += b.maxMs;
    if (!b.killable) anyKillableFalse = true;
  }
  return { typicalMs, maxMs, anyKillableFalse };
}

/**
 * Test-only — reset the warned-tools memo so repeated unknown-name
 * lookups across tests trigger warnings deterministically.
 */
export function _resetWarnedTools(): void {
  _warnedTools.clear();
}
