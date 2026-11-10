// Payables tool grants (BI-EBF0F6EE), spread into TOOL_TO_GRANTS (the
// BANKING_TOOL_GRANTS pattern). Mirrors payables-pack.ts grants; the
// tool-registry drift test asserts parity, and
// apps/web/scripts/audit-coworker-tool-grants.ts reads this map.
//
// payables_read is its own grant so reading bills or supplier agreements never
// implies banking or financial-reporting authority. Paying, renewing and
// cancelling have no tool here at all.

export const PAYABLES_TOOL_GRANTS = {
  list_bills: ["payables_read"],
  list_supplier_contracts: ["payables_read"],
} satisfies Record<string, string[]>;
