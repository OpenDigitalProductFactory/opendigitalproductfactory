/**
 * Tool-reachability exemption list — BI-6FD78522 (M6, late-defect-detection
 * hardening plan). Companion to tool-reachability.conformance.test.ts.
 *
 * Every entry is a PLATFORM_TOOLS tool that is registered but unreachable
 * today: no agent in packages/db/data/agent_registry.json can be authorized
 * to call it through the honored TOOL_TO_GRANTS mapping. Two failure shapes:
 *   - SEALED (BI-F998BCE8 family): the tool HAS a TOOL_TO_GRANTS entry, but
 *     no registry agent holds (or reaches via GRANT_IMPLICATIONS or the
 *     coworker read baseline) any of its required grants.
 *   - NO ENTRY (BI-88B77204 family): the tool has no TOOL_TO_GRANTS entry at
 *     all, so isToolAllowedByGrants denies it by default for every caller.
 *
 * SHRINK-ONLY BASELINE, frozen 2026-08-22. This is today's debt, not a place
 * to park new tools: the conformance test fails a NEW unreachable tool, and it
 * also fails a STALE entry (a tool here that became reachable or left the
 * registry), so entries leave the moment they are fixed. To fix an entry:
 * grant the required key to the owning agent(s) in agent_registry.json (and
 * add the TOOL_TO_GRANTS entry for the no-entry shape), then delete the row
 * here in the same PR.
 *
 * Each value states the shape and why it is exempt rather than fixed in this
 * pass — reassigning grant scope is an authorization decision for each tool's
 * owning epic, not a side effect of the M6 conformance gate.
 */
export const TOOL_REACHABILITY_EXEMPTIONS: Readonly<Record<string, string>> = {
  // ── Coworker catalog / engagement (A2A marketplace surface) ──────────────
  analyze_coworker_engagement_refinement:
    "SEALED: requires coworker_catalog_read, held by no registry agent — the coworker-marketplace surface has no owning coworker yet; granting is that epic's call.",
  list_coworker_services:
    "SEALED: requires coworker_catalog_read, held by no registry agent — same coworker-marketplace grant decision as analyze_coworker_engagement_refinement.",
  list_coworker_offers:
    "SEALED: requires coworker_catalog_read, held by no registry agent — same coworker-marketplace grant decision.",
  get_coworker_offer:
    "SEALED: requires coworker_catalog_read, held by no registry agent — same coworker-marketplace grant decision.",
  resolve_coworker_offer_agent_card:
    "SEALED: requires coworker_catalog_read, held by no registry agent — same coworker-marketplace grant decision.",
  request_coworker_engagement:
    "SEALED: requires coworker_engagement_write, held by no registry agent — engagement spawning is a side-effecting authority the owning epic must assign deliberately.",
  spawn_subagents:
    "SEALED: requires coworker_engagement_write, held by no registry agent — same deliberate-assignment call as request_coworker_engagement.",

  // ── Thread orchestration ─────────────────────────────────────────────────
  get_thread_result:
    "SEALED: requires thread_read, held by no registry agent — thread-orchestration tools are exercised by the platform runtime today, not by granted coworkers.",
  get_child_threads:
    "SEALED: requires thread_read, held by no registry agent — same thread-orchestration story as get_thread_result.",

  // ── Workbook (spreadsheet substrate) ─────────────────────────────────────
  workbook_list_tables:
    "SEALED: requires workbook_read, held by no registry agent — workbook tools ship ahead of the coworker persona that will own them.",
  workbook_get_schema:
    "SEALED: requires workbook_read, held by no registry agent — same deferred workbook persona.",
  workbook_query_rows:
    "SEALED: requires workbook_read, held by no registry agent — same deferred workbook persona.",
  workbook_create_row:
    "SEALED: requires workbook_write, held by no registry agent — write authority deferred with the workbook persona.",
  workbook_update_cells:
    "SEALED: requires workbook_write, held by no registry agent — write authority deferred with the workbook persona.",

  // ── Storefront / inventory reads ─────────────────────────────────────────
  list_storefront_activity:
    "SEALED: requires storefront_read, held by no registry agent — storefront vertical shipped tools before a granted owning coworker.",
  list_stock_coverage:
    "SEALED: requires stock_read, held by no registry agent — same storefront-vertical grant gap.",

  // ── Screen driving ───────────────────────────────────────────────────────
  screen_set_input:
    "SEALED: requires coworker_screen_fill, held by no registry agent — screen-fill is deliberately ungranted until the screen-drive trust tier assigns it (the read/drive grants are similarly scoped).",

  // ── Internal / runtime-invoked ───────────────────────────────────────────
  run_tool_script:
    "SEALED: requires tool_script_exec, held by no registry agent — script execution is a high-blast-radius authority; granting it is a deliberate act for the build-engine epic.",
  get_fleet_readiness:
    "NO ENTRY: absent from TOOL_TO_GRANTS entirely (deny-by-default) — fleet-readiness is read by platform surfaces, not coworkers; needs an owning-epic decision on whether to expose it.",
  record_surface_readiness:
    "NO ENTRY: absent from TOOL_TO_GRANTS entirely (deny-by-default) — surface-readiness recording is runtime-internal today; exposing it to coworkers is an owning-epic decision.",
  // ── Banking books loop (S-FIN, BI-DE27D34E) — consumer sequenced next ─────
  // These 12 tools have banking_read/banking_write TOOL_TO_GRANTS entries, but
  // no registry agent holds a banking grant YET: the decomposition ships the
  // governed tool substrate (S-FIN) before the coworker that wields it. The
  // Bookkeeper coworker (BI-7D50DC56, slice S-BK) holds banking_read/banking_write
  // via the factory door; these entries shrink out the moment that lands.
  list_bank_accounts:
    "SEALED: requires banking_read, held by no registry agent yet — the Bookkeeper coworker (BI-7D50DC56, S-BK) will hold it; S-FIN ships the tools first.",
  get_bank_account:
    "SEALED: requires banking_read, held by no registry agent yet — held by the Bookkeeper coworker (BI-7D50DC56, S-BK), sequenced after this tool slice.",
  get_bank_transactions:
    "SEALED: requires banking_read, held by no registry agent yet — held by the Bookkeeper coworker (BI-7D50DC56, S-BK), sequenced after this tool slice.",
  suggest_transaction_matches:
    "SEALED: requires banking_read, held by no registry agent yet — held by the Bookkeeper coworker (BI-7D50DC56, S-BK), sequenced after this tool slice.",
  list_bank_rules:
    "SEALED: requires banking_read, held by no registry agent yet — held by the Bookkeeper coworker (BI-7D50DC56, S-BK), sequenced after this tool slice.",
  get_reconciliation_summary:
    "SEALED: requires banking_read, held by no registry agent yet — held by the Bookkeeper coworker (BI-7D50DC56, S-BK), sequenced after this tool slice.",
  create_bank_account:
    "SEALED: requires banking_write, held by no registry agent yet — the Bookkeeper coworker (BI-7D50DC56, S-BK) will hold it; consequential, so it also routes the governance gate for owner approval.",
  import_bank_statement:
    "SEALED: requires banking_write, held by no registry agent yet — the Bookkeeper coworker (BI-7D50DC56, S-BK) will hold it; consequential, so it also routes the governance gate for owner approval.",
  match_transaction:
    "SEALED: requires banking_write, held by no registry agent yet — held by the Bookkeeper coworker (BI-7D50DC56, S-BK), sequenced after this tool slice.",
  unmatch_transaction:
    "SEALED: requires banking_write, held by no registry agent yet — held by the Bookkeeper coworker (BI-7D50DC56, S-BK), sequenced after this tool slice.",
  create_bank_rule:
    "SEALED: requires banking_write, held by no registry agent yet — held by the Bookkeeper coworker (BI-7D50DC56, S-BK), sequenced after this tool slice.",
  delete_bank_rule:
    "SEALED: requires banking_write, held by no registry agent yet — held by the Bookkeeper coworker (BI-7D50DC56, S-BK), sequenced after this tool slice.",
};
