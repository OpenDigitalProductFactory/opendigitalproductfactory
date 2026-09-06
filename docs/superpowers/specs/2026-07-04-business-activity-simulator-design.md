# Business Activity Simulator — design spec

**Status:** P1 shipped (PR #2720, BI-FDAD8788) · **P2 shipped** (BI-78B83F58) · P3/P4 open (BI-E51D594F / BI-041735BC) · updated 2026-07-09
**Epic:** EP-BUSINESS-ACTIVITY-SIM
**Author:** platform (via Claude Code, operator Mark)
**Related:** [[living-business-workforce-activity]] concept (the read-side viz); EP-TRADES-FIELD-SERVICE; the finance spine (PRs #2546/#2548/#2559)

## 1. Problem

DPF targets **20 business archetypes** (`packages/storefront-templates/src/archetypes/`) — field-service/trades, software-platform, retail, MSP-shaped, professional services, etc. Each archetype exercises a different slice of the platform's operational surface: dispatch, invoicing, payments, AR/AP, GL. There are **not enough manual cycles to know the full functional surface is solid in every archetype**. A regression in, say, payment→GL settlement for retail could sit undetected because nobody ran that path this week.

There is also no synthetic source of realistic operational activity to (a) populate demos and (b) drive the "living business" workforce-activity visualization.

## 2. Goal

A **Business Activity Simulator**: a test/dogfood harness that drives the *real* platform capabilities through end-to-end operational flows — *create customer → dispatch/subscribe/sell → invoice → send → payment → AR/AP → GL* — **parameterized by archetype**, producing:

1. **A cross-archetype coverage report** (archetype × capability = pass/fail) so we gain re-runnable confidence.
2. **Realistic activity** emitted to the observability substrate (the write-side of the living-business viz).
3. A reusable **demo/seed + load** input.

### Design principle (load-bearing)
**Drive real capability paths; stub only the outer edges.** The confidence signal only exists if the harness exercises the *actual* domain logic (real GL postings that really balance, real lifecycle transitions), faking only what is genuinely external: the customer, the payment gateway, inbound demand. A harness that fakes the internals proves nothing.

## 3. What already exists (reuse, do not rebuild)

- **`packages/coworker-sim-harness`** — deterministic field-dispatch world + **oracles** (pure invariant predicates over a `WorldSnapshot`) + scenarios + virtual clock. Field-dispatch only; no invoice→payment→GL. The world+oracle *pattern* is the model to extend.
- **`packages/validators/src/field-dispatch.ts`** — the job lifecycle enum (quoted→scheduled→confirmed→en-route→on-site→complete→invoiced→paid) + pure predicates (`isTerminalStatus`, `isWorkComplete`). No DB.
- **`apps/web/lib/finance/ledger.ts`** — **pure, DB-free** GL: `buildInvoicePostingLines` (Dr AR/Cr Revenue/Cr Tax), `buildPaymentPostingLines` (inbound: Dr Bank/Cr AR), `validateJournalEntry` (balance rule), `computeTrialBalance` (→ `balanced`).
- **`apps/web/lib/finance/ledger-service.ts`** — DB persistence: `postInvoiceIssued`, `postPaymentRecorded`, `seedChartOfAccounts`.
- **Server actions** — `createCustomerAccount` (crm.ts), `createInvoice`/`sendInvoice`/`recordPayment` (finance.ts), `createSupplier`/`createBill` (ap.ts).
- **`packages/finance-templates/src/profiles.ts`** — per-archetype chart-of-accounts templates.
- **`apps/web/lib/tak/agent-event-bus.ts`** — the live event taxonomy (`tool:start`, `plan:update`, `collaboration:*`, `taskrun:stalled`) the sim emits to for the viz. (Recon missed this under the classifier outage; it exists.)

## 4. The gap

1. A **cross-flow orchestrator** chaining dispatch → invoice → payment → GL in one run (pieces exist; nothing runs them together end-to-end).
2. **Archetype factories** generalizing beyond field-dispatch (SaaS subscription, retail POS…).
3. A **coverage report** (archetype × capability) with **financial oracles** as the assertions.
4. The **invocation seam** decision (see §6).

## 5. Phases

- **P1 — one archetype, end-to-end, real, DB-free (this PR).** Field-service: compose the *real* `field-dispatch` lifecycle with the *real* pure `ledger.ts` posting into a single orchestrated flow, with **financial oracles** (GL balanced, AR settles to zero, revenue recognized, cash received, no phantom billing, job terminal-paid). Deterministic, runs in CI, no DB, no auth. Proves the model + gives the first re-runnable confidence run. Ships with a self-test proving the oracles have teeth (a deliberately broken flow must fail them).
- **P2 — generalize (SHIPPED, BI-78B83F58).** Extracted the universal invoice→payment→GL half into `runBillingCycle`; added SaaS (`software-platform`) + retail (`retail-goods`) archetype flows keyed to real StorefrontArchetype ids; generalized the P1 oracles to a shared `FinancialFlowShape` so one oracle set scores every archetype; `runArchetypeMatrix` produces the per-archetype pass/fail matrix. **Finding:** only field-service has a rich lifecycle in `@dpf/validators`; SaaS/retail lifecycles are sim-local — a real substrate gap (candidate follow-up: an operational-lifecycle vocabulary for non-trades archetypes). DB-backed service-layer fidelity (test Postgres + seeded COA + auth-context shim) is folded into P4.
- **P3 — graphical living-business view (BI-E51D594F).** The read-side: archetype + its TAM (geography / market segmentation) as the visual frame, with AI-coworker / human / partner activity animated within it (network-topology / factory-automation / Porter's / IT4IT framings), drill-in to the existing portal + value-stream views. UX-fit review required.
- **P4 — stubbed live-portal activity + DB fidelity (BI-041735BC).** Drive real dispatch/invoice/payment/AR/AP on the live portal (service layer against a real DB) behind a **test-instance-only toggle**; emit business events to `agent-event-bus`/`TaskRun` for the P3 viz.

## 6. Invocation seam (the one real design question)

Three seams to drive flows headlessly:
- **Pure domain functions** (`ledger.ts`, `field-dispatch.ts`) — no DB, no auth. **Chosen for P1**: highest determinism, real invariants, CI-friendly.
- **Service layer** (`ledger-service`, invoice/payment services) — real persistence + account resolution; needs a test DB + a thin auth/actor context shim. **P3.**
- **Server actions** — full auth/capability path; highest fidelity but session-bound. Reserved for e2e.
- Raw Prisma — rejected: bypasses business logic, proves nothing.

## 7. P1 shape (this PR)

`apps/web/lib/business-activity-sim/` (home is apps/web because the pure ledger layer lives there; P2 may extract a `packages/business-activity-sim` once the ledger pure layer is packaged):
- `field-service-flow.ts` — `runFieldServiceFlow(scenario)`: advances a job through the lifecycle to `paid`, builds the real invoice + payment journal lines, accumulates the journal, computes the trial balance. Returns a `FlowResult` (job status, journal lines, trial balance, revenue recognized, AR balance, cash received).
- `oracles.ts` — pure financial oracles over `FlowResult`.
- `coverage.ts` — run N scenarios → a pass/fail coverage report.
- `*.test.ts` — positive scenarios (with/without tax, multi-line) all-oracles-green **plus a negative test** (underpayment leaves AR ≠ 0) proving the oracles catch a broken flow.

## 8. Non-goals (P1)
No DB, no server actions, no UI, no non-field-service archetypes, no volume/load. Those are P2–P4.

## 9. Test-only archetype toggle
The multi-archetype toggle (in the viz) is **test-instance-only** — a real customer install is exactly one archetype. Gated so production single-archetype installs never see it. Lands in P4 alongside the observability wiring.

## 10. P4 research amendment — business-day fidelity (2026-09-06)

BI-4CCE50E0 contributes [research and restaurant scenarios](../research/2026-09-06-astra-business-verification-review.md#5-human-world-representation-the-restaurant-pilot)
to existing BI-041735BC. The latter is a federated-origin record on the operator development install;
its owner must reconcile scope and approval before implementation.

Add normal-day, disrupted-day and periodic-close fixtures. Begin with Restaurant
host/public booking and Pet Rescue public/staff intake, then use measured gaps to
select later archetypes. Execute real DPF authorization, domain logic and persistence;
isolate external message/payment sinks. Pure simulation, service integration and
browser evidence retain distinct fidelity labels. Use the existing
[audit evidence contract](../../architecture/archetype-operating-model-audit.md#outcome-evidence-and-exception-probes),
including independently specified expected values and a known-bad negative control.

Report first-pass completion separately from eventual completion and partial credit;
record scenario versions, skipped/inconclusive counts, regression failures and cost.
Do not claim catalog-wide reliability from a few sentinels. Bound each run's time,
retry and concurrency budget and page large record sets. Expand shared scenario and
oracle adapters before adding bespoke harnesses; preserve each vertical's constraints.
No production test toggle, simulation execution or gate activation occurs in this pass.
