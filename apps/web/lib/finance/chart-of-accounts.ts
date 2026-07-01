// lib/finance/chart-of-accounts.ts — automatic chart of accounts + account determination (AGT-900)
//
// The integration primitive that lets DPF's ledger be *automatic* rather than
// configured. In SAP an SMB must hand-crank account determination (OBYC and
// friends) so the system knows which GL account each transaction posts to. DPF
// ships that determination out of the box: every org gets a balance-sheet control
// spine (BASE_CONTROL_ACCOUNTS), merged with the archetype's own revenue/expense
// accounts (chartOfAccountsSeed from @dpf/finance-templates), and each posting
// resolves its accounts by *semantic role* — never a code the user had to wire.
//
// Pure and DB-free so the whole determination is unit-testable; the persistence
// and posting wrappers live in apps/web/lib/finance/ledger-service.ts, and the
// balancing invariants in apps/web/lib/finance/ledger.ts.

import { normalBalanceForType, type LedgerAccountType, type NormalBalance } from "./ledger";

// ─── Posting roles — the semantic targets sub-ledgers post to ────────────────
//
// A role is *what* an account is used for, independent of the code an archetype
// happens to give it. Posting builders ask for a role ("receivables"), never a
// code, so the same builder works across every archetype and ledger model.

export const POSTING_ACCOUNT_ROLES = [
  "bank", // cash / bank settlement
  "receivables", // trade debtors (AR control)
  "payables", // trade creditors (AP control)
  "taxPayable", // output sales tax / VAT owed
  "salesRevenue", // default sales/income account
  "retainedEarnings", // accumulated result
  "openingBalanceEquity", // opening-balance counterweight
] as const;
export type PostingAccountRole = (typeof POSTING_ACCOUNT_ROLES)[number];

// ─── Account shapes ──────────────────────────────────────────────────────────

/** A chart-of-accounts entry before persistence (from a seed or the base spine). */
export type ChartAccountSeed = {
  code: string;
  name: string;
  type: LedgerAccountType;
  /** The posting role this account fills, if it is a control/determination account. */
  role?: PostingAccountRole;
  /** Control/reconciliation account (AR, AP, bank, tax). */
  isControl?: boolean;
};

/** A chart-of-accounts entry with its derived normal balance, ready to seed. */
export type ResolvedChartAccount = ChartAccountSeed & { normalBalance: NormalBalance };

// ─── The base control spine — every org gets these regardless of archetype ───
//
// Codes follow the conventional SMB ranges (1xxx assets, 2xxx liabilities, 3xxx
// equity, 4xxx revenue, 5xxx expense). Where an archetype seed defines the same
// code with a domain-specific meaning (e.g. a municipality's "General Fund Cash"
// at 1000), the archetype wins and inherits the base account's role — see
// buildOrgChartOfAccounts.

export const BASE_CONTROL_ACCOUNTS: readonly ChartAccountSeed[] = [
  { code: "1000", name: "Cash at Bank", type: "asset", role: "bank", isControl: true },
  { code: "1100", name: "Accounts Receivable", type: "asset", role: "receivables", isControl: true },
  { code: "2000", name: "Accounts Payable", type: "liability", role: "payables", isControl: true },
  { code: "2200", name: "Sales Tax Payable", type: "liability", role: "taxPayable", isControl: true },
  { code: "3000", name: "Retained Earnings", type: "equity", role: "retainedEarnings" },
  { code: "3900", name: "Opening Balance Equity", type: "equity", role: "openingBalanceEquity" },
  // A generic sales account so salesRevenue always resolves; archetype seeds
  // almost always override 4000 with a domain-specific revenue line, inheriting
  // this role.
  { code: "4000", name: "Sales", type: "revenue", role: "salesRevenue" },
] as const;

// ─── Build the full org chart of accounts ────────────────────────────────────

export type ProfileWithSeed = {
  chartOfAccountsSeed: Array<{ code: string; name: string; type: LedgerAccountType }>;
};

/**
 * Merge the base control spine with an archetype financial profile's own
 * revenue/expense accounts into the complete chart of accounts to seed for an org.
 *
 * Rule: a code is defined once. When the archetype seed reuses a base code, the
 * archetype's name/type win (its domain meaning is more specific) but it inherits
 * the base account's posting role and control flag, so determination still
 * resolves. Base-only codes (the balance-sheet spine the archetype omits) are kept.
 */
export function buildOrgChartOfAccounts(profile: ProfileWithSeed): ResolvedChartAccount[] {
  const byCode = new Map<string, ChartAccountSeed>();

  for (const base of BASE_CONTROL_ACCOUNTS) {
    byCode.set(base.code, { ...base });
  }

  for (const seed of profile.chartOfAccountsSeed) {
    const existing = byCode.get(seed.code);
    byCode.set(seed.code, {
      code: seed.code,
      name: seed.name,
      type: seed.type,
      // Inherit determination metadata from a shadowed base account.
      role: existing?.role,
      isControl: existing?.isControl,
    });
  }

  return [...byCode.values()]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) => ({ ...a, normalBalance: normalBalanceForType(a.type) }));
}

// ─── Account determination — resolve roles to concrete accounts ──────────────

/** The minimal account shape determination needs (works on seeds or persisted rows). */
export type DeterminableAccount = {
  id?: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  role?: PostingAccountRole | null;
};

export type ResolvedPostingAccounts<A extends DeterminableAccount> = {
  resolved: Partial<Record<PostingAccountRole, A>>;
  unresolved: PostingAccountRole[];
};

const HEURISTICS: Record<PostingAccountRole, (a: DeterminableAccount) => boolean> = {
  bank: (a) => a.type === "asset" && (a.code === "1000" || /\b(bank|cash)\b/i.test(a.name)),
  receivables: (a) =>
    a.type === "asset" && (a.code === "1100" || /receivable|debtor/i.test(a.name)),
  payables: (a) =>
    a.type === "liability" && (a.code === "2000" || /payable|creditor/i.test(a.name)),
  taxPayable: (a) => a.type === "liability" && /\b(tax|vat|gst)\b/i.test(a.name),
  salesRevenue: (a) => a.type === "revenue",
  retainedEarnings: (a) => a.type === "equity" && /retained|undivided|fund balance/i.test(a.name),
  openingBalanceEquity: (a) => a.type === "equity" && /opening/i.test(a.name),
};

/**
 * Resolve each posting role to a concrete account. An explicit `role` tag always
 * wins; otherwise a documented per-role heuristic picks the best match (first by
 * code, then by name). Roles that cannot be resolved are returned in `unresolved`
 * so a caller (or the finance coworker) can surface exactly what setup is missing
 * — rather than a posting silently going to the wrong account.
 */
export function resolvePostingAccounts<A extends DeterminableAccount>(
  accounts: A[],
): ResolvedPostingAccounts<A> {
  const resolved: Partial<Record<PostingAccountRole, A>> = {};
  const unresolved: PostingAccountRole[] = [];

  for (const role of POSTING_ACCOUNT_ROLES) {
    const tagged = accounts.find((a) => a.role === role);
    if (tagged) {
      resolved[role] = tagged;
      continue;
    }
    const byHeuristic = accounts.find((a) => HEURISTICS[role](a));
    if (byHeuristic) {
      resolved[role] = byHeuristic;
    } else {
      unresolved.push(role);
    }
  }

  return { resolved, unresolved };
}
