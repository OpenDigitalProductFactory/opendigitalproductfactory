import { beforeEach, describe, expect, it, vi } from "vitest";

const banking = vi.hoisted(() => ({
  listBankAccounts: vi.fn(),
  getBankAccount: vi.fn(),
  getTransactions: vi.fn(),
  suggestMatches: vi.fn(),
  listBankRules: vi.fn(),
  getReconciliationSummary: vi.fn(),
  createBankAccount: vi.fn(),
  importTransactions: vi.fn(),
  matchTransaction: vi.fn(),
  unmatchTransaction: vi.fn(),
  createBankRule: vi.fn(),
  deleteBankRule: vi.fn(),
}));
vi.mock("@/lib/actions/banking", () => banking);

import { bankingPack } from "./banking-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES } from "@/lib/tak/consequential-tool-policy";

const READ_TOOLS = [
  "list_bank_accounts",
  "get_bank_account",
  "get_bank_transactions",
  "suggest_transaction_matches",
  "list_bank_rules",
  "get_reconciliation_summary",
];
const WRITE_TOOLS = [
  "create_bank_account",
  "import_bank_statement",
  "match_transaction",
  "unmatch_transaction",
  "create_bank_rule",
  "delete_bank_rule",
];
const ALL_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];

beforeEach(() => vi.clearAllMocks());

describe("banking pack — registration", () => {
  it("exposes exactly the 12 books-loop tools with matching handlers and grants", () => {
    expect(bankingPack.packId).toBe("banking");
    expect(bankingPack.definitions.map((d) => d.name).sort()).toEqual([...ALL_TOOLS].sort());
    expect(Object.keys(bankingPack.handlers).sort()).toEqual([...ALL_TOOLS].sort());
    expect(Object.keys(bankingPack.grants).sort()).toEqual([...ALL_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of bankingPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("reads are side-effect-free with banking_read; writes are side-effecting with banking_write", () => {
    for (const d of bankingPack.definitions) {
      if (READ_TOOLS.includes(d.name)) {
        expect(d.sideEffect, d.name).toBeFalsy();
        expect(bankingPack.grants[d.name]).toEqual(["banking_read"]);
      } else {
        expect(d.sideEffect, d.name).toBe(true);
        expect(bankingPack.grants[d.name]).toEqual(["banking_write"]);
      }
      expect(d.requiredCapability).toBe("manage_finance");
    }
  });

  it("banking_read authorizes reads but NOT writes; banking_write authorizes writes", () => {
    expect(isToolAllowedByGrants("list_bank_accounts", ["banking_read"])).toBe(true);
    expect(isToolAllowedByGrants("import_bank_statement", ["banking_read"])).toBe(false);
    expect(isToolAllowedByGrants("import_bank_statement", ["banking_write"])).toBe(true);
  });

  it("routes only the money-of-record writes through the governance gate", () => {
    const consequential = new Set<string>(ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES);
    expect(consequential.has("create_bank_account")).toBe(true);
    expect(consequential.has("import_bank_statement")).toBe(true);
    // categorization/matching stay off the gate (ordinary, reversible)
    expect(consequential.has("match_transaction")).toBe(false);
    expect(consequential.has("create_bank_rule")).toBe(false);
  });

  it("declares consequence only on the money-of-record writes (coverage + receipt)", () => {
    const byName = Object.fromEntries(bankingPack.definitions.map((d) => [d.name, d]));
    expect(byName["create_bank_account"].consequence).toBe("irreversible");
    expect(byName["import_bank_statement"].consequence).toBe("irreversible");
    for (const name of [...READ_TOOLS, "match_transaction", "unmatch_transaction", "create_bank_rule", "delete_bank_rule"]) {
      expect(byName[name].consequence, name).toBeUndefined();
    }
  });
});

describe("banking pack — handlers", () => {
  it("list_bank_accounts returns the accounts", async () => {
    banking.listBankAccounts.mockResolvedValue([{ id: "a", name: "Ops" }]);
    const r = await bankingPack.handlers.list_bank_accounts({}, "u");
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ accounts: [{ id: "a", name: "Ops" }] });
  });

  it("import_bank_statement surfaces per-row parse errors (never guesses)", async () => {
    banking.importTransactions.mockResolvedValue({
      imported: 3,
      batchId: "b1",
      errors: [{ row: 4, message: "unparseable amount" }],
    });
    const r = await bankingPack.handlers.import_bank_statement(
      { bankAccountId: "acc1", csvContent: "date,amount\n..." },
      "u",
    );
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ imported: 3, batchId: "b1", errors: [{ row: 4, message: "unparseable amount" }] });
    expect(r.message).toContain("surfaced, not guessed");
    expect(banking.importTransactions).toHaveBeenCalledWith("acc1", "date,amount\n...");
  });

  it("import_bank_statement rejects a missing account/content without calling the action", async () => {
    const r = await bankingPack.handlers.import_bank_statement({ bankAccountId: "acc1" }, "u");
    expect(r.success).toBe(false);
    expect(r.error).toBe("invalid-input");
    expect(banking.importTransactions).not.toHaveBeenCalled();
  });

  it("create_bank_account validates input and returns the new account id", async () => {
    banking.createBankAccount.mockResolvedValue({ bankAccountId: "BA-xyz", name: "Card" });
    const ok = await bankingPack.handlers.create_bank_account({ name: "Card", currency: "USD" }, "u");
    expect(ok).toMatchObject({ success: true, entityId: "BA-xyz" });
    // missing required name → validation error, action not called
    banking.createBankAccount.mockClear();
    const bad = await bankingPack.handlers.create_bank_account({ currency: "USD" }, "u");
    expect(bad.success).toBe(false);
    expect(banking.createBankAccount).not.toHaveBeenCalled();
  });

  it("get_bank_account reports not-found cleanly", async () => {
    banking.getBankAccount.mockResolvedValue(null);
    const r = await bankingPack.handlers.get_bank_account({ id: "nope" }, "u");
    expect(r.success).toBe(false);
    expect(r.error).toBe("not-found");
  });
});
