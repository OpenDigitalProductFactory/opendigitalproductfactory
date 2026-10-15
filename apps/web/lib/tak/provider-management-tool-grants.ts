/** Provider account controls retain the existing provider-management grant. */
export const PROVIDER_MANAGEMENT_TOOL_GRANTS: Record<string, string[]> = {
  add_provider: ["agent_control_read"],
  update_provider_category: ["agent_control_read"],
  get_provider_accounts: ["agent_control_read"],
  manage_provider_account: ["agent_control_read"],
};
