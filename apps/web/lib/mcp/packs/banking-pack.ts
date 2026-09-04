// Banking tool pack (BI-DE27D34E, slice S-FIN of the Bookkeeping Work Room
// BI-1585FA9E).
//
// The books loop already existed as UI server actions (apps/web/lib/actions/
// banking.ts) but was NOT reachable through governed MCP tools, so no coworker
// could keep the books current. This pack exposes that loop — set up accounts,
// import a statement, auto-categorize via bank rules, match/reconcile against
// payments — as governed tools with the `banking_read` / `banking_write` grant
// axis. Handlers are thin adapters over the existing, tested actions; no new
// business logic lives here.
//
// No fabrication: amounts come from the imported statement CSV, and import
// returns per-row `errors` so parse gaps are surfaced, never guessed. The two
// consequential writes (create_bank_account, import_bank_statement) are listed
// in ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES so they route the governance gate for
// owner approval. Grants mirror agent-grants.ts TOOL_TO_GRANTS (the gating
// source); the tool-registry drift test asserts parity.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";
import {
  createBankAccountSchema,
  createBankRuleSchema,
  matchTransactionSchema,
} from "@/lib/finance/banking-validation";

const definitions: ToolDefinition[] = [
  {
    name: "list_bank_accounts",
    description:
      "List the organization's bank/card accounts with their unmatched-transaction counts. Use to find the bankAccount id to import into or reconcile before any other banking tool.",
    inputSchema: { type: "object", properties: {}, required: [] },
    requiredCapability: "manage_finance",
    sideEffect: false,
  },
  {
    name: "get_bank_account",
    description:
      "Read one bank/card account with its 50 most recent transactions and its unmatched count. Needs the account's database id (from list_bank_accounts).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "BankAccount database id" } },
      required: ["id"],
    },
    requiredCapability: "manage_finance",
    sideEffect: false,
  },
  {
    name: "get_bank_transactions",
    description:
      "Read a bank account's transactions, most recent first, optionally filtered by match status (unmatched | matched | manually_matched | excluded). Use to see what still needs reconciling.",
    inputSchema: {
      type: "object",
      properties: {
        bankAccountId: { type: "string", description: "BankAccount database id" },
        matchStatus: {
          type: "string",
          enum: ["unmatched", "matched", "manually_matched", "excluded"],
          description: "Optional match-status filter",
        },
      },
      required: ["bankAccountId"],
    },
    requiredCapability: "manage_finance",
    sideEffect: false,
  },
  {
    name: "suggest_transaction_matches",
    description:
      "For one unmatched bank transaction, suggest candidate inbound payments to reconcile it against, scored by amount/date/reference. Read-only — proposes, does not reconcile. Follow with match_transaction to commit a chosen candidate.",
    inputSchema: {
      type: "object",
      properties: { transactionId: { type: "string", description: "BankTransaction database id" } },
      required: ["transactionId"],
    },
    requiredCapability: "manage_finance",
    sideEffect: false,
  },
  {
    name: "list_bank_rules",
    description:
      "List the auto-categorization bank rules (by hit count). Rules classify imported transactions by matching payee/description/reference. Use to review or before creating a new rule.",
    inputSchema: { type: "object", properties: {}, required: [] },
    requiredCapability: "manage_finance",
    sideEffect: false,
  },
  {
    name: "get_reconciliation_summary",
    description:
      "Reconciliation status for one bank account: unmatched vs total transaction counts, current balance, and last-reconciled time. Use to report how current the books are and what remains.",
    inputSchema: {
      type: "object",
      properties: { bankAccountId: { type: "string", description: "BankAccount database id" } },
      required: ["bankAccountId"],
    },
    requiredCapability: "manage_finance",
    sideEffect: false,
  },
  // ─── Writes ───────────────────────────────────────────────────────────────
  {
    name: "create_bank_account",
    description:
      "Set up a bank or card account to import statements into. CONSEQUENTIAL — routes the governance gate for owner approval. Provide a name; bank/account details, currency (3-letter), account type (current|savings|credit_card|loan|merchant), and opening balance are optional.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Account display name" },
        bankName: { type: "string", description: "Bank/issuer name" },
        accountNumber: { type: "string", description: "Account number (last digits are fine)" },
        sortCode: { type: "string", description: "Sort code / routing number" },
        iban: { type: "string", description: "IBAN" },
        swift: { type: "string", description: "SWIFT/BIC" },
        currency: { type: "string", description: "3-letter ISO currency, e.g. USD" },
        accountType: {
          type: "string",
          enum: ["current", "savings", "credit_card", "loan", "merchant"],
          description: "Account type",
        },
        openingBalance: { type: "number", description: "Opening balance in major currency units" },
      },
      required: ["name"],
    },
    requiredCapability: "manage_finance",
    sideEffect: true,
    // Money-of-record: no governed tool undoes an account setup, and it is
    // alignment-gated for owner approval (ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES).
    consequence: "irreversible",
  },
  {
    name: "import_bank_statement",
    description:
      "Import a bank/card statement (CSV content) into an account: parses rows, auto-categorizes via active bank rules, and records each transaction as unmatched. CONSEQUENTIAL — routes the governance gate for owner approval. Returns the imported count, a batch id, and per-row parse errors so gaps are surfaced, never guessed. Amounts come from the statement, not inferred.",
    inputSchema: {
      type: "object",
      properties: {
        bankAccountId: { type: "string", description: "BankAccount database id to import into" },
        csvContent: { type: "string", description: "Raw CSV content of the statement export" },
      },
      required: ["bankAccountId", "csvContent"],
    },
    requiredCapability: "manage_finance",
    sideEffect: true,
    // Money-of-record: imported transactions become the ledger with no governed
    // rollback tool, and it is alignment-gated for owner approval.
    consequence: "irreversible",
  },
  {
    name: "match_transaction",
    description:
      "Reconcile one bank transaction against one inbound payment (from suggest_transaction_matches): marks the transaction matched and the payment reconciled. Reversible with unmatch_transaction.",
    inputSchema: {
      type: "object",
      properties: {
        transactionId: { type: "string", description: "BankTransaction database id" },
        paymentId: { type: "string", description: "Payment database id to reconcile against" },
      },
      required: ["transactionId", "paymentId"],
    },
    requiredCapability: "manage_finance",
    sideEffect: true,
  },
  {
    name: "unmatch_transaction",
    description:
      "Undo a reconciliation: mark a bank transaction unmatched and un-reconcile its payment. Use to correct a wrong match.",
    inputSchema: {
      type: "object",
      properties: { transactionId: { type: "string", description: "BankTransaction database id" } },
      required: ["transactionId"],
    },
    requiredCapability: "manage_finance",
    sideEffect: true,
  },
  {
    name: "create_bank_rule",
    description:
      "Create an auto-categorization rule: when an imported transaction's payee/description/reference matches (contains|exact|starts_with) a value, apply an account code, category, and/or tax rate. Use to teach the books to categorize recurring vendors automatically.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Rule name" },
        matchField: { type: "string", enum: ["payee", "description", "reference"], description: "Field to match on" },
        matchType: { type: "string", enum: ["contains", "exact", "starts_with"], description: "Match type (default contains)" },
        matchValue: { type: "string", description: "Value to match" },
        accountCode: { type: "string", description: "Account/ledger code to assign" },
        category: { type: "string", description: "Category to assign" },
        taxRate: { type: "number", description: "Tax rate 0–100 to assign" },
        description: { type: "string", description: "Optional rule note" },
      },
      required: ["name", "matchField", "matchValue"],
    },
    requiredCapability: "manage_finance",
    sideEffect: true,
  },
  {
    name: "delete_bank_rule",
    description: "Delete an auto-categorization bank rule by its database id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "BankRule database id" } },
      required: ["id"],
    },
    requiredCapability: "manage_finance",
    sideEffect: true,
  },
];

// ─── Read handlers ────────────────────────────────────────────────────────────

async function listBankAccountsHandler(): Promise<ToolResult> {
  const { listBankAccounts } = await import("@/lib/actions/banking");
  const accounts = await listBankAccounts();
  return { success: true, message: `${accounts.length} bank account(s).`, data: { accounts } };
}

async function getBankAccountHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { getBankAccount } = await import("@/lib/actions/banking");
  const account = await getBankAccount(String(params["id"] ?? ""));
  if (!account) {
    return { success: false, error: "not-found", message: "No bank account with that id." };
  }
  return { success: true, message: `Bank account ${account.name}.`, data: { account } };
}

async function getBankTransactionsHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { getTransactions } = await import("@/lib/actions/banking");
  const matchStatus = typeof params["matchStatus"] === "string" ? params["matchStatus"] : undefined;
  const txns = await getTransactions(String(params["bankAccountId"] ?? ""), matchStatus ? { matchStatus } : undefined);
  return { success: true, message: `${txns.length} transaction(s).`, data: { transactions: txns } };
}

async function suggestMatchesHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { suggestMatches } = await import("@/lib/actions/banking");
  try {
    const candidates = await suggestMatches(String(params["transactionId"] ?? ""));
    return { success: true, message: `${candidates.length} candidate match(es).`, data: { candidates } };
  } catch (err) {
    return { success: false, error: "suggest-failed", message: (err as Error).message };
  }
}

async function listBankRulesHandler(): Promise<ToolResult> {
  const { listBankRules } = await import("@/lib/actions/banking");
  const rules = await listBankRules();
  return { success: true, message: `${rules.length} bank rule(s).`, data: { rules } };
}

async function getReconciliationSummaryHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { getReconciliationSummary } = await import("@/lib/actions/banking");
  const summary = await getReconciliationSummary(String(params["bankAccountId"] ?? ""));
  return {
    success: true,
    message: `${summary.unmatchedCount} of ${summary.totalCount} transaction(s) unmatched.`,
    data: { summary },
  };
}

// ─── Write handlers ───────────────────────────────────────────────────────────

async function createBankAccountHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const parsed = createBankAccountSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: "invalid-input", message: parsed.error.issues[0]?.message ?? "Invalid account input." };
  }
  const { createBankAccount } = await import("@/lib/actions/banking");
  const account = await createBankAccount(parsed.data);
  return { success: true, entityId: account.bankAccountId, message: `Created bank account ${account.name}.`, data: { account } };
}

async function importBankStatementHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const bankAccountId = String(params["bankAccountId"] ?? "");
  const csvContent = typeof params["csvContent"] === "string" ? params["csvContent"] : "";
  if (!bankAccountId || !csvContent) {
    return { success: false, error: "invalid-input", message: "bankAccountId and csvContent are required." };
  }
  const { importTransactions } = await import("@/lib/actions/banking");
  const result = await importTransactions(bankAccountId, csvContent);
  return {
    success: true,
    message:
      `Imported ${result.imported} transaction(s), batch ${result.batchId}` +
      (result.errors.length ? `; ${result.errors.length} row(s) could not be parsed (surfaced, not guessed).` : "."),
    data: { imported: result.imported, batchId: result.batchId, errors: result.errors },
  };
}

async function matchTransactionHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const parsed = matchTransactionSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: "invalid-input", message: parsed.error.issues[0]?.message ?? "Invalid match input." };
  }
  const { matchTransaction } = await import("@/lib/actions/banking");
  await matchTransaction(parsed.data.transactionId, parsed.data.paymentId);
  return { success: true, message: "Transaction reconciled against the payment." };
}

async function unmatchTransactionHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { unmatchTransaction } = await import("@/lib/actions/banking");
  await unmatchTransaction(String(params["transactionId"] ?? ""));
  return { success: true, message: "Transaction un-reconciled." };
}

async function createBankRuleHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const parsed = createBankRuleSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: "invalid-input", message: parsed.error.issues[0]?.message ?? "Invalid rule input." };
  }
  const { createBankRule } = await import("@/lib/actions/banking");
  const rule = await createBankRule(parsed.data);
  return { success: true, entityId: rule.id, message: `Created bank rule ${rule.name}.`, data: { rule } };
}

async function deleteBankRuleHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { deleteBankRule } = await import("@/lib/actions/banking");
  await deleteBankRule(String(params["id"] ?? ""));
  return { success: true, message: "Bank rule deleted." };
}

export const bankingPack: ToolPack = {
  packId: "banking",
  definitions,
  handlers: {
    list_bank_accounts: () => listBankAccountsHandler(),
    get_bank_account: (params) => getBankAccountHandler(params),
    get_bank_transactions: (params) => getBankTransactionsHandler(params),
    suggest_transaction_matches: (params) => suggestMatchesHandler(params),
    list_bank_rules: () => listBankRulesHandler(),
    get_reconciliation_summary: (params) => getReconciliationSummaryHandler(params),
    create_bank_account: (params) => createBankAccountHandler(params),
    import_bank_statement: (params) => importBankStatementHandler(params),
    match_transaction: (params) => matchTransactionHandler(params),
    unmatch_transaction: (params) => unmatchTransactionHandler(params),
    create_bank_rule: (params) => createBankRuleHandler(params),
    delete_bank_rule: (params) => deleteBankRuleHandler(params),
  },
  grants: {
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
  },
};
