/** One authority mapping for the platform-update pack and canonical registry. */
export const PLATFORM_UPDATE_TOOL_GRANTS: Record<string, string[]> = {
  apply_platform_update: ["admin_write"],
  summarize_upgrade_impact: ["admin_read"],
  preview_runtime_capability_reconciliation: ["admin_read"],
  reconcile_runtime_capabilities: ["admin_write"],
};
