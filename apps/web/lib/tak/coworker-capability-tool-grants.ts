// Tool-to-grant mappings for coworker capability self-assessment and governed
// Living Playbook work-pattern experiment origination (BI-5A17505E).

export const COWORKER_CAPABILITY_TOOL_GRANTS: Record<string, string[]> = {
  get_my_coworker_profile: ["registry_read"],
  get_my_approval_status: ["registry_read"],
  probe_pending_approval_conversion: ["approval_probe_read"], // BI-129EFFD1: read-only AC-PROBE, manage_platform
  assess_my_capabilities: ["registry_read"],
  submit_coworker_capability_need: ["registry_read"],
  list_my_capability_needs: ["registry_read"],
  // BI-F9E7B780: governance-surface variant — same grant tier (registry_read).
  list_all_capability_needs: ["registry_read"],
  // BI-5A17505E: originates a reviewable Living Playbook experiment candidate.
  propose_work_pattern_experiment_candidate: ["registry_write"],
};
