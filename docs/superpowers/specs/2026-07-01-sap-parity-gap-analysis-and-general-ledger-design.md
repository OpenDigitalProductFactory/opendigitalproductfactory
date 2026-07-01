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

## 7. Roadmap

Phase 1 (this PR) lands the ledger foundation. The remaining ranked gaps (§4) are
filed as backlog items under **EP-SAP-PARITY** so SAP-parity is delivered as a
governed program, not a single PR — the honest shape for ERP-scale scope.
