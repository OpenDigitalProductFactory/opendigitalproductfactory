// Direct JSON import — bundler resolves this at build time, works in both dev and Docker standalone
import agentRegistryData from "../../../../packages/db/data/agent_registry.json";
import { AUTHORIZED_SURFACE_TOOL_GRANTS } from "@/lib/coworker/authorized-surface-coworker-contract";
import { PRODUCT_MANAGEMENT_TOOL_GRANTS } from "./product-management-tool-grants";
import { INITIATIVE_READINESS_TOOL_GRANTS } from "./initiative-readiness-tool-grants";
import { BANKING_TOOL_GRANTS } from "./banking-tool-grants";
const agentRegistry = agentRegistryData as { agents: Array<Record<string, unknown>> };
/**
 * Implications between agent grant categories. A grant on the left of the
 * mapping implicitly satisfies every grant on the right. Used to refactor
 * coarse grants (e.g. `backlog_write`) into finer ones (e.g. `build_evidence`)
 * without breaking existing roles that hold the coarse grant.
 *
 * Pseudo-User Contract (spec §6.3): the finer grants let coworker tokens be
 * scoped tightly (e.g. a coworker that should record build evidence but not
 * mutate the broader backlog) while existing roles with the coarse grants
 * continue to satisfy the refactored tool requirements unchanged.
 *
 * Implications are ONE-WAY. Holding `backlog_write` implies `build_evidence`;
 * holding `build_evidence` does NOT imply `backlog_write`. That's the whole
 * point — narrowing is a real scope reduction.
 *
 * BI-B2F7ABF5 / EP-COWORKER-INTERACTIVITY.
 */
export const GRANT_IMPLICATIONS: Readonly<Record<string, readonly string[]>> = {
  // `backlog_write` is the legacy broad grant for any backlog mutation.
  // The Pseudo-User Contract introduces build-scoped finer grants; anyone
  // who currently has backlog_write retains access to those tools.
  backlog_write: ["build_evidence", "build_phase_advance"],
  // `build_promote` was the legacy promotion grant; `build_lifecycle` is the
  // broader Pseudo-User Contract grant covering reopen + cancel + promote.
  build_promote: ["build_lifecycle"],
  // Browser-driving (EP-BROWSER-DRIVE, spec 2026-06-05 §8.2, Verdict 5):
  // holding `browser_drive` (side-effecting browser actions) implies
  // `browser_read` (navigate / extract / screenshot). One-way, as ever —
  // `browser_read` alone never implies the drive grant.
  browser_drive: ["browser_read"],
  // EP-WORKROOM-COMMS (BI-4402DABB): a coworker that can write a work capsule (the
  // executors that claim/work rooms, incl. the external CLIs) may post to the room
  // it is admitted to. One-way — work_room_write never implies capsule write.
  work_capsule_write: ["work_room_write"],
  // CRM drafting (crm_write) implies CRM inspection (crm_read): a coworker that
  // can draft an opportunity or quote can always read the accounts/pipeline it
  // is drafting against. One-way — crm_read alone never implies crm_write.
  crm_write: ["crm_read"],
  // SIEM (EP-SOVEREIGN-SOC): a coworker that can investigate, tune detections,
  // or propose a response can always read the security events/detections/cases
  // it acts on. One-way — siem_read alone never implies the write grants.
  siem_investigate: ["siem_read"],
  siem_tune: ["siem_read"],
  incident_respond: ["siem_read"],
  // A holder of broad registry write authority can already write the craft
  // overlay directly, so it implies the narrow critique-capture grant. One-way:
  // `critique_capture` never implies `registry_write` — that narrowing is the
  // entire point of splitting it out.
  registry_write: ["critique_capture"],
};

/** Expand a list of held grants by applying GRANT_IMPLICATIONS one-way.
 *  Returns a new array; does not mutate the input. Idempotent: applying twice
 *  yields the same set as applying once (implications are not transitive in
 *  the current taxonomy; if a new implication chain is added the implementation
 *  should switch to fixed-point expansion). */
export function expandGrants(grants: readonly string[]): string[] {
  const expanded = new Set<string>(grants);
  for (const g of grants) {
    const implied = GRANT_IMPLICATIONS[g];
    if (implied) {
      for (const i of implied) expanded.add(i);
    }
  }
  return Array.from(expanded);
}
/**
 * Read-only baseline every coworker holds, regardless of its agent-specific
 * grants. Encodes the platform design criterion (operator, 2026-06-06,
 * BI-FD7E4D72): a coworker must have complete visibility of the page it is on
 * plus read access to the documentation, the source code, and the code graph
 * for "how it works and the rest of the portal". Without this the page-scoped
 * agents (e.g. AGT-WS-OPS, granted only backlog_*) could neither see their
 * page's coordination data nor look anything up — making them, in the
 * operator's words, "rather useless".
 *
 * Every grant here is READ-ONLY. The user-capability check in getAvailableTools
 * (`can(userContext, requiredCapability)`) still applies on top, so this never
 * escalates a coworker beyond what its human operator may see. Merged into the
 * agent's grants at coworker tool-resolution time (see getAvailableTools'
 * `additionalGrants` option) rather than hand-stamped onto every agent entry —
 * one durable rule that new agents inherit automatically, and which sidesteps
 * the DB-vs-JSON grant-sync problem since it is applied in code at runtime.
 *
 *  - registry_read     → knowledge base, wiki, portfolio context
 *  - file_read         → read/search project source code
 *  - document_read     → platform documentation (doc_search / doc_load)
 *  - code_graph_read   → the code graph (search_code_graph / trace_code_surface)
 *  - work_capsule_read → page coordination data (runtime targets, leases,
 *                        build progress) — the data pages like /ops/dev-loop render
 */
export const COWORKER_READ_BASELINE_GRANTS: readonly string[] = [
  "registry_read",
  "file_read",
  "document_read",
  "code_graph_read",
  "work_capsule_read",
  // EP-WORKROOM-COMMS (BI-3F21C4D5): every coworker may read a room it is admitted
  // to (room admission is the real gate; this is the baseline capability).
  "work_room_read",
];
/** Maps tools to grants. [] means identity-scoped universal access; absence means deny. */
export const TOOL_TO_GRANTS: Record<string, string[]> = {
  record_working_note: [],
  list_working_notes: [],
  record_effort_context: [],
  read_effort_context: [],
  set_task_goal: [],
  list_task_goals: [],
  evaluate_task_goal: [],
  // Browser-driving (namespaced MCP, server slug `mcp-browser-use`) —
  // EP-BROWSER-DRIVE, spec 2026-06-05 §8.2 (Verdict 5). These are the
  // platform-visible `<serverId>__<toolName>` names (see mcp-server-tools.ts
  // `namespaceTool`), because that is the form that enters the coworker tool
  // list. Read tools require `browser_read`; the side-effecting `browse_act`
  // requires `browser_drive` (which implies `browser_read`). `browse_run_tests`
  // stays QA-scoped on `browser_read`, never `browser_drive`. Without an entry
  // here these tools were appended ungated under External Access — the gap this
  // closes (see getAvailableTools in apps/web/lib/mcp-tools.ts).
  "mcp-browser-use__browse_open": ["browser_read"],
  "mcp-browser-use__browse_extract": ["browser_read"],
  "mcp-browser-use__browse_screenshot": ["browser_read"],
  "mcp-browser-use__browse_close": ["browser_read"],
  "mcp-browser-use__browse_run_tests": ["browser_read"],
  "mcp-browser-use__browse_act": ["browser_drive"],
  // Raw browser-use RPC names are used by first-party helpers and by the local
  // sidecar binding before namespace decoration. Keep them on the same scope as
  // their namespaced forms so a broader PLATFORM_TOOLS/audit extraction cannot
  // strand them in default-deny with a different authority story.
  browse_open: ["browser_read"],
  browse_extract: ["browser_read"],
  browse_screenshot: ["browser_read"],
  browse_close: ["browser_read"],
  browse_run_tests: ["browser_read"],
  browse_act: ["browser_drive"],
  // The coworker-facing orchestrator entry point (drives a full bounded task).
  drive_browser_task: ["browser_drive"],

  // Backlog
  create_backlog_item: ["backlog_write"],
  update_backlog_item: ["backlog_write"],
  score_demand_item: ["backlog_write"],
  ...PRODUCT_MANAGEMENT_TOOL_GRANTS,
  record_effort_estimate: ["backlog_write"],
  set_demand_policy: ["backlog_write"],
  set_backlog_delivery_budget: ["backlog_write"],
  find_duplicate_candidates: ["backlog_read"],
  merge_backlog_items: ["backlog_write"],
  sweep_duplicate_demand: ["backlog_read"],
  run_capacity_drain: ["backlog_write"],
  approve_demand_for_funding: ["backlog_write"],
  query_backlog: ["backlog_read"],
  report_quality_issue: ["backlog_write"],
  escalate_feedback_upstream: ["backlog_write"],

  // Workbooks / Universal Grid (EP-GRID-WORKBOOKS, #1582). These MCP tools
  // shipped without a grant mapping, so every tool was default-deny (INV-1) and
  // unreachable from any coworker. The handler's capability split is
  // view_workbooks (read) / manage_workbooks (write); mirror it as read/write
  // grant categories. Held by no agent yet — workbook tools stay coworker-deny
  // until a role grants them, which is the correct conservative default for a
  // user-facing grid feature.
  workbook_list_tables: ["workbook_read"],
  workbook_get_schema: ["workbook_read"],
  workbook_query_rows: ["workbook_read"],
  workbook_create_row: ["workbook_write"],
  workbook_update_cells: ["workbook_write"],

  // Governed MCP backlog surface (spec 2026-04-25)
  create_epic: ["backlog_write"],
  update_epic: ["backlog_write"],
  list_epics: ["backlog_read"],
  list_backlog_items: ["backlog_read"],
  get_backlog_item: ["backlog_read"],
  update_backlog_item_status: ["backlog_write"],
  retire_backlog_item: ["backlog_write"],
  link_backlog_item_to_epic: ["backlog_write"],
  search_specs_and_plans: ["spec_plan_read", "backlog_read"],
  // Build-scoped evidence uses build_evidence; backlog_write implies it for compatibility (BI-B2F7ABF5).
  record_execution_evidence: ["build_evidence"],
  // Non-build evidence stays on backlog_write because it coordinates the whole backlog surface.
  record_external_development_evidence: ["backlog_write"],
  review_semantic_change: ["backlog_write"],
  record_semantic_review_outcome: ["backlog_write"],
  record_local_integration_result: ["backlog_write"],
  record_functional_failure_evidence: ["backlog_write"],
  ...INITIATIVE_READINESS_TOOL_GRANTS,
  get_next_recommended_work: ["backlog_read"],
  // Read-only coworker-roster discovery-by-intent (BI-5FB59BC6); returns ids/
  // names to then pass to request_coworker/summon_coworker.
  find_coworker: ["backlog_read"],
  // Coworker self-scoped backlog lens (BI-474A1F55) — read-only, identity-scoped.
  list_my_backlog: ["backlog_read"],
  // Work Capsule control harness (spec 2026-05-14)
  list_workrooms: ["work_capsule_read"],
  get_workroom: ["work_capsule_read"],
  // EP-WORKROOM-COMMS (BI-3F21C4D5): read/post a Work Room's message feed. Room
  // admission is enforced separately (room-agent-access); these are the coarse caps.
  read_room_messages: ["work_room_read"],
  post_room_message: ["work_room_write"],
  // EP-WORKROOM-COMMS: invite a participant on demand (write); 360 coworker
  // room-engagement (read). Room admission/coordinator right enforced separately.
  invite_room_participant: ["work_room_write"],
  appoint_room_coordinator: ["work_room_write"],
  get_coworker_room_engagement: ["work_room_read"],
  create_workroom: ["work_capsule_write"],
  plan_workroom_worktree: ["work_capsule_write"],
  adopt_worktree: ["work_capsule_adopt"],
  claim_backlog_item_for_work: ["work_capsule_adopt"],
  start_external_work: ["work_capsule_adopt"],
  claim_workroom_scope: ["work_capsule_write"],
  record_workroom_evidence: ["work_capsule_write"],
  record_agent_activity: ["work_capsule_write"],
  heartbeat_workroom: ["work_capsule_write"],
  update_workroom_status: ["work_capsule_write"],
  release_workroom_scope: ["work_capsule_write"],
  reassign_workroom_executor: ["work_capsule_write"],
  get_runtime_coordination_map: ["work_capsule_read"],
  // Legacy capsule tool names, callable during the Workroom alias window
  // (BI-0702869B). Listed STATICALLY on purpose: the Coworker Tool-Grant Audit
  // reads this object literal without executing it, so a row derived at runtime
  // is invisible to it and reads as a catalog tool missing from TOOL_TO_GRANTS.
  // WORKROOM_TOOL_ALIASES below pins each of these to its canonical row in test.
  list_work_capsules: ["work_capsule_read"],
  get_work_capsule: ["work_capsule_read"],
  create_work_capsule: ["work_capsule_write"],
  plan_capsule_worktree: ["work_capsule_write"],
  claim_capsule_scope: ["work_capsule_write"],
  heartbeat_capsule: ["work_capsule_write"],
  update_work_capsule_status: ["work_capsule_write"],
  release_capsule_scope: ["work_capsule_write"],
  record_capsule_evidence: ["work_capsule_write"],
  reassign_capsule_executor: ["work_capsule_write"],
  // Queue-awareness reads (EP-3516E23D): platform-coordination visibility over
  // the shared queue flow-telemetry — same read grant as the sibling ops-read
  // tool above.
  get_queue_status: ["work_capsule_read"],
  list_at_risk_queues: ["work_capsule_read"],
  register_runtime_target: ["work_capsule_write"],
  heartbeat_runtime_target: ["work_capsule_write"],
  release_runtime_target: ["work_capsule_write"],
  record_runtime_verification: ["work_capsule_write"],
  list_nonprod_environment_leases: ["work_capsule_read"],
  lookup_change_origin: ["work_capsule_read"],
  claim_nonprod_environment_lease: ["work_capsule_write"],
  release_nonprod_environment_lease: ["work_capsule_write"],
  renew_nonprod_environment_lease: ["work_capsule_write"],

  // Scheduled agent tasks — recurring coordination-plane work. Reuse the
  // coordination read/write grants (scheduling is coordination work) so MCP and
  // portal share one rule set; satisfies the routing-audit INV-1 mapping.
  create_scheduled_agent_task: ["work_capsule_write"],
  cancel_scheduled_agent_task: ["work_capsule_write"],
  list_scheduled_agent_tasks: ["work_capsule_read"],

  // Org/WWWD business-decision consultation — advisory (returns a recommendation,
  // records a governance ledger row). Read-baseline grant: a coworker may consult
  // its organization's stance without a write grant. Satisfies routing-audit INV-1.
  evaluate_org_business_decision: ["work_capsule_read"],

  // Profession/WSID craft-decision consultation (BI-88B77204). This entry was
  // MISSING, and TOOL_TO_GRANTS denies unlisted tools by default — so the only
  // door to the WSID tier was shut for every coworker, not just the ones
  // lacking the grant the pack advertised. That is why the tier held 0 rows
  // while decision-routing-block.ts was instructing agents to call it.
  //
  // Keyed on `registry_read`, matching `principle_decide` (the WWMD sibling):
  // advisory, read-only, scoped to the CALLER'S OWN profession corpus, and it
  // executes nothing. A coworker may always consult its own craft. The pack
  // previously advertised `work_capsule_read`, which is unrelated — this gate
  // reads decision-perspective material, never a work capsule.
  evaluate_profession_decision: ["registry_read"],
  // Read-only platform self-introspection: which agents are missing which of
  // the seven capability planes. Same grant as the two decision doors above —
  // it reports gaps and never changes authority.
  get_capability_completeness: ["registry_read"],

  // Independent re-verification of a recorded decision's cited evidence
  // (BI-8192557E phase 2b). Same `registry_read` tier as its siblings: auditing
  // the evidence behind a decision must not need a higher grant than making the
  // decision did, or the check is less reachable than the thing it checks.
  reverify_decision_evidence: ["registry_read"],

  // Two more doors sealed the same way as evaluate_profession_decision, found
  // by the registry-wide sweep the BI-88B77204 fix added. Both packs already
  // declared the grant they intended; only the gating entry was missing, so
  // the intent is adopted verbatim rather than reinvented.
  dispatch_consolidation_bet: ["build_promote"],
  // BI-A08EBAEC: MCP call thrash / volume analysis from ToolExecution
  analyze_mcp_call_efficiency: ["agent_control_read"],
  // BI-3003EE63: A2A coworker↔coworker edge health (MCP-efficiency twin)
  analyze_a2a_collaboration_health: ["agent_control_read"],
  spawn_subagents: ["coworker_engagement_write"],

  // UX critique corpus (BI-52839DEA). Reading past design findings is advisory
  // and read-only, so it matches the decision gates. Capture writes a DRAFT
  // WikiPage under the craft overlay.
  //
  // `critique_capture` is DELIBERATELY ITS OWN GRANT rather than `registry_write`
  // (BI-52839DEA follow-up). Capture shipped on `registry_write`, which the
  // `development` template — the coding-agent token — does not hold, so the tool
  // was unreachable from the exact surface it was built for: a review happening
  // in Claude Code / Codex / Grok could read the corpus but never feed it.
  //
  // Widening the development template to `registry_write` would have fixed that
  // by also handing coding agents wiki_ingest, publish_wiki_overlay_pages,
  // create_knowledge_article, doc_save/doc_link/doc_state_change,
  // run_discovery_triage, attribute_entity_to_product, dismiss_entity and
  // resolve_portfolio_quality_issue — eleven tools of authority to enable one.
  // A narrow per-capability grant is the platform's own pattern here
  // (browser_read/browser_drive, siem_read/siem_investigate), and it keeps the
  // authority story honest: a coding agent may draft critique entries, and
  // nothing else in the registry.
  //
  // The grant is not authority over the corpus either: the pack pins every MCP
  // caller to `callerKind: "agent"`, so a captured entry can only ever carry an
  // agent-proposed verdict and is never calibration-eligible. Attaching a
  // founder/designer verdict stays a human act in the portal.
  capture_ux_critique: ["critique_capture"],
  search_ux_critique_corpus: ["registry_read"],

  // Org/WWWD qa elicitation feeder (BI-44526F3E Phase C): capture a CONFIRMED
  // operator answer about the business into the org corpus via enrichOrgCorpus
  // (qa provenance, first-party trust, draft-by-default per BI-1378). Requires
  // `registry_write` — same scope as wiki_ingest, because the commit writes
  // draft WikiPage/WikiPageRevision rows under the org's overlay.
  record_org_business_answer: ["registry_write"],

  // Compliance-scope capture (BI-0B867B67): the compliance coworker records what
  // the business does with data (dataHandling predicates) and where it employs
  // people (employsIn) into BusinessContext, moving matching regulations from
  // "needs review" to "applies". Requires `data_governance_validate` — the same
  // data-governance scope the compliance-officer already holds.
  record_compliance_scope: ["data_governance_validate"],

  // Open decision reviews — the /coworker-decisions governance hub's queue of deferred/escalated
  // decisions awaiting a human. Read-only tool on the `registry_read` baseline: any
  // coworker may read and recommend on the queue; resolving stays a human action
  // in the owning workflow after reviewing Decision Canvas evidence.
  list_open_decision_reviews: ["registry_read"],

  // Backlog triage and Build Studio promotion (spec 2026-04-21)
  // These were defined in PLATFORM_TOOLS but missing here, so every call was
  // denied by the default-deny rule below. That broke the entire backlog →
  // Build Studio handoff path through any coworker chat.
  triage_backlog_item:              ["backlog_triage"],
  size_backlog_item:                ["backlog_triage"],
  // Build lifecycle ops — refactored to the finer `build_lifecycle` grant
  // (BI-B2F7ABF5). Backwards-compat preserved by GRANT_IMPLICATIONS
  // (build_promote → build_lifecycle).
  promote_to_build_studio:          ["build_lifecycle"],
  process_backlog_for_build_studio: ["build_lifecycle"],
  // BI-297863B2: governed self-abandon of an agent's OWN stalled/superseded
  // build — the lifecycle-mutation sibling of promote, same grant.
  abandon_stalled_build:            ["build_lifecycle"],

  // Deliberation (multi-branch peer review / debate)
  start_deliberation:        ["deliberation_create"],
  get_deliberation_status:   ["deliberation_read"],
  get_deliberation_outcome:  ["deliberation_read"],
  deliberate_on:             ["deliberation_create"],

  // Specialist subtask thread spawning
  spawn_work_thread:         ["thread_write"],
  cancel_thread:             ["thread_write"],
  get_thread_result:         ["thread_read"],
  get_child_threads:         ["thread_read"],

  // Multi-agent collaboration (EP-A2A) — targeted handoff / summon spawn a
  // child work thread, so they require the same thread_write grant as spawn.
  request_coworker:          ["thread_write"],
  summon_coworker:           ["thread_write"],

  // Registry / Products
  create_digital_product: ["registry_read", "backlog_write"],
  update_lifecycle: ["backlog_write"],
  search_portfolio_context: ["portfolio_read", "registry_read"],
  register_digital_product_from_build: ["registry_read", "backlog_write"],
  create_build_epic: ["backlog_write"],

  // Web / External
  search_public_web: ["web_search"],
  fetch_public_website: ["web_search"],
  analyze_public_website_branding: ["web_search"],
  extract_brand_design_system: ["web_search", "file_read", "admin_write"],
  search_integrations: ["external_registry_search", "registry_read"],
  search_tool_marketplace: ["registry_read"],
  get_my_coworker_profile: ["registry_read"],
  assess_my_capabilities: ["registry_read"],
  submit_coworker_capability_need: ["registry_read"],
  list_my_capability_needs: ["registry_read"],
  // BI-F9E7B780: governance-surface variant — same grant tier (registry_read)
  // because both surfaces are read-only over the same CoworkerCapabilityNeed
  // model; the scope difference is "your needs" vs "everyone's needs", not
  // a privilege difference.
  list_all_capability_needs: ["registry_read"],
  list_coworker_services: ["coworker_catalog_read"],
  list_coworker_offers: ["coworker_catalog_read"],
  get_coworker_offer: ["coworker_catalog_read"],
  resolve_coworker_offer_agent_card: ["coworker_catalog_read"],
  request_coworker_engagement: ["coworker_engagement_write"],
  analyze_coworker_engagement_refinement: ["coworker_catalog_read"],
  search_knowledge: ["registry_read"],
  search_knowledge_base: ["registry_read"],
  create_knowledge_article: ["registry_write"],
  flag_stale_knowledge: ["registry_read"],
  doc_save: ["document_write", "registry_write"],
  doc_load: ["document_read", "registry_read"],
  doc_search: ["document_read", "registry_read"],
  doc_link: ["document_write", "registry_write"],
  doc_version_list: ["document_read", "registry_read"],
  doc_state_change: ["document_publish", "registry_write"],
  doc_list_references: ["document_read", "registry_read"],

  // EP-WIKI-001 Phase 3b2: Founder kernel + per-org overlay wiki
  wiki_query: ["registry_read"],
  // EP-WIKI-001 Phase 4b2b: on-demand wiki lint trigger
  wiki_lint: ["registry_read"],
  // EP-WIKI-001 Phase 2.3b: end-to-end ingest pipeline (file → RawSource →
  // LLM proposal → draft overlay pages). Requires `registry_write` because
  // commit-mode writes WikiPage / WikiPageRevision / WikiPageSource rows
  // under the org's overlay. Kernel pages remain PR-only at the engine
  // layer per spec §4.
  wiki_ingest: ["registry_write"],
  // EP-WIKI-001 coworker-UX: list pending overlay drafts so the coworker
  // can walk the user through them in chat. Read-only; same scope guard
  // as wiki_query.
  list_wiki_overlay_drafts: ["registry_read"],
  // EP-WIKI-001 coworker-UX: batch-publish overlay drafts after review.
  // Writes WikiPage.status + appends a manual revision row per page.
  publish_wiki_overlay_pages: ["registry_write"],
  // Principles-as-wiki-kind Phase 2 Task 2.7: advisory decision support
  // over governance principles. Read-only — returns scored options with a
  // contribution ledger; never executes the recommended option itself.
  principle_decide: ["registry_read"],

  // Build / Sandbox
  // Read-only verify-phase preflight (EP-VERIFY-PROC). Mapped to the build-context
  // grant the build-specialist already holds so it's available in the verify phase
  // without a new grant key; refine to a dedicated read grant if other roles need it.
  verification_preflight: ["build_plan_write"],
  launch_sandbox: ["sandbox_execute"],
  generate_code: ["sandbox_execute"],
  iterate_sandbox: ["sandbox_execute"],
  run_sandbox_tests: ["sandbox_execute"],
  read_sandbox_file: ["sandbox_execute"],
  edit_sandbox_file: ["sandbox_execute"],
  write_sandbox_file: ["sandbox_execute"],
  validate_schema: ["sandbox_execute"],
  describe_model: ["sandbox_execute"],
  // BI-F9CAF214: reads the COMMITTED schema from disk with explicit tree
  // provenance — no build, no sandbox. file_read (not sandbox_execute) so a
  // read-scoped external CLI token can hold it; it reads committed source
  // files exactly as read_project_file does.
  describe_committed_model: ["file_read"],
  search_sandbox: ["sandbox_execute"],
  // Programmatic tool calling (R4 / P7). Its own grant, default-deny → the tool
  // is invisible to every agent until deliberately granted; the runtime also
  // requires the programmatic_tool_calling flag. Read-only by construction.
  run_tool_script: ["tool_script_exec"],
  list_sandbox_files: ["sandbox_execute"],
  run_sandbox_command: ["sandbox_execute"],
  update_feature_brief: ["backlog_write"],
  assess_complexity: ["backlog_read"],
  propose_decomposition: ["backlog_write"],
  // Design-time decomposition Phase 4a/4b (BI-2E6CC391). These three tools
  // are downstream of Ideate (operating on a passed FeatureBuild design),
  // distinct from the upstream `propose_decomposition` brainstorming tool
  // above. Refactored to the finer `build_phase_advance` grant (BI-B2F7ABF5);
  // backwards-compat preserved by GRANT_IMPLICATIONS (backlog_write →
  // build_phase_advance).
  propose_build_decomposition: ["build_phase_advance"],
  approve_decomposition: ["build_phase_advance"],
  record_decomposition_override: ["build_phase_advance"],
  record_plan_backlog_coverage: ["backlog_write"],
  check_plan_backlog_coverage: ["backlog_read"],
  check_branch_plan_backlog_gate: ["backlog_read"],
  register_tech_debt: ["backlog_write"],
  // Build-evidence persistence — refactored to the finer `build_evidence`
  // grant (BI-B2F7ABF5). Backwards-compat preserved by GRANT_IMPLICATIONS.
  save_build_notes: ["build_evidence"],
  saveBuildEvidence: ["build_evidence"],
  reviewDesignDoc: ["architecture_read"],
  reviewBuildPlan: ["build_plan_write"],
  diagnose_sandbox: ["sandbox_execute", "work_capsule_read"],
  recover_sandbox: ["sandbox_execute"],
  // Build-progress observation tools are read-only work capsule inspection.
  get_build_engine_readiness: ["work_capsule_read"],
  resolve_model_selection: ["work_capsule_read"],
  get_build_progress_visibility: ["work_capsule_read"],
  get_build_sandbox_state: ["work_capsule_read"],
  get_build_dispatch_history: ["work_capsule_read"],
  get_build_scoped_verification: ["work_capsule_read"],
  list_build_activity_since: ["work_capsule_read"],

  // Deploy / Release
  deploy_feature: ["iac_execute"],
  execute_promotion: ["iac_execute"],
  check_deployment_windows: ["deployment_plan_create"],
  schedule_promotion: ["deployment_plan_create"],
  create_release_bundle: ["release_gate_create"],
  run_release_gate: ["release_gate_create"],
  schedule_release_bundle: ["release_plan_create"],
  get_release_status: ["release_plan_read"],
  verify_live_install_readiness: ["release_plan_read"],

  // Discovery / Monitoring
  summarize_estate_posture: ["registry_read"],
  list_patch_posture: ["registry_read"], // read-only patch-posture summary (peer of summarize_estate_posture); was a default-deny orphan flagged by the routing audit
  review_estate_identity: ["registry_read"],
  validate_version_confidence: ["registry_read"],
  explain_blast_radius: ["registry_read"],
  discovery_sweep: ["telemetry_read"],
  run_discovery_triage: ["registry_write"],
  run_hive_scout_ingest: ["backlog_write"],
  attribute_entity_to_product: ["registry_write"],
  dismiss_entity: ["registry_write"],
  resolve_portfolio_quality_issue: ["registry_write"],
  // Asset-intelligence enrichment (EP-ASSET-INTELLIGENCE, spec §4.6). A dedicated
  // finer grant (Pseudo-User Contract direction) so enrichment mutation is scoped
  // and auditable rather than folded into the broad registry_write — held today by
  // the estate-specialist (AGT-WS-INVENTORY) via agent_registry.json.
  enrich_digital_product: ["enrichment_write"],
  request_re_enrichment: ["enrichment_write"],
  // Banking books loop (S-FIN) — extracted to banking-tool-grants.ts, spread below.
  ...BANKING_TOOL_GRANTS,
  configure_gateway_scan: ["agent_control_read"],

  // UX / Page evaluation
  evaluate_page: ["file_read"],
  run_ux_test: ["file_read"],

  // Codebase access
  list_project_directory: ["file_read"],
  read_project_file: ["file_read"],
  search_project_files: ["file_read"],
  query_version_history: ["file_read"],
  generate_codebase_manifest: ["file_read"],
  read_codebase_manifest: ["file_read"],
  read_source_at_version: ["file_read"],
  search_source_at_version: ["file_read"],
  list_source_directory: ["file_read"],
  compare_versions: ["file_read"],
  propose_file_change: ["file_read"],
  propose_improvement: ["decision_record_create"],
  propose_skill_improvement: ["decision_record_create"],

  // Code graph (file-level coverage today; symbol-level deferred)
  get_code_graph_freshness: ["code_graph_read"],
  inspect_build_code_impact: ["code_graph_read"],
  get_change_gate_context: ["code_graph_read"],
  search_code_graph: ["code_graph_read"],
  trace_code_surface: ["code_graph_read"],
  find_related_tests: ["code_graph_read"],

  // Provider management
  add_provider: ["agent_control_read"],
  update_provider_category: ["agent_control_read"],
  // Read-only AI-layer state aggregation for the posture-article refresh task
  // (BI-5903D447) — same tier as the sibling provider-management tools.
  get_ai_platform_posture: ["agent_control_read"],
  run_endpoint_tests: ["agent_control_read"],
  activity_harness_confidence_override: ["agent_control_read"],
  // Provision a coworker's tool authority — grant/revoke one grant key. Same
  // grant tier as the sibling AI-ops management tools; the real gates are the
  // manage_platform capability + act mode + the self-target guard in the core.
  manage_coworker_tool_grant: ["agent_control_read"],
  // Factory door for creating/promoting coworkers (EP-COWORKER-LIFECYCLE
  // Phase 3). Same tier as the sibling AI-ops management tools; the real
  // gates are the manage_platform capability + the lifecycle state machine.
  establish_coworker: ["agent_control_read"],
  // Grok device-code sign-in (EP-GROK-001, #1624). The grant_catalog already
  // lists these under agent_control_read; #1624 added the catalog entries but
  // not the TOOL_TO_GRANTS mapping, so INV-1 flagged them as default-deny.
  grok_signin_start: ["agent_control_read"],
  grok_signin_status: ["agent_control_read"],

  // Employee / HR
  list_departments: ["registry_read"],
  list_positions: ["registry_read"],
  create_employee: ["consumer_write"],
  transition_employee_status: ["consumer_write"],
  propose_leave_policy: ["policy_write"],
  // BI-3CDEC5F0: company/compliance Policy draft lifecycle for coworkers
  list_policies: ["policy_read"],
  get_policy: ["policy_read"],
  create_policy: ["policy_write"],
  update_policy: ["policy_write"],
  request_policy_review: ["policy_write"],

  // Feedback
  submit_feedback: ["backlog_write"],

  // Brand
  analyze_brand_document: ["file_read"],

  // Compliance
  prefill_onboarding_wizard: ["data_governance_validate"],
  save_licensing_investigation: ["policy_write"],
  create_licensing_readiness_issue: ["policy_write"],

  // Tool evaluation (EP-GOVERN-002)
  evaluate_tool: ["tool_evaluation_create"],

  // EA / Ontology Graph
  create_ea_element:      ["ea_graph_write"],
  create_ea_relationship: ["ea_graph_write"],
  classify_ea_element:    ["ea_graph_write"],
  import_archimate:       ["ea_graph_write"],
  query_ontology_graph:   ["ea_graph_read"],
  run_traversal_pattern:  ["ea_graph_read"],
  export_archimate:       ["ea_graph_read"],
  describe_ea_view:       ["ea_graph_read"],

  // Customer / CRM (EP-CRM-COWORKER). The customer workspace (accounts,
  // engagements, pipeline, opportunities, quotes, orders) had a rich backend
  // (lib/actions/crm.ts) and read-only pages but NO coworker tools — so the
  // Customer Success Manager (customer-advisor) was left with only generic
  // backlog/registry grants and flailed (it had no way to qualify an
  // opportunity or draft a quote). These two finer grants carry the CRM tool
  // surface: `crm_read` for inspection, `crm_write` for drafting internal
  // records (draft opportunities/quotes — reversible, not external sends).
  list_customer_accounts: ["crm_read"],
  list_opportunities:     ["crm_read"],
  get_opportunity:        ["crm_read"],
  list_quotes:            ["crm_read"],
  read_operational_record: ["crm_read"],
  create_customer_account: ["crm_write"],
  create_customer_contact: ["crm_write"],
  create_opportunity:      ["crm_write"],
  create_quote:            ["crm_write"],
  // Merging duplicates is customer-data stewardship: heavier than drafting,
  // still inside the CRM-write trust envelope (tombstone, never delete).
  merge_customer_accounts: ["crm_write"],
  find_duplicate_customer_accounts: ["crm_read"],
  unmerge_customer_accounts: ["crm_write"],
  merge_customer_contacts: ["crm_write"],
  run_mdm_steward_sweep: ["crm_write"],
  list_mdm_steward_tasks: ["crm_read"],
  enrich_customer_account: ["web_search"],
  run_data_steward: ["crm_write"],
  // Proactive CRM enrichment (BI-B2497DFB): propose is web-research stewardship
  // inside the CRM-read envelope; apply is the consequential CRM write.
  propose_crm_enrichment: ["web_search", "crm_read"],
  apply_crm_enrichment: ["crm_write"],

  // Security Operations / SIEM (EP-SOVEREIGN-SOC). Writes are propose-only +
  // coworkerArtifact; siem_investigate/siem_tune/incident_respond imply siem_read.
  query_security_events:    ["siem_read"],
  query_detections:         ["siem_read"],
  get_security_case:        ["siem_read"],
  open_security_case:       ["siem_investigate"],
  update_security_case:     ["siem_investigate"],
  propose_detection_tuning: ["siem_tune"],
  propose_response:         ["incident_respond"],

  // Finance
  get_finance_period_summary:   ["financial_report_create"],

  // Marketing / Storefront
  // Guest activity (orders / reservations / inquiries) is the storefront's
  // demand signal; one consolidated read tool carries it.
  list_storefront_activity:     ["storefront_read"],
  list_stock_coverage:          ["stock_read"],
  get_marketing_summary:        ["marketing_read"],
  suggest_campaign_ideas:       ["marketing_read"],
  build_tracked_links:          ["marketing_read"],
  get_campaign_plan:            ["marketing_read"],
  get_campaign_performance:     ["marketing_read"],
  get_content_calendar:         ["marketing_read"],
  get_asset_variants:           ["marketing_read"],
  create_asset_variant:         ["marketing_write"],
  record_variant_result:        ["marketing_write"],
  get_battlecards:              ["marketing_read"],
  create_battlecard:            ["marketing_write"],
  get_work_engagement_instances:   ["work_engagement_read"],
  create_recurring_work_engagement: ["work_engagement_write"],
  record_work_engagement_activity:  ["work_engagement_write"],
  transition_work_engagement:       ["work_engagement_transition"],
  create_marketing_campaign:    ["marketing_write"],
  update_marketing_campaign:    ["marketing_write"],
  attach_to_campaign:           ["marketing_write"],
  save_marketing_review:        ["marketing_write"],
  create_marketing_campaign_brief: ["marketing_write"],
  create_marketing_asset_task:   ["marketing_write"],
  record_marketing_grounding:    ["marketing_write"],
  record_marketing_kpi_checkpoint: ["marketing_write"],
  create_marketing_automation_candidate: ["marketing_write"],
  draft_marketing_asset:         ["marketing_write"],
  publish_to_linkedin:           ["marketing_write"],
  send_marketing_email:          ["marketing_write"],
  place_linkedin_ad:             ["marketing_write"],
  refresh_channel_kpis:          ["marketing_write"],
  tick_marketing_scheduler:      ["marketing_write"],
  plan_upcoming_marketing_drafts: ["marketing_write"],
  // Tool checks `requiredCapability: "manage_provider_connections"` at the
  // user-capability layer (operator-only). The agent-grant layer just gates
  // whether the agent may attempt the tool; marketing-specialist needs
  // marketing_write here for the prompt to even surface the tool name. The
  // OPERATOR's capability gate is the real "operator-only" enforcement;
  // marketing-specialist's prompt is also explicit that it must not call
  // this tool itself.
  set_marketing_autopilot_policy: ["marketing_write"],
  analyze_seo_opportunity:      ["marketing_read"],
  generate_custom_archetype:    ["marketing_write"],
  assess_archetype_refinement:  ["marketing_read"],

  // Email setup (PBI-INV-04 Phase 2). Operator-only at the user-capability
  // layer (the tool carries requiredCapability: "manage_provider_connections");
  // this agent grant gates whether the coworker may surface + call it. Held by
  // the onboarding-coo (setup wizard) and the workspace COO.
  setup_email: ["email_config"],

  // Admin
  admin_view_logs:        ["admin_read"],
  admin_query_db:         ["admin_read"],
  admin_read_file:        ["admin_read"],
  admin_restart_service:  ["admin_write"],
  admin_run_migration:    ["admin_write"],
  admin_run_seed:         ["admin_write"],
  admin_run_command:       ["admin_write"],

  // Build lifecycle (sandbox-adjacent)
  // Provisioning a build engine runs an install command inside the sandbox.
  provision_build_engine:     ["sandbox_execute"],
  reconcile_build_engines:    ["sandbox_execute"],
  check_sandbox:              ["sandbox_execute"],
  start_sandbox:              ["sandbox_execute"],
  start_build:                ["sandbox_execute"],
  start_ideate_research:      ["sandbox_execute", "file_read"],
  start_scout_research:       ["sandbox_execute", "file_read", "web_search"],
  create_portal_pr:           ["sandbox_execute"],
  suggest_taxonomy_placement: ["registry_read"],
  confirm_taxonomy_placement: ["backlog_write"],
  analyze_reusability:        ["backlog_read"],
  save_phase_handoff:         ["backlog_write"],

  // Hive Mind / Platform updates
  assess_contribution:    ["backlog_read"],
  contribute_to_hive:     ["backlog_write"],
  set_change_disposition: ["backlog_write"],
  apply_platform_update:  ["admin_write"],
  // BI-C26F7EE1: read-only operator preview of the upstream change set —
  // paired with apply_platform_update's admin_write as the read tier.
  summarize_upgrade_impact: ["admin_read"],

  // Contributor inventory sync — admin-scope on-demand trigger so agents
  // that just pushed a branch / opened a PR can force the cron to run
  // out-of-band rather than waiting up to 10 minutes (BI-063BDF1B Phase 5).
  trigger_contributor_inventory_sync: ["admin_write"],
  request_self_upgrade: ["admin_write"],
  issue_ux_verification_sign_in: ["sandbox_execute"], // BI-9369DEB5: UX verification sign-in; a development token already holds it
  // Governed self-heal for the "promoter image not built" self-upgrade skip.
  // Same admin_write scope as request_self_upgrade so the platform-engineer
  // ("AI Ops Engineer") coworker can build the promoter image on request.
  repair_promoter_image: ["admin_write"],
  get_self_upgrade_queue_status: ["release_plan_read"],
  get_quiescence_status: ["release_plan_read"],
  // Design intelligence (read-only references)
  search_design_intelligence: ["file_read"],
  generate_design_system:     ["file_read"],
  // HR — query
  query_employees: ["consumer_read", "registry_read"],

  // Recruiting pipeline lens (BI-E64D11AE) — unified native + Greenhouse funnel.
  get_recruiting_pipeline: ["consumer_read", "registry_read"],

  // Workforce staffing + propose-only leave-decision surfaces.
  list_staffing_demand: ["registry_read"],
  get_staffing_coverage: ["registry_read"],
  propose_leave_decision: ["consumer_read", "registry_read"],
  // ─── Pseudo-User Contract: screen_* view-command family (BI-DF6079E9) ─────
  // Three finer grants (coworker_screen_read / drive / fill) carry the view-
  // command surface. screen_scroll_to is read-class per the chief-architect
  // review (PR #1361). screen_dispatch_action gates on coworker_screen_drive
  // at the entry; the underlying tool resolved from the envelope's
  // manifestActionId carries its own grant check (BI-0F9C291C will wire
  // the second-key resolution).
  screen_describe:         ["coworker_screen_read"],
  screen_get_state:        ["coworker_screen_read"],
  screen_scroll_to:        ["coworker_screen_read"],
  screen_select_entity:    ["coworker_screen_drive"],
  screen_navigate:         ["coworker_screen_drive"],
  screen_open_panel:       ["coworker_screen_drive"],
  screen_close_panel:      ["coworker_screen_drive"],
  screen_focus_field:      ["coworker_screen_drive"],
  screen_propose_action:   ["coworker_screen_drive"],
  screen_dispatch_action:  ["coworker_screen_drive"],
  screen_set_input:        ["coworker_screen_fill"],
  ...AUTHORIZED_SURFACE_TOOL_GRANTS,
};

/**
 * Legacy capsule tool names, still callable during the Workroom alias window
 * (EP-WORK-CONVERGENCE / BI-0702869B). Derived rather than hand-copied:
 * TOOL_TO_GRANTS DENIES UNLISTED TOOLS, so an alias whose grants drift from its
 * canonical name becomes a silent authorization failure. Deriving them makes the
 * two provably identical and deletes in one edit when the window closes.
 */
export const WORKROOM_TOOL_ALIASES: Record<string, string> = {
  list_work_capsules: "list_workrooms",
  get_work_capsule: "get_workroom",
  create_work_capsule: "create_workroom",
  plan_capsule_worktree: "plan_workroom_worktree",
  claim_capsule_scope: "claim_workroom_scope",
  heartbeat_capsule: "heartbeat_workroom",
  update_work_capsule_status: "update_workroom_status",
  release_capsule_scope: "release_workroom_scope",
  record_capsule_evidence: "record_workroom_evidence",
  reassign_capsule_executor: "reassign_workroom_executor",
};



/**
 * The catalog of every grant KEY known to the authority registry, derived from
 * the single source of truth (TOOL_TO_GRANTS values + GRANT_IMPLICATIONS keys
 * and values + the read baseline) rather than hand-listed, so the per-coworker
 * grant editor (the Capabilities tab select) can never drift from the grants
 * the runtime actually understands. Sorted, de-duplicated.
 *
 * A grant key here is "real" iff at least one platform tool maps to it (or it is
 * a baseline / implication endpoint). Granting any other string would persist an
 * AgentToolGrant row that authorizes nothing — the editor uses this list to keep
 * the operator on the rails of the closed grant vocabulary.
 */
export function knownGrantKeys(): string[] {
  const keys = new Set<string>(COWORKER_READ_BASELINE_GRANTS);
  for (const grants of Object.values(TOOL_TO_GRANTS)) {
    for (const g of grants) keys.add(g);
  }
  for (const [coarse, implied] of Object.entries(GRANT_IMPLICATIONS)) {
    keys.add(coarse);
    for (const g of implied) keys.add(g);
  }
  return Array.from(keys).sort();
}

const grantCache = new Map<string, string[]>();

type AgentEntry = {
  agent_id: string;
  agent_name: string;
  tier: string;
  value_stream: string;
  human_supervisor_id: string;
  hitl_tier_default: number;
  escalates_to: string;
  delegates_to: string[];
  config_profile: { tool_grants: string[] };
};

/**
 * Load tool_grants for an agent (cached).
 * EP-AI-WORKFORCE-001: First tries DB (AgentToolGrant table), falls back to
 * agent_registry.json for agents not yet migrated.
 */
export function getAgentToolGrants(agentId: string): string[] | null {
  if (grantCache.has(agentId)) return grantCache.get(agentId)!;
  // Fallback: JSON registry lookup (synchronous, always available)
  const agent = (agentRegistry.agents as AgentEntry[]).find(
    (a) => a.agent_id === agentId || a.agent_name === agentId,
  );
  if (!agent) return null;
  const grants = agent.config_profile.tool_grants;
  grantCache.set(agentId, grants);
  return grants;
}

/**
 * EP-AI-WORKFORCE-001: Async DB-backed grant resolution.
 * Resolves grants from AgentToolGrant table, falling back to JSON registry.
 * Use this in async contexts (API routes, server actions).
 */
export async function getAgentToolGrantsAsync(agentId: string): Promise<string[]> {
  if (grantCache.has(agentId)) return grantCache.get(agentId)!;

  try {
    const { prisma } = await import("@dpf/db");
    const agent = await prisma.agent.findFirst({
      where: { OR: [{ agentId }, { slugId: agentId }] },
      include: { toolGrants: true },
    });
    if (agent && agent.toolGrants.length > 0) {
      const grants = agent.toolGrants.map((g) => g.grantKey);
      grantCache.set(agentId, grants);
      return grants;
    }
  } catch {
    // DB unavailable — fall through to JSON
  }

  // Fallback to JSON registry
  return getAgentToolGrants(agentId) ?? [];
}

/** Check if a specific tool is allowed by an agent's grants. The agent's
 *  held grants are expanded through GRANT_IMPLICATIONS before the check, so
 *  a coarse legacy grant (e.g. `backlog_write`) still satisfies a tool that
 *  has been refactored to require a finer grant (e.g. `build_evidence`). */
export function isToolAllowedByGrants(
  toolName: string,
  agentGrants: string[],
): boolean {
  const requiredGrants = TOOL_TO_GRANTS[toolName];
  // Tools not in the mapping are DENIED — every tool must have a grant entry.
  // This prevents silent permission escalation when new tools are added without
  // a corresponding grant mapping.
  if (!requiredGrants) {
    console.warn(`[agent-grants] Tool ${JSON.stringify(toolName)} has no TOOL_TO_GRANTS entry — denied by default`);
    return false;
  }
  if (requiredGrants.length === 0) return true;
  // Expand the agent's grants through GRANT_IMPLICATIONS, then check that the
  // expanded set includes at least one of the required grants.
  const expanded = expandGrants(agentGrants);
  return requiredGrants.some((g) => expanded.includes(g));
}

export type EffectivePermission = {
  toolName: string;
  toolDescription: string;
  userAllowed: boolean;
  agentAllowed: boolean;
  effective: boolean;
  executionMode: string;
  grantReason: string | null;
};

/** Get the tool-to-grant mapping (for UI display). */
export function getToolGrantMapping(): Record<string, string[]> {
  return { ...TOOL_TO_GRANTS };
}

/**
 * EP-AI-WORKFORCE-001: Get agent grant summaries from DB (unified model).
 * Falls back to JSON registry if DB query fails.
 */
export async function getAgentGrantSummaries(): Promise<Array<{
  agentId: string;
  agentName: string;
  tier: string;
  valueStream: string;
  grantCount: number;
  grants: string[];
  supervisorId: string;
  hitlTier: number;
  escalatesTo: string;
  delegatesTo: string[];
}>> {
  const TIER_LABELS: Record<number, string> = { 1: "orchestrator", 2: "specialist", 3: "cross-cutting" };
  try {
    const { prisma } = await import("@dpf/db");
    const agents = await prisma.agent.findMany({
      where: { archived: false },
      orderBy: [{ tier: "asc" }, { name: "asc" }],
      include: { toolGrants: true },
    });
    return agents.map((a) => ({
      agentId: a.agentId,
      agentName: a.name,
      tier: TIER_LABELS[a.tier] ?? "specialist",
      valueStream: a.valueStream ?? "cross-cutting",
      grantCount: a.toolGrants.length,
      grants: a.toolGrants.map((g) => g.grantKey),
      supervisorId: a.humanSupervisorId ?? "",
      hitlTier: a.hitlTierDefault,
      escalatesTo: a.escalatesTo ?? "",
      delegatesTo: a.delegatesTo,
    }));
  } catch {
    // Fallback to JSON registry
    return (agentRegistry.agents as AgentEntry[]).map(
      (a) => ({
        agentId: a.agent_id,
        agentName: a.agent_name,
        tier: a.tier,
        valueStream: a.value_stream,
        grantCount: a.config_profile.tool_grants.length,
        grants: a.config_profile.tool_grants as string[],
        supervisorId: a.human_supervisor_id,
        hitlTier: a.hitl_tier_default,
        escalatesTo: a.escalates_to,
        delegatesTo: a.delegates_to,
      }),
    );
  }
}
