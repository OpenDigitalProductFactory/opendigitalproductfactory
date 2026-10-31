# Software-platform recorded results

Status: draft
Backlog: BI-A699AE2C, bounded implementation child of BI-2D0FDF9E.
Workroom: WC-B9BF154E. Source baseline: ea62f5fb890390bde854b618834f5e77fd3865ea.

## Governing contracts and boundaries

Reuse [the two-view design](2026-07-28-business-operations-and-performance-views-design.md): Operations handles present work; Performance reads bounded historical projections. BI-B78E7351 retains architecture coordination. BI-C20A8CED and BI-5D7F02BC remain operating-baseline assessment, not implementation authority. DOC-82684072 supplies the actual owner finding; DOC-44B8E2D3 supplies the prior draft.

This slice repairs software-platform results coverage. It does not complete the broader account/demo/support/roadmap cockpit. Existing BI-7DB3B92F and the [Performance acceptance fixture plan](../plans/2026-08-12-performance-acceptance-fixture.md) own the fixture mechanism; extend that mechanism. Accounting assessment BI-43B17C8D and Workroom telemetry BI-3EC91596 are separate work.

No new table, metric engine, route, chart library, scheduler or provider. No production expense/journal creation, money movement, prospect contact, grant or credential change. Prior crm_read/admin_read refusals remain binding; live business records cannot be inspected through a fallback transport. Source inspection and expressly authorized nonproduction fixtures are allowed.

## Research and benchmarking

Sources inspected October31:

- [ERPNext Profit and Loss](https://docs.frappe.io/erpnext/profit-and-loss-report) derives period income and expenses from classified ledger accounts and preserves scope during drill-down. Adopt ledger classification, explicit period and scoped drill-through. Reject borrowing invoice totals as recognized revenue or losing organization/period filters.
- [GnuCash standard reports](https://www.gnucash.org/docs/v5/C/gnucash-guide/rpt_standardrpts.html) distinguishes period income/expense reports from asset/liability balances. Adopt that distinction and reuse DPF's existing trial-balance/statement math. Reject treating payments as bank balance or subtracting all bills as gross margin.
- [Frappe Books reports](https://docs.frappe.io/books/reports) presents compact period results with source-document navigation. Adopt the owner summary and existing report destination; retain DPF's asynchronous historical projection instead of running ledger scans on Performance page requests.

These are reporting precedents, not certification of the operating organization books or accounting advice. The DPF schema describes a management ledger; external accounting can remain authoritative. The source does not prove complete costs, cash, gross margin, revenue recognition policy, runway or customer delivery. Do not display those conclusions.

## Verified source and selected approach

`performance-metric-support.ts` admits restaurant only; `business-metric-rollup.server.ts` currently loads hospitality sources. Adding software to the allowlist without a loader is false coverage. `BusinessMetricRollup` already carries nullable values, availability/reason, period/timezone, dimensions, definition version and source lineage. `createBusinessPerformanceProvider` already resolves current organization and reads250 bounded projection rows; preserve that path.

`ledger.ts` already owns `computeTrialBalance` and `deriveFinancialStatements`. `ledger-service.ts` owns the persistence boundary, but its current report chooses the first organization. `period-summary.ts` aggregates global cash-basis documents. Neither is a safe scoped Performance adapter unchanged. Extend the canonical ledger read service with an explicit organization/period, bounded read and evidence contract. Reuse its calculations. The native General Ledger drill-in must resolve the same current organization and validate its period before loading; never accept an arbitrary organization URL parameter or fall back to the first organization on this path.

## Objectives

**OBJ-SR-1:** The owner can review precisely labelled recorded ledger results without hospitality instructions or fabricated business conclusions.

**OBJ-SR-2:** Unknown, incomplete, stale, failed and zero sources have distinct truthful presentation and supported next actions.

**OBJ-SR-3:** Existing authorization, organization boundaries, historical projection and restaurant behavior remain intact.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-SR-1 | OBJ-SR-1 | Software Performance shows posted ledger income, posted ledger expenses and recorded net result, explicit period/currency and the limitation that only recorded posted entries contribute. |
| AC-SR-2 | OBJ-SR-2 | Missing chart/period data, mixed currency, invalid or oversized source, ambiguity and failed reads never become zero; recorded zero requires a valid configured chart and a complete bounded set of posted period lines. |
| AC-SR-3 | OBJ-SR-1, OBJ-SR-3 | The existing asynchronous aggregator persists the software pack through BusinessMetricRollup; page requests use the existing bounded provider, without ledger scans or per-card queries. |
| AC-SR-4 | OBJ-SR-3 | Source and drill-through preserve current organization, period and existing permissions; unauthenticated, worker and other-organization negative controls fail closed. |
| AC-SR-5 | OBJ-SR-2, OBJ-SR-3 | Real authorized fixture saved/readback, failure/recovery, desktop/narrow/keyboard and protected delivery evidence distinguish executed passes from blocked or unrun work. |

## Metric and source contract

The software pack contains three distinct keys: posted-ledger-income, posted-ledger-expenses and posted-ledger-net-result. All have month grain and currency unit. Income is the canonical revenue-account credit-normal total; expenses are canonical expense-account debit-normal total; net result uses the existing canonical subtraction. Do not populate generic recognized-revenue, gross-margin, cash-position or business-throughput keys with these values.

Use the existing monthly `JournalEntry.periodKey` (YYYY-MM) contract, not an invented fiscal calendar. Scope accounts and effective posted contributions to the exact organization and UTC ledger period. Include entries whose status is posted or reversed: a reversed original remains an economic contribution in its original month, and its compensating reversal contributes in its own actual month. Require the linked reversal chain to have consistent organization and effective status; unsupported or broken reversal state is unavailable. Exclude drafts. Same-month reversal nets to zero; a cross-month reversal must not erase the original month. Include all accounts needed to check the balanced trial balance, not only income/expense lines. Bound account and line reads with limit-plus-one; exceeding a bound yields unavailable, never a partial total. Reject invalid account types, nonfinite or invalid-sign amounts, unknown/foreign account links, unbalanced lines and incompatible currency. Currency must be explicit and consistent in the chart and contributing entries. This slice supports only currencies with two minor digits, matching canonical ledger math. Parse decimal values without losing stored precision: reject fractional minor units, both-sided lines, nonfinite values, unsafe integer minor-unit amounts or unsafe aggregate totals before calling the existing calculations. Refuse unsupported currency precision (for example JPY or BHD); formatting alone is not currency support. Do not convert or guess from the globally scoped settings row.

A configured chart must contain revenue and expense classes. At least one valid posted period entry establishes recorded-period coverage; no posted rows means missing records, not proven zero. A zero from a covered ledger is explicitly recorded zero, not evidence of zero sales or complete costs. No source row identifiers, customer names or memos cross the aggregate boundary. Lineage names LedgerAccount, JournalEntry and JournalLine, record counts, source definition, currency and checked-at time. Empty inputs still carry their precise availability reason.

The aggregator computes current and previous UTC ledger month, using the existing idempotent upsert identity and scheduler. Month keys and boundaries follow ledger.ts periodKeyOf UTC, with UTC labels/query keys even when the storefront has another timezone. Reject invalid months rather than falling back to all-time. Persist all three rows for one organization/period in one existing Prisma transaction; an injected second-write failure rolls back the entire pack. Reject mixed generation metadata at the provider boundary if persisted legacy/malformed rows are incoherent. No new table is required. Historical rows remain in the same projection. Financial source failures preserve the last valid snapshot and its age; the system must not save zero or advertise a successful refresh. If a failure needs an unavailable observation, distinguish that observation from the last valid value instead of overwriting successful history with fabricated data. Preserve the existing retry path; do not promise immediate automatic recovery without evidence.

Current-month results are partial; do not compare them as if complete against a full prior month. Suppress that percentage comparison until comparable complete periods exist, retaining prior values as clearly scoped evidence. Software snapshot freshness always uses checked-at age, even for past periods; the existing finalized-period always-fresh shortcut must not apply. A past reporting interval is not proof that the accounting books are closed. Use recorded snapshot wording rather than finalized books for this pack. `performance-format.ts` must accept the actual currency; remove the USD display assumption for this path without changing existing callers' defaults.

## Owner presentation and recovery

Reuse BusinessPerformanceDashboard/report-kit and existing disclosure patterns. Lead with period, three recorded results, freshness and one native action. Keep calculations and lineage in the existing details. The native action opens the same organization's General Ledger period. This drill-in shows period income/expense and clearly labelled period movements only; withhold/relabel existing monthly financial-position cards instead of claiming an as-of balance without prior capital/opening/cumulative coverage. A prior-month5000 capital contribution and current-month200 expense must not appear as total financial position. The underlying all-time report remains separate. Unconfigured sources lead to the existing Finance setup/records workflow; No requirement that the owner run a command or use Codex.

An empty provider still explains that history is pending and provides the supported finance destination for software; it does not say hospitality only. Missing underlying ledger records explain what Finance needs next. A stale read keeps its actual checked-at time. A computation failure does not make the entire page unavailable if a prior valid snapshot exists. Source detail permission remains separately enforced.

Keep the111-word Performance and121-word General Ledger initial budgets; preserve accessible headings and existing controls. Record any intentional structural snapshot change through the governed measurement/review mechanism, never inflate numeric limits. Native fields, focus handling, tokens and disclosures support light/dark and keyboard/narrow layouts.

## Fixture, failure analysis and rollback

Extend the existing source-owned acceptance fixture only for an explicitly verified nonproduction/demo organization and current owner. Freeze expected normal-day, bad-day and periodic results independently before implementation. Exercise real canonical adapter/aggregator persistence, not projection-only fabricated positives. A production target, wrong organization/archetype, worker identity or missing demo proof must refuse before any write. Do not seed the operating organization production financial transactions. Retain source provenance and identify simulated records explicitly.

Normal: populated posted ledger, actual currency and zero net result reconcile to canonical statements and saved rollups after reload. Bad day: read failure, oversized set, incompatible currency, wrong organization, denied actor and stale retained snapshot remain truthful. Periodic: current partial versus previous complete month; actual next refresh recovers and persists once. Zero control and missing-period control must differ visibly.

Rollback is a protected revert of this one source adapter/presentation slice; preserve historical evidence. No destructive migration or journal reversal is required. Largest risks are incorrectly scoped drill-through, misleading zero/comparison/finality/currency and source failure hiding staleness. Targeted negative and mutation tests are required for those risks.

## Independent design assessment and frozen controls

CLIENT reviewer chat01a18569-1275-7961-846e-e7eea6ab2d8d assessed immutable6457 before code and found twoP1/threeP2 issues. This revision addresses reversal selection, movement/position wording, coherent three-row transactions, precision ceilings and UTC/month/freshness. The review is source/domain advice, not native approval or accounting certification. Independently frozen simulated controls: EUR1200income/200expense/1000net; expense-only0/200/-200;200/200/0; balance-only5000capital gives recorded0/0/0 distinct from no period records; same-month reversal0 and cross-month+1200/-1200; second-write failure retains prior coherent pack and checked-at; next refresh recovers idempotently. Denied actors, invalid months, wrong organization/currency/account, unsupported precision, imbalance or overbound never reveal a numeric total. No actual production figures or writes are implied.
