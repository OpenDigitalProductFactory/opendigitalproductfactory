// Banking books-loop tool grants (BI-DE27D34E, slice S-FIN of BI-1585FA9E).
//
// Extracted from agent-grants.ts and spread into TOOL_TO_GRANTS, matching the
// PRODUCT_MANAGEMENT_TOOL_GRANTS / INITIATIVE_READINESS_TOOL_GRANTS pattern, so
// the gating map stays lean as domains are added. banking_read gates the read
// tools; banking_write gates the mutations. Mirrors banking-pack.ts grants; the
// tool-registry drift test asserts parity. create_bank_account and
// import_bank_statement are additionally listed in
// ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES so they route the governance gate.

export const BANKING_TOOL_GRANTS = {
  list_bank_accounts: ["banking_read"],
  get_bank_account: ["banking_read"],
  get_bank_transactions: ["banking_read"],
  suggest_transaction_matches: ["banking_read"],
  list_bank_rules: ["banking_read"],
  get_reconciliation_summary: ["banking_read"],
  create_bank_account: ["banking_write"],
  import_bank_statement: ["banking_write"],
  match_transaction: ["banking_write"],
  unmatch_transaction: ["banking_write"],
  create_bank_rule: ["banking_write"],
  delete_bank_rule: ["banking_write"],
} satisfies Record<string, string[]>;
