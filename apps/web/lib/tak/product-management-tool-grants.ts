export const PRODUCT_MANAGEMENT_TOOL_GRANTS = {
  transition_demand_item: ["backlog_write"],
  link_demand_evidence: ["backlog_write"],
  supersede_demand_evidence: ["backlog_write"],
  create_product_objective: ["backlog_write"],
  update_product_objective: ["backlog_write"],
  review_product_objective: ["backlog_write"],
  transition_product_objective: ["backlog_write"],
  link_product_objective_work: ["backlog_write"],
  record_product_outcome_observation: ["backlog_write"],
  correct_product_outcome_observation: ["backlog_write"],
  pause_scheduled_agent_task: ["work_capsule_write"],
  resume_scheduled_agent_task: ["work_capsule_write"],
  rerun_scheduled_agent_task: ["work_capsule_write"],
  propose_product_research: ["marketing_write"],
} satisfies Record<string, string[]>;

export const PRODUCT_OUTCOME_WRITE_TOOLS = [
  "create_product_objective",
  "update_product_objective",
  "review_product_objective",
  "transition_product_objective",
  "link_product_objective_work",
  "record_product_outcome_observation",
  "correct_product_outcome_observation",
] as const;
