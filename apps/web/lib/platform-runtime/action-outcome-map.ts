// apps/web/lib/platform-runtime/action-outcome-map.ts
//
// Turns raw ToolExecution rows into a human-readable "what did this coworker
// get done" digest (BI-1A68257F). The workforce view shows OUTCOMES ("3 backlog
// items filed", "2 campaigns launched"), not tool names or a log dump — that is
// the load-bearing translation between the runtime and the founder's mental
// model of the coworker as a colleague.
//
// Only action/write tools count as accomplishments. Read tools (get_/list_/
// search_/query_/…) are how a coworker looks things up, not what it produced, so
// they are excluded rather than shown as busywork. Any write tool without a
// curated label folds into a single "other actions" bucket so the digest stays
// short and the list never leaks a raw tool name.

// Action tools whose transactions handle SENSITIVE data — PII, financial,
// customer, or regulated. Surfaced so an operator can see at a glance where
// sensitive data is in play (HR, finance, customer, compliance, legal have
// many; Build Studio and Marketing largely have none). Curated, not inferred:
// this is a data-governance judgement per tool, refined as tools are added. A
// later pass can bind it to ToolExecution.auditClass / capability data-boundary.
const SENSITIVE_DATA_TOOLS = new Set<string>([
  "create_employee",
  "update_employee",
  "draft_offer",
  "run_payroll",
  "approve_leave",
  "approve_timesheet",
  "adjust_compensation",
  "create_customer_case",
  "record_customer_contact",
  "prepare_counsel_packet",
  "record_cost",
  "process_payment",
  "reconcile_account",
]);

/** A curated business-outcome label per action tool. */
const TOOL_OUTCOMES: Record<string, { one: string; many: string }> = {
  create_backlog_item: { one: "backlog item filed", many: "backlog items filed" },
  create_build_epic: { one: "epic created", many: "epics created" },
  create_epic: { one: "epic created", many: "epics created" },
  create_customer_case: { one: "case opened", many: "cases opened" },
  create_marketing_campaign: { one: "campaign launched", many: "campaigns launched" },
  update_marketing_campaign: { one: "campaign updated", many: "campaigns updated" },
  create_asset_variant: { one: "variant created", many: "variants created" },
  record_variant_result: { one: "result recorded", many: "results recorded" },
  create_battlecard: { one: "battlecard built", many: "battlecards built" },
  propose_product_research: { one: "research proposed", many: "researches proposed" },
  build_tracked_links: { one: "tracked link minted", many: "tracked links minted" },
  doc_save: { one: "document saved", many: "documents saved" },
  create_work_capsule: { one: "work capsule opened", many: "work capsules opened" },
  create_portal_pr: { one: "PR opened", many: "PRs opened" },
  propose_file_change: { one: "change proposed", many: "changes proposed" },
  saveBuildEvidence: { one: "build evidence saved", many: "build evidence saved" },
  run_sandbox_tests: { one: "test run", many: "test runs" },
  create_scheduled_agent_task: { one: "task scheduled", many: "tasks scheduled" },
  capture_ux_critique: { one: "UX critique recorded", many: "UX critiques recorded" },
  create_digital_product: { one: "product registered", many: "products registered" },
  transition_demand_item: { one: "demand advanced", many: "demand items advanced" },
  score_demand_item: { one: "demand scored", many: "demand items scored" },
  // Sensitive-data actions (see SENSITIVE_DATA_TOOLS).
  create_employee: { one: "employee onboarded", many: "employees onboarded" },
  update_employee: { one: "employee record updated", many: "employee records updated" },
  draft_offer: { one: "offer drafted", many: "offers drafted" },
  run_payroll: { one: "payroll run", many: "payroll runs" },
  approve_leave: { one: "leave approved", many: "leave approvals" },
  approve_timesheet: { one: "timesheet approved", many: "timesheets approved" },
  adjust_compensation: { one: "compensation adjusted", many: "compensation changes" },
  record_customer_contact: { one: "customer contact logged", many: "customer contacts logged" },
  prepare_counsel_packet: { one: "counsel packet prepared", many: "counsel packets prepared" },
  record_cost: { one: "cost recorded", many: "costs recorded" },
  process_payment: { one: "payment processed", many: "payments processed" },
  reconcile_account: { one: "account reconciled", many: "accounts reconciled" },
};

/** Prefixes that mark a read/lookup tool — never an accomplishment. */
const READ_PREFIXES = ["get_", "list_", "search_", "query_", "read_", "describe_", "find_", "doc_search", "wiki_query", "assess_", "check_", "trace_"];

export type Outcome = { label: string; count: number; sensitive: boolean };

function isReadTool(toolName: string): boolean {
  return READ_PREFIXES.some((p) => toolName.startsWith(p));
}

function pluralize(label: { one: string; many: string }, count: number): string {
  return count === 1 ? label.one : label.many;
}

/**
 * Summarize a coworker's tool-call counts into an ordered outcome digest.
 * Curated action tools become named outcomes; unmapped write tools fold into a
 * single "other actions" bucket; read tools are dropped. Exported for tests.
 *
 * @param toolCounts  toolName → number of successful calls today
 * @param limit       max named outcomes before the "other" bucket
 */
export function summarizeOutcomes(
  toolCounts: Record<string, number>,
  limit = 4,
): Outcome[] {
  const named: Outcome[] = [];
  let otherCount = 0;
  let otherSensitive = false;

  for (const [toolName, count] of Object.entries(toolCounts)) {
    if (count <= 0 || isReadTool(toolName)) continue;
    const sensitive = SENSITIVE_DATA_TOOLS.has(toolName);
    const label = TOOL_OUTCOMES[toolName];
    if (label) {
      named.push({ label: pluralize(label, count), count, sensitive });
    } else {
      otherCount += count;
      otherSensitive = otherSensitive || sensitive;
    }
  }

  named.sort((a, b) => b.count - a.count);
  const top = named.slice(0, limit);
  const droppedRows = named.slice(limit);
  const remainder = otherCount + droppedRows.reduce((sum, o) => sum + o.count, 0);
  const remainderSensitive = otherSensitive || droppedRows.some((o) => o.sensitive);

  if (remainder > 0) {
    top.push({
      label: remainder === 1 ? "other action" : "other actions",
      count: remainder,
      sensitive: remainderSensitive,
    });
  }
  return top;
}

/** Whether a set of tool counts contains any real accomplishment. */
export function hasOutcomes(toolCounts: Record<string, number>): boolean {
  return Object.entries(toolCounts).some(
    ([toolName, count]) => count > 0 && !isReadTool(toolName),
  );
}
