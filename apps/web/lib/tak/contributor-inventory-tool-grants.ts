// Contributor inventory read-tool grants (BI-EBF0F6EE), spread into TOOL_TO_GRANTS (the
// BANKING_TOOL_GRANTS pattern) so the gating map stays lean. Mirrors
// contributor-inventory-pack.ts grants; the tool-registry drift test asserts
// parity, and apps/web/scripts/audit-coworker-tool-grants.ts reads this map.

export const CONTRIBUTOR_INVENTORY_TOOL_GRANTS = {
  // A narrow grant of their own, so reading pull-request health never implies
  // trigger_contributor_inventory_sync (admin_write, in agent-grants.ts).
  list_pull_requests: ["contributor_inventory_read"],
  read_contributor_inventory: ["contributor_inventory_read"],
} satisfies Record<string, string[]>;
