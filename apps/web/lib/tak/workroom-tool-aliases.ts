/** Compatibility names for BI-0702869B; advertised tools remain canonical. */
export const WORKROOM_TOOL_ALIASES: Readonly<Record<string, string>> = {
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

/** Resolve only declared aliases, never inherited Object properties. */
export function canonicalWorkroomToolName(name: string): string {
  return Object.hasOwn(WORKROOM_TOOL_ALIASES, name) ? WORKROOM_TOOL_ALIASES[name]! : name;
}
