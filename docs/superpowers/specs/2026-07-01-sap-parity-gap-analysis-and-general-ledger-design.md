# SAP Parity Gap Analysis & General-Ledger Foundation

- **Date:** 2026-07-01
- **Status:** Phase 1 landing (General Ledger foundation) — remaining gaps filed under EP-SAP-PARITY
- **Author:** Claude (Enterprise Architect lens)
- **Epic:** EP-SAP-PARITY — "SAP functional parity — gap closure"

## 1. Purpose

The operator asked: *research what SAP does, find the gaps against DPF, and close
them.* This document is the research + gap analysis, and specifies the first gap
closed in this PR — a double-entry **General Ledger**, the foundation everything
financial in SAP posts to.

DPF is **not** trying to become SAP. SAP is a transactional system-of-record; DPF
is an AI-coworker-native business platform whose coworkers *do the work* over a
lighter estate of records. The useful question is therefore not "which of SAP's
60+ modules are missing" but **"where does DPF lack a system-of-record that its
coworkers and reports need, and which of those gaps is highest-value for DPF's SMB
/ vertical-services market."**

## 2. Research & Benchmarking (per AGENTS.md §10)

### 2.1 What SAP actually covers

SAP organises its ERP into **Lines of Business** (S/4HANA) / **modules** (ECC,
Business One). The comparators that matter:

| SAP area | Module(s) | Core capability |
| --- | --- | --- |
| Finance | **FI** (Financial Accounting) + **CO** (Controlling), Treasury, FP&A | General ledger, AP/AR sub-ledgers, asset accounting, close & consolidation, cost/profitability controlling |
| Sourcing & Procurement | **MM** | Requisition → PO → goods receipt → invoice verification (3-way match), vendor master |
| Sales / Order-to-Cash | **SD** | Quote → sales order → delivery → billing → AR, pricing |
| Manufacturing | **PP** + **QM** | BOM, routings, production/work orders, MRP, quality |
| Supply Chain / Warehouse | **WM/EWM**, IM | Multi-warehouse stock, bins, batch/serial, goods movements |
| Asset Mgmt / Maintenance | **PM/EAM** | Equipment master, maintenance/work orders, preventive schedules |
| Project System | **PS** / EPPM | WBS, milestones, project costing |
| Human Capital | **HCM** / SuccessFactors | Employee master, org, payroll, recruiting, performance |

For DPF's market the honest comparator is **SAP Business One** (SMB ERP), which
covers Financials (GL, AP/AR, journals, banking/reconciliation, fixed assets,
budgets), Sales & CRM, Purchasing, Inventory (multi-warehouse, batch/serial),
Production (multilevel BOM, production orders, MRP), and reporting.

### 2.2 The architectural anchor — SAP's Universal Journal (ACDOCA)

The single most important design lesson from modern SAP is the **Universal Journal
(table `ACDOCA`)** introduced in S/4HANA. It merges the previously separate
general-ledger, controlling, asset-accounting and material-ledger tables into **one
balanced line-item table** — a *financial single source of truth* that removes the
need to reconcile FI against CO. Every financial movement is one balanced journal
document; financial statements are *derived* from that one table, not recomputed
from scattered sub-ledgers.

This maps precisely onto DPF's own **single-source-of-truth** kernel principle, and
it is the pattern this PR adopts for the DPF ledger.

**Patterns adopted:** one balanced line-item journal as the source of truth;
rich analytical dimensions carried *on the line* (customer, contact) rather than in
parallel tables; sub-ledgers post *into* the journal.
**Patterns rejected:** SAP's separate physical totals tables (we derive the trial
balance on read — the dataset is SMB-sized, not enterprise-billions); a hard
FI/CO split (DPF has no separate controlling ledger to reconcile).
**Anti-pattern avoided:** letting sub-ledger documents (invoices, bills, payments)
be the *only* financial record — which is exactly DPF's pre-this-PR state.

## 3. DPF current-state audit (grounded in the schema — 438 models)

DPF is **far more built-out than a "we have no ERP" framing suggests.** Per-domain:

| SAP area | DPF today | Maturity |
| --- | --- | --- |
| Financials | `Invoice`, `Payment`, `Bill`, `BillApproval`, `ExpenseClaim`, `BankAccount`/`BankTransaction`/`BankRule`, `RecurringLineItem`, `DunningLog`, `ExchangeRate`, `FixedAsset`; full `/finance/*` portal + `/api/v1/finance/*`; AGT-900 finance coworker | **Production sub-ledgers, but no GL** |
| Sales / O2C | `Opportunity`, `Quote`, `SalesOrder`, `CustomerAccount`, `CustomerContact`; full CRM portal | Production |
| Procurement (MM) | `PurchaseOrder`, `Supplier`, `SupplierContract` | Partial — PO only; no goods receipt / 3-way match |
| Inventory (WM) | `InventoryEntity`, `InventoryRelationship` | Placeholder — no stock movements |
| Manufacturing (PP) | `BomDocument`/`BomComponent` (software SBOM only) | Not applicable to physical production |
| Asset / Maintenance (PM) | `FixedAsset` (finance) + `EdgeNode` fleet | Partial — no maintenance/work orders |
| HCM | `EmployeeProfile`, `Department`, `Position`, `LeaveRequest`, `TimesheetEntry` | Partial — no payroll/recruiting |
| Project System | `Epic`/`BacklogItem` (DPF's *own* delivery, not customer projects) | N/A for customers |
| Analytics | `/finance/reports/*` (aged debtors/creditors, cash-flow, P&L, VAT), report-kit | Production (report-level) |
| Compliance/GRC | 16 models, `/compliance/*`, SOC coworkers | Production (a DPF strength beyond SMB SAP) |

### 3.1 The decisive finding

DPF already has **every finance sub-ledger** (customer invoices → AR, supplier
bills → AP, payments, expenses, fixed assets) **and** a per-archetype
**`chartOfAccountsSeed`** in `@dpf/finance-templates`, and sub-ledger line items
already carry an optional **`accountCode`**. What is missing is the thing in the
*middle*: **a persisted chart of accounts and a double-entry journal the
sub-ledgers post to.** Without it, DPF's financial reports are recomputed ad hoc
from documents rather than derived from a ledger — so there is no trial balance, no
true balance sheet, and no guaranteed debits=credits integrity. This is exactly
SAP's core (FI-GL / the Universal Journal), it is the highest-value structural gap,
and it is the most tractable because the substrate to complete already exists.

## 4. Gap ranking (value × tractability)

1. **General Ledger / double-entry journal (FI-GL / ACDOCA)** — *highest value,
   most tractable.* Foundational; the substrate (`chartOfAccountsSeed`,
   `accountCode`) is already present. **→ closed in this PR (Phase 1).**
2. **Procurement 3-way match & goods receipt (MM)** — completes AP integrity; POs
   and suppliers already exist. *Filed.*
3. **Inventory stock movements (WM)** — needed for any goods-based vertical; models
   are placeholders today. *Filed.*
4. **Fixed-asset depreciation → GL posting** — asset register exists; posting
   depreciation is a natural GL consumer. *Filed.*
5. **HCM payroll / performance** — larger, lower priority for DPF's services market.
   *Filed, deferred.*
6. **Manufacturing (PP)** — out of scope for DPF's target verticals for now.
   *Noted, not filed.*

## 5. Phase 1 design — the General Ledger (this PR)

### 5.1 Data model (`packages/db/prisma/schema.prisma`)

Three org-scoped models, migration `20260701140000_add_general_ledger`:

- **`LedgerAccount`** — the persisted chart of accounts. `(organizationId, code)`
  unique; `type` ∈ {asset, liability, equity, revenue, expense}; `normalBalance`
  derived from `type` and stored for reporting; self-referential `parentId` for
  roll-up; `isControl` flags reconciliation accounts (AR/AP/bank). Instantiates the
  existing `chartOfAccountsSeed`.
- **`JournalEntry`** — a balanced posting document. `entryRef` unique; `periodKey`
  ("YYYY-MM") drives period close; `status` ∈ {draft, posted, reversed};
  `source`/`sourceType`/`sourceId` link back to the originating sub-ledger document;
  `reversalOfId` supports correcting a posted entry by reversal (posted entries are
  immutable); `erpSyncStatus`/`erpRefId` mirror the sub-ledger ERP-sync convention.
- **`JournalLine`** — one debit-or-credit line against a `LedgerAccount`, carrying
  ACDOCA-style analytical dimensions (`customerAccountId`, `contactId`) on the line.

### 5.2 Posting invariants (`apps/web/lib/finance/ledger.ts`)

The accounting rules live as **pure, unit-tested functions** (no DB import) so the
API layer and any coworker that proposes a posting share one enforcement point:

- `normalBalanceForType` — asset/expense ⇒ debit; liability/equity/revenue ⇒ credit.
- `validateJournalEntry` — ≥2 lines, non-negative finite amounts, each line
  single-sided, **Σdebits = Σcredits** compared in integer minor units (no float
  drift), returning every violation at once.
- `computeTrialBalance` — aggregates posted lines per account, orients each net
  balance to its normal side, and reports whether the whole ledger balances.
- `buildInvoicePostingLines` — the first sub-ledger→GL seam: Dr AR (gross) / Cr
  Revenue (net) / Cr Tax Payable (tax), balanced by construction.
- `periodKeyOf` — the "YYYY-MM" bucket the existing period-close workflow uses.

19 unit tests cover balanced/unbalanced/single-sided/negative/zero/missing-account
cases, float tolerance, invoice posting (with and without tax), trial-balance
orientation, and out-of-set line handling.

### 5.3 Framing — management ledger, not a forced book-of-record

Consistent with the `chartOfAccountsSeed` comment ("seeds for the management view;
the org's core/accounting system stays authoritative"), the DPF GL is positioned as
the **management single-source-of-truth**: sub-ledgers post to it for a real
internal trial balance, and it reconciles/syncs to an external accounting/ERP system
(QuickBooks/Xero/SAP) via `erpSyncStatus`/`erpRefId` where one remains authoritative.

### 5.4 Out of scope for Phase 1 (follow-up BIs under EP-SAP-PARITY)

- Auto-posting hooks that create a `JournalEntry` when an Invoice/Bill/Payment is
  finalised (Phase 1 provides the pure builder + persistence-ready models).
- Portal UI: chart-of-accounts admin, journal browser, trial-balance / balance-sheet
  reports composed from report-kit.
- COA seeding on org setup from `@dpf/finance-templates.chartOfAccountsSeed`.
- Fixed-asset depreciation and payment-clearing posting builders.

## 6. Verification

- `prisma validate` — schema valid.
- Migration generated from schema diff (`prisma migrate diff`), apply-ready; final
  `migrate deploy` runs against the canonical install / shared local-CI sandbox per
  AGENTS.md §5 (worktree is source-only).
- `vitest run lib/finance/ledger.test.ts` — **19/19 pass**.
- Standalone strict `tsc --noEmit` on `ledger.ts` — clean.

## 7. Design north star — more integrated & simpler than SAP (operator direction, 2026-07-01)

DPF is **not** trying to replicate SAP's module list. SAP's defining weakness for an
SMB is that it is a **patchwork of separately-acquired products** (Ariba for
procurement, Concur for expense, SuccessFactors for HCM, …) bolted onto a
config-heavy core: many tools, many data models, constant sub-ledger↔GL
reconciliation, painful account-determination setup (OBYC and friends), and limited
flexibility. DPF's edge is the opposite:

1. **One data spine.** A single ledger (the ACDOCA lesson) and a single identity
   (`Organization`) that every module posts to — not N acquired databases stitched
   together.
2. **The AI coworker absorbs the complexity.** The SMB owner does normal business
   actions (send an invoice, pay a bill); the ledger is a *byproduct*, posted and
   determined automatically. No transaction codes, no account-determination config.
3. **Flexibility by archetype.** The same spine reshapes to trades, healthcare,
   municipal fund-accounting, cooperatives — via `@dpf/finance-templates`, not via a
   consultant re-implementing modules.

This scales up (larger, more complex orgs) by *deepening the same spine*, never by
acquiring and bolting on another tool. **Target: small/mid-sized complexity now,
architected to grow — with integration and simplicity as the moat.**

## 8. Phase 2 — the automatic, integrated ledger (this PR, stacked on Phase 1 #2546)

Phase 2 makes the Phase-1 ledger *automatic and invisible*, delivering point (2) above.

### 8.1 Automatic chart of accounts + account determination (`chart-of-accounts.ts`, pure)

- **`BASE_CONTROL_ACCOUNTS`** — the balance-sheet control spine (bank, AR, AP, sales
  tax, retained earnings, opening-balance equity, a default sales account) every org
  gets regardless of archetype. This is the piece the archetype `chartOfAccountsSeed`
  omits (seeds carry only revenue/expense) and the piece SAP makes you configure.
- **`buildOrgChartOfAccounts(profile)`** — merges the base spine with the archetype's
  own accounts into the full chart to seed. Where an archetype defines a base code
  with a domain meaning (a municipality's "General Fund Cash" at 1000), the archetype
  **wins on name/type but inherits the base account's posting role** — so domain
  flexibility and automatic determination coexist.
- **`resolvePostingAccounts(accounts)`** — *account determination*: resolves each
  posting **role** (receivables, salesRevenue, taxPayable, bank, …) to a concrete
  account by explicit role tag first, then a documented per-role heuristic. Roles it
  cannot resolve are **reported, never guessed**, so the books can't silently
  misstate — the finance coworker can surface exactly what setup is missing.

Posting builders ask for a *role*, never a code, so one builder works across every
archetype and ledger model.

### 8.2 Persistence + auto-posting (`ledger-service.ts`, Prisma) and its wiring

- **`seedChartOfAccounts(orgId)`** — idempotently upserts the org's chart of accounts
  from its applied profile. **Wired into `applyFinancialProfile`** (setup): applying a
  financial profile now materialises a ready-to-post chart of accounts.
- **`postInvoiceIssued(invoiceId)`** — posts an issued invoice (Dr AR / Cr Revenue /
  Cr Tax) with automatic determination; idempotent (one journal per source document).
  **Wired into `sendInvoice`** (the finalise seam every send path converges on), as a
  **best-effort** call — a ledger hiccup never blocks sending the customer their
  invoice, and the idempotent post retries cleanly.

End-to-end result: *set up a profile → the chart of accounts exists; send an invoice →
it is in the ledger* — with no journal-entry knowledge required of the user.

### 8.3 Verification (Phase 2)

- `vitest run lib/finance/ledger.test.ts lib/finance/chart-of-accounts.test.ts` —
  **30/30 pass**.
- Standalone strict `tsc --noEmit` on the pure modules (`ledger.ts`,
  `chart-of-accounts.ts`) — clean.
- The Prisma-typed service/wiring (`ledger-service.ts` and the two hooks) is written
  field-exact to the schema; its typecheck + runtime are gated by CI and the shared
  local-CI sandbox per AGENTS.md §5 (this worktree is source-only, no generated
  client). Non-fatal wiring keeps invoice send resilient if the client is stale.

## 9. Phase 3 — cash-cycle settlement (payment auto-posting, stacked on #2548)

Phase 2 posts the *obligation* (invoice → Dr AR / Cr Revenue). Phase 3 closes the
loop by posting the *settlement*, so a payment lands on the same ledger rather than
in a parallel record:

- **`buildPaymentPostingLines` (`ledger.ts`, pure, tested)** — direction-aware and
  balanced by construction:
  - `inbound` (customer receipt): **Dr Bank / Cr Accounts Receivable**
  - `outbound` (supplier payment): **Dr Accounts Payable / Cr Bank**
  Throws if the control account the direction needs (receivables for inbound,
  payables for outbound) was not resolved — a payment never posts to the wrong side.
- **`postPaymentRecorded` (`ledger-service.ts`, Prisma)** — resolves bank/AR/AP via
  the same `resolvePostingAccounts` determination (all three are in
  `BASE_CONTROL_ACCOUNTS`, so **no new accounts or roles are needed**), pulls the
  customer/contact dimension from the payment's linked invoice, and posts an
  idempotent `source: payment` journal. **Wired into `recordPayment`** as a
  best-effort call (a ledger hiccup never fails recording the payment).

Result: **invoice → AR posted; payment → AR cleared to Bank** — the receivable side
of the cash cycle now lives entirely on one ledger, with the payable side (bills →
AP, supplier payment → AP cleared) following the same builder shape next.

Verification: `vitest run lib/finance/ledger.test.ts` — **23/23 pass** (4 new payment
cases: inbound, outbound, unresolved-control guard, non-negative). Standalone strict
`tsc` on `ledger.ts` clean. Prisma service/wiring is field-exact; typecheck + runtime
gated by CI / the shared local-CI sandbox per §5.

## 10. Phase 4 — supplier-bill posting (AP recognition, off main)

Phase 2 recognised revenue+AR (invoice), Phase 3 settled it (payment). Phase 4 closes
the **payable** side so procurement rides the same ledger:

- **`buildBillPostingLines` (`ledger.ts`, pure, tested)** — Dr Expense (net) [+ Dr Input
  Tax (tax)] / Cr Accounts Payable (gross). Balances by construction; when no input-tax
  account is resolved the tax folds into the expense (tax-inclusive cost) — the common
  non-VAT SMB case.
- **Chart-of-accounts extension (`chart-of-accounts.ts`)** — two new roles/base accounts:
  `operatingExpense` (5000, the default expense supplier bills post to; archetype seeds
  override 5000 and inherit the role) and `inputTaxRecoverable` (1200, an asset —
  recoverable input VAT/GST, distinct from 2200 output tax payable). Determination stays
  automatic; unresolved roles are reported, never guessed.
- **`postBillFinalized` (`ledger-service.ts`)** — idempotent `source: bill` journal,
  **wired into `ap.ts`** at both `"approved"` transitions (`submitBillForApproval` when no
  approval rule matches, and `respondToBillApproval` when all approvals are collected),
  best-effort so a ledger hiccup never fails approving the bill.

Result: **all three core sub-ledgers now post to one ledger** — invoice→AR, payment→
settlement, bill→AP — so the trial balance (next) reflects a complete book.

Verification: `vitest run lib/finance/ledger.test.ts lib/finance/chart-of-accounts.test.ts`
— **38/38 pass** (3 new bill cases + 1 determination case). Standalone strict `tsc` on the
pure modules clean. Prisma service/wiring field-exact; CI/sandbox-gated per §5.

## 11. Phase 5 — the General Ledger report (see the books, off main)

Phases 1–4 write to the ledger; Phase 5 lets the owner **read** it. The books are
*derived* from the one journal, never recomputed ad hoc from documents:

- **`deriveFinancialStatements(trialBalance)` (`ledger.ts`, pure, tested)** — rolls the
  trial balance up by account class into an **income statement** (revenue − expenses =
  net income) and a **balance sheet** (assets / liabilities / equity). Because the trial
  balance balances, the accounting equation Assets = Liabilities + Equity + net income
  holds; `balanced` re-checks it in integer minor units.
- **`getGeneralLedgerReport(periodKey?)` (`ledger-service.ts`)** — the read model:
  aggregates posted `JournalLine`s (optionally scoped to a `YYYY-MM` period) through the
  pure `computeTrialBalance` + `deriveFinancialStatements`, returning the trial balance,
  both statements, currency, and an `isEmpty` empty-state signal.
- **`/finance/reports/general-ledger` page** — a themed, read-only report: six KPI tiles
  (revenue/expenses/net income; assets/liabilities/equity) via report-kit `StatCard`, a
  trial-balance table matching the existing finance-report pages, a "books balance ✓"
  indicator, and an empty state that points the owner at the actions that populate it.
  Added to the reports index for discovery.

**UX-Fit decision (progressive disclosure):** the default view is six plain-language
headline numbers a layman reads at a glance; the trial-balance detail sits below for
those who want it. Everything is *derived* — the only optional input is a period. No
token-count-style control a non-technical user can't answer. Scored on
`human_cognitive_load`; attested with a `UX-Fit-Decision` trailer.

Verification: `vitest run lib/finance/ledger.test.ts` — **29/29 pass** (3 new statement
cases: balanced book, net loss, empty ledger). Standalone strict `tsc` on `ledger.ts`
clean. The Prisma read service + the server-component page are field-exact and
CI/sandbox-gated per §5 (a worktree cannot host the Next runtime); the pure derivation
they call is fully proven. Report-kit `DataTable` was intentionally not used for the trial
balance — it is a client component and all seven sibling finance reports hand-roll a
themed table; converging finance reports onto report-kit is a separate follow-up.

## 12. Phase 6 — fixed-asset depreciation → GL (FI-AA, off main)

The asset register (`FixedAsset`) and a monthly-depreciation run (`runMonthlyDepreciation`)
already existed but posted nowhere. Phase 6 makes the period's depreciation land on the
ledger, closing the FI-AA gap:

- **Pure primitives (`ledger.ts`, tested):** `computeMonthlyDepreciation` (straight-line
  and double-declining, capped so an asset never depreciates below its residual) and
  `buildDepreciationPostingLines` (**Dr Depreciation Expense / Cr Accumulated Depreciation**,
  balanced by construction).
- **Contra-asset done right:** `Accumulated Depreciation` (1900) is seeded as an **asset**
  account that carries a *credit* balance, so its oriented balance is negative and correctly
  reduces total assets to **net book value** in the Phase-5 balance-sheet rollup — no new
  account *class* needed. Roles `depreciationExpense` (5900) + `accumulatedDepreciation` join
  the automatic determination set.
- **`postDepreciationJournal(periodKey, total)` (`ledger-service.ts`):** posts one balanced,
  idempotent-per-period journal for the period's total charge. It records only the ledger
  side — asset book-value updates stay with `runMonthlyDepreciation`, so there is no double
  update and the existing depreciation formula (kept consistent with the `calculateDepreciation`
  schedule preview) is unchanged.
- **Wiring:** `runMonthlyDepreciation` accumulates the period's charge and calls
  `postDepreciationJournal` best-effort (a ledger hiccup never fails the asset run; idempotent
  so a retry is safe).

Verification: `vitest run lib/finance/ledger.test.ts lib/finance/chart-of-accounts.test.ts` —
**46/46 pass** (new: straight-line/reducing-balance/residual-cap/zero-life depreciation +
balanced posting). Standalone strict `tsc` on the pure modules clean. The Prisma service +
`assets.ts` wiring are field-exact and CI/sandbox-gated per §5. Follow-up: converge
`calculateDepreciation` / `runMonthlyDepreciation` / `computeMonthlyDepreciation` onto one
formula (they compute depreciation three ways today; unifying touches tested behaviour, so
it is deferred).

## 13. Roadmap

Phases 1–6 land the ledger, make it automatic, post all three core sub-ledgers **plus
fixed-asset depreciation** to it, and surface the derived books. Remaining ranked gaps (§4) —
procurement 3-way match (MM), inventory movements (WM), HCM payroll — are filed under
**EP-SAP-PARITY** and delivered by deepening this one spine, not by bolting on separate tools.
