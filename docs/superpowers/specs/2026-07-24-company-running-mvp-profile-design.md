# Company-running MVP profile for owner-operated SMBs

Status: proposed (scope-boundary doc; no implementation in this change)
Date: 2026-07-24
Backlog: BI-COP-002 — company-running MVP profile for owner-operated SMBs
Epic: EP-COMPANY-OPS-PARITY — Workday and QuickBooks capability roadmap

## Problem

EP-COMPANY-OPS-PARITY carries a wide roadmap of Workday/QuickBooks-parity
backlog items (BI-HCM-001, BI-WFM-001, BI-PAY-001, BI-FIN-001, BI-FIN-002,
BI-QB-001, BI-TALENT-001, BI-SPEND-001, and more), each scoped to harden one
capability area toward enterprise-suite parity. None of them individually
answers a simpler, more urgent question an owner-operator asks on day one:

> "Can I actually run my company on this today — payroll, invoices, bills,
> approvals, the bank — or do I still need three other tools?"

Without an explicit MVP boundary, two failure modes are equally likely:
1. **Overclaiming** — treating in-progress parity work (payroll GL posting,
   FGA-gated approvals, bank reconciliation) as done because the underlying
   Prisma models exist, when the acceptance-grade workflow around them does
   not.
2. **Underclaiming** — telling an owner-operator to wait for full Workday/
   QuickBooks parity before DPF is usable for daily operations, when a
   real, narrower slice already works end to end.

This doc draws that boundary from verified codebase evidence, not aspiration,
and assigns every capability area to the sibling BI that is the actual
delivery mechanism — this doc does not duplicate their scope, it sequences
and bounds it.

## Method

For each capability area covered by BI-COP-002 (people records, time/absence,
invoicing/payments, bills/expenses, bank reconciliation, QuickBooks bridge,
approvals, audit, AI coworker work cases), this doc records:
- **current evidence** — the Prisma models and workflow surfaces verified
  present in `packages/db/prisma/schema.prisma` and related packages as of
  this writing;
- **tier** — MVP (must-have to run today), next-parity (near-term roadmap),
  or enterprise-only (deliberately out of scope for this profile);
- **owning BI** — the sibling backlog item that is the delivery mechanism for
  closing the gap between current evidence and the tier's bar.

Evidence was gathered by grepping `packages/db/prisma/schema.prisma` for the
model families this doc discusses, and by reading the bodies of BI-WFM-001,
BI-PAY-001, BI-FIN-001, BI-FIN-002, BI-QB-001, BI-HCM-001, BI-TALENT-001,
BI-SPEND-001, BI-COP-001, BI-COP-005, BI-COP-006, BI-C47EA32D, and BI-ECO-004
via `get_backlog_item`. This doc does not re-verify runtime behavior (no
build/tests were run) — it is a scope-boundary document, and its "current
evidence" claims are schema/backlog-level, not functional-verification-level.
BI-COP-001 (parity scorecard) is the durable place for functional evidence
per capability; this doc should be read alongside it once that scorecard
exists.

## Three-tier capability bundle

### 1. People records — MVP: basic profile + position; next-parity: canonical worker model

**Evidence:** `EmployeeProfile` and `Position` models exist (schema.prisma
lines ~389, ~502) and are the substrate every people/payroll/finance workflow
should resolve through.

| Tier | Scope | Owning BI |
| --- | --- | --- |
| MVP | Single canonical employee record: name, contact, position, employment status, start/end dates. Enough for a 5-50 person company to know who works there and what role they hold. | Existing `EmployeeProfile`/`Position` substrate (no new BI needed for read/list) |
| Next-parity | Canonical worker/employment/job/position model with reporting lines, locations, cost centers, lifecycle dates, and no duplicate employee concepts across payroll/finance/workforce. | **BI-HCM-001** |
| Enterprise-only | Full org-design modeling (headcount planning, matrixed reporting, multi-entity global mobility), succession planning, compensation bands tied to job architecture. | Out of scope for this profile — Workday HCM territory |

### 2. Time / absence — MVP: timesheet capture; next-parity: full approval workflow

**Evidence:** `TimesheetPeriod`, `TimesheetEntry`, `BillableRate` models exist
(schema.prisma ~7984-8035).

| Tier | Scope | Owning BI |
| --- | --- | --- |
| MVP | Employee logs hours against a period; manager can see submitted entries. Enough to produce payroll inputs and billable-hours invoicing for a small team. | Existing `TimesheetPeriod`/`TimesheetEntry` substrate |
| Next-parity | Clock events where appropriate, manager approval workflow, corrections, exceptions, audit history, and a defined handoff to payroll inputs, labor costing, and invoice drafting. | **BI-WFM-001** |
| Enterprise-only | Shift-based scheduling optimization, labor-law compliance engines per jurisdiction, multi-country absence policy libraries. | Deferred to workforce staffing/solver work outside this profile — see BI-WFM-003/004 |

### 3. Invoicing / payments — MVP: draft-to-paid lifecycle; next-parity: dunning + provider reconciliation

**Evidence:** `Invoice`, `InvoiceLineItem`, `Payment`, `PaymentAllocation`,
`RecurringSchedule`, `DunningLog` models exist (schema.prisma ~10381-10504,
~10929+). Invoice already carries `erpSyncStatus`/`erpRefId` fields — the
QuickBooks-bridge hook point already exists on the model, even though the
sync implementation is a separate concern (see §6).

| Tier | Scope | Owning BI |
| --- | --- | --- |
| MVP | Create invoice, send it, record payment, track paid/amountDue. This is a real, usable AR loop today — the models and fields for it exist and are structurally complete. | Existing `Invoice`/`Payment`/`PaymentAllocation` substrate |
| Next-parity | Recurring billing (`RecurringSchedule` already modeled) hardened end to end, dunning automation (`DunningLog` already modeled) driven by policy rather than ad hoc, e-signature-gated collection flows. | **BI-FIN-001** (ledger invariants for every posting source, including invoice/payment) |
| Enterprise-only | Multi-entity intercompany invoicing, complex revenue-recognition schedules (ASC 606 waterfalls), credit-risk scoring and automated dunning escalation to collections agencies. | Out of scope — QuickBooks Advanced / NetSuite territory |

### 4. Bills / expenses — MVP: bill capture + approval; next-parity: policy-driven AP

**Evidence:** `Bill`, `BillLineItem`, `ApprovalRule`, `BillApproval`,
`ExpenseClaim`, `ExpenseItem` models exist (schema.prisma ~10713-10823,
~11020-11046). `ApprovalRule` already models amount-banded approver
assignment; `BillApproval` already models a token-based approve/decline flow.

| Tier | Scope | Owning BI |
| --- | --- | --- |
| MVP | Record a bill or expense claim, route it through the existing `ApprovalRule`/`BillApproval` amount-band flow, mark paid. A real AP loop for a company with one or two approvers. | Existing `Bill`/`ExpenseClaim`/`ApprovalRule` substrate |
| Next-parity | Approval authority resolved through a real relationship-based authorization engine (owner/manager/approver scoped by org hierarchy) instead of a single flat `approverId`; supplier-side onboarding and compliance posture attached to every bill. | **BI-C47EA32D** (FGA engine) + **BI-SPEND-001** (supplier profile) |
| Enterprise-only | Multi-level PO-matched three-way approval, procurement contract lifecycle management, spend-category budget enforcement across cost centers. | Out of scope — Workday Financials / Coupa territory |

### 5. Bank reconciliation — MVP: transaction import + manual match; next-parity: suggested matching workflow

**Evidence:** `BankAccount`, `BankTransaction`, `BankRule` models exist
(schema.prisma ~10865-10925). `BankTransaction.matchStatus` and
`matchedPaymentId` already model the match state; `BankRule` already models
auto-categorization by field/value.

| Tier | Scope | Owning BI |
| --- | --- | --- |
| MVP | Import bank transactions, manually match against payments, mark reconciled. `BankAccount.lastReconciledAt`/`currentBalance` already track reconciliation state at the account level. | Existing `BankAccount`/`BankTransaction`/`BankRule` substrate |
| Next-parity | Suggested matches, unmatched queues, human approval UX, reconciliation audit receipts, rollback/replay for failed imports — the full workflow around the existing match-state fields. | **BI-FIN-002** |
| Enterprise-only | Multi-currency treasury cash-positioning, automated bank-feed reconciliation across dozens of accounts/entities, fraud-pattern detection on transaction streams. | Out of scope — enterprise treasury management territory |

### 6. QuickBooks bridge — MVP: none functional yet; next-parity: OAuth connect + import staging

**Evidence:** No QuickBooks-specific Prisma model exists. What exists is the
*generic* integration substrate QuickBooks (and other providers — ADP,
Plaid, Workday) are meant to ride on: `IntegrationCredential`,
`IntegrationToolCallLog`, `IntegrationCallbackReceipt`,
`IntegrationImportBatch`, `IntegrationImportStagedRecord` (schema.prisma
~1870-2030). `Invoice`/`Payment`/`Bill` all carry `erpSyncStatus`/`erpRefId`
fields as the sync hook point, but the QuickBooks-specific connect/sync
implementation is not yet in the schema layer.

| Tier | Scope | Owning BI |
| --- | --- | --- |
| MVP | **None today.** This is the honest gap: an owner-operator cannot yet connect QuickBooks and see staged/reviewable data. Calling QuickBooks bridge "MVP-ready" would be overclaiming — flag this explicitly rather than paper over it. | — |
| Next-parity | OAuth lifecycle, token refresh, realm/company selection, connection health/status visible to the operator (not log-inspection), staged import review through the existing `IntegrationImportBatch`/`IntegrationImportStagedRecord` substrate. | **BI-QB-001** (connect hardening), BI-QB-002/003 (import/sync, referenced but not sized here) |
| Enterprise-only | Two-way continuous sync with conflict resolution across QuickBooks Advanced/Desktop Enterprise, multi-company consolidated reporting bridged from QuickBooks. | Out of scope — this profile treats QuickBooks as a bridge/coexistence path per BI-COP-005 doctrine, not a permanent dependency |

### 7. Approvals — MVP: amount-banded rule; next-parity: relationship-scoped authority

**Evidence:** `ApprovalRule` (flat `approverId` + amount band) and
`BillApproval` (token-based response) exist today. No relationship-based
authorization engine (owner/manager/approver scoped through org hierarchy)
exists yet — approvals resolve to one named user per rule, not a role or
scope.

| Tier | Scope | Owning BI |
| --- | --- | --- |
| MVP | Amount-banded approval on bills via the existing `ApprovalRule`/`BillApproval` flow. Works for a company with one or two named approvers. | Existing substrate |
| Next-parity | Approval authority resolved via relationship (manager-of, approver-for-cost-center) instead of a hardcoded user id, with allow/deny/require-approval + reason codes, extended to payroll approval and QuickBooks-bridge actions. | **BI-C47EA32D** |
| Enterprise-only | Configurable multi-step approval chains with delegation, out-of-office reassignment, and org-wide approval-matrix administration UI. | Deferred — depends on BI-C47EA32D landing first; not scoped here |

### 8. Audit — MVP: field-level timestamps; next-parity: unified event/action/receipt trail

**Evidence:** Most finance/AP models carry `createdAt`/`updatedAt` and
status-transition timestamps (`sentAt`, `paidAt`, `voidedAt`, `respondedAt`,
`lastReconciledAt`), which is implicit, per-record audit trail but not a
queryable unified audit log. `ComplianceAudit`, `AuditFinding`,
`ComplianceAuditLog`, and `TranscriptCleanupAudit` exist but are scoped to
compliance/transcript domains, not general company-operations audit.

| Tier | Scope | Owning BI |
| --- | --- | --- |
| MVP | Per-record timestamps and status history already on Invoice/Bill/Payment/BankTransaction/BillApproval are sufficient to answer "who changed what, when" for a single small company today, even without a unified log. | Existing per-model timestamp fields |
| Next-parity | Unified event → normalized fact → interpretation → authority decision → action → provider response → reconciliation → receipt pipeline, reusing `IntegrationToolCallLog`/`IntegrationCallbackReceipt`/import staging and the authority ledger. | **BI-ECO-004** |
| Enterprise-only | SOC2/ISO-grade immutable audit warehousing with tamper-evident chaining, cross-entity audit consolidation, regulator-facing audit export tooling. | Out of scope for this profile — see `ComplianceAudit`/`ComplianceAuditLog` substrate for the compliance-specific track, which is separate from company-operations audit |

### 9. AI coworker work cases — MVP: none scoped here

**Evidence:** No `WorkCase` Prisma model or equivalent was found in
`packages/db/prisma/schema.prisma`. BI-ECO-004's body explicitly lists
"WorkCase" as one of the primitives its unified event/action/receipt bus
should reuse, implying it is expected to exist or be introduced by that work,
not by this doc.

| Tier | Scope | Owning BI |
| --- | --- | --- |
| MVP | **None today** for a general "AI coworker work case" concept scoped to company operations (AP approval routing, reconciliation review, invoice follow-up). Coworker-adjacent capability exists elsewhere in the platform (build/dev coworkers, established via `establish_coworker`), but a company-operations work-case model for e.g. "AI coworker drafts a bill for approval" is not yet substrate. | — |
| Next-parity | AI/coworker interpretation step in the BI-ECO-004 event/action/receipt pipeline — this is where "AI coworker work case" for company ops should land, not as a new standalone model. | **BI-ECO-004** |
| Enterprise-only | N/A — this is core to DPF's differentiation (AI coworkers absorbing company-ops toil), not an enterprise-only feature. It is next-parity, not deferred indefinitely; flagged here only because it has no current-day MVP evidence. | — |

## What "MVP" means for this profile

Read across §1-9, the MVP tier that exists **today, in schema and workflow
substrate**, lets a small company:
- keep one employee record per person with a position,
- capture timesheet hours,
- issue invoices and record payments against them,
- record bills/expenses and route them through one flat amount-banded
  approver,
- import bank transactions and manually reconcile them against payments,
- rely on per-record timestamps as an audit trail.

It explicitly does **not** yet let a company:
- connect QuickBooks at all (§6 — the one area with no MVP-tier evidence),
- resolve approvals by org relationship rather than a hardcoded user id (§7),
- get a unified cross-domain audit trail (§8),
- delegate company-ops tasks to an AI coworker work case (§9).

Per BI-COP-006's complexity-shield doctrine (referenced, not authored here):
every next-parity item above should ship with the *simplified* operator-facing
workflow, not the enterprise-suite version — e.g. BI-C47EA32D's relationship
engine should surface to an owner-operator as "who can approve this," not as
a permissions-matrix admin screen.

## Non-goals

- This doc does not implement any of the referenced capabilities.
- This doc does not replace BI-COP-001 (the durable Workday/QuickBooks parity
  scorecard) — it is a narrower, operationally-focused cut for "can I run my
  company today," while BI-COP-001 is the full competitive-parity map.
- This doc does not re-litigate the edge-adapter-vs-native doctrine — see
  BI-COP-005 for when to bridge (QuickBooks) vs. absorb natively.
- This doc does not size or sequence the owning BIs — that is each BI's own
  `effortSize`/priority field and EP-COMPANY-OPS-PARITY's roadmap ordering.

## Open questions for BI-COP-001 / EP-COMPANY-OPS-PARITY owners

- Should "AI coworker work case" (§9) get its own backlog item under
  EP-ECOSYSTEM-ABSORPTION-ARCH once BI-ECO-004 lands, or does it stay folded
  into BI-ECO-004's scope permanently?
- Should the QuickBooks bridge gap (§6) be called out as a standalone
  MVP-blocking risk in BI-COP-001's scorecard, given it is the one area with
  zero current-day substrate?
