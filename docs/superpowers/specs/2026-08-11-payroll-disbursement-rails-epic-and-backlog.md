# Payroll Disbursement Rails — epic + backlog manifest

**Status:** durable plan of record. **Filing:** the DPF MCP (backlog/kernel plane) was disconnected when this was written, so the governed epic + BIs are specified here and filed verbatim on reconnect (see §6 "Filing instructions"). This doc is the source of truth until then.

> Operator directive (2026-08-11): plan + file the epic and backlog for paying hired employees — "the most automated route, but also provisions for non-automated options should the customer's bank not offer electronic API interfaces." Robust, durable BIs with detail tails to execute when the time comes.

## 0. Where this plugs in (the existing seam)

The recruiting→hiring→paying spine already reaches **persisted, computed payroll**:
`offer-compensation` (hire lands payable) → `computeEmployeePayslip` (gross→net) → `PayRun`/`Payslip` persistence via `runPayroll`, with `markPayslipDisbursed(payslipId, "paid"|"failed", paidAt)` as the write-back hook. **That module deliberately never moves money.** This epic is exactly the piece behind that hook: it *moves the money* (or produces the artifact for a human to move it) and reports back through `markPayslipDisbursed`.

**Money-movement boundary (whole epic):** the platform prepares, tracks, reconciles, and records disbursement; a real net-pay send is a governed, operator-approved action, and against a **provider sandbox** in all automated tests. No agent executes a real-money transfer.

## 0b. Delivered in this branch (2026-08-11) — manual-rail core

The pure, dependency-free core of the manual rail is already built + verified here, ahead of filing (the loop now reaches a prepared bank artifact + an attested paid state, in code):
- **NACHA generator** (`apps/web/lib/hr/nacha.ts`) — PPD-credit ACH file, byte-position-correct + control-total balanced (6 golden/structural tests). This is **BI-DR-02**'s core (US format).
- **Manual disbursement flow** (`apps/web/lib/hr/manual-disbursement.ts`) — `prepareManualNachaBatch` (payslip net-pay lines + payee bank details → the file + summary) and `recordManualDisbursement` (attested "paid" through the existing `markPayslipDisbursed` hook; refuses without a `bankReference`). This is **BI-DR-03**'s core.
- Verified: 9 tests + web typecheck green. Money-movement boundary held (produces a file + records a human attestation; never sends).

**The one remaining input for a production manual run:** a **payee bank-account store** (routing/account per employee) — that is **BI-DR-01**'s persistence, which needs the model-shape kernel decision + a migration (both MCP-gated). Today the generator takes bank details as input; BI-DR-01 supplies them durably. So BI-DR-02/03 are code-complete over transient input; BI-DR-01 is the governed piece that makes the manual rail runnable end to end on real data.

## 1. Epic

- **Proposed id:** `EP-PAYROLL-DISBURSEMENT` (assigned on filing).
- **Title:** Payroll Disbursement Rails — automated ACH provider + manual NACHA/attestation behind one port, one evidence trail.
- **scopeKind:** `common` (paying employees is a common company capability across archetypes).
- **Parent/siblings:** consumes `PayRun`/`Payslip` (recruiting→hiring→paying seam, this branch); sibling to `EP-PAYROLL-COMP-BENEFITS` (controlled payroll readiness + provider bridge) and `EP-F7BD23BB` (Paycom-parity autonomous delight). Coordinates with `EP-MULTICOUNTRY-HR` (Mexico SPEI/CIE) and `EP-FINANCE-ACCOUNTING-CORE` (GL posting of the run).
- **Rationale:** payroll can be *run and recorded* but a hire cannot yet be *paid*. Disbursement must serve both a customer whose bank offers an API (automated rail) and one whose bank does not (manual rail: generate the exact bank artifact, human executes, attest as evidence). Both converge on one `disbursementStatus` and one auditable record — governance approves the evidence, not the provenance.

## 2. Architecture (the contract every BI honors)

- **One port — `DisbursementRail`:** `prepare(batch) → instruction`, `submit(instruction) → {reference, status}`, `pollStatus(reference) → status`, `cancel?(reference)`. Rails are interchangeable behind it.
- **Two rails, one evidence shape:**
  - *Automated rail* — a vetted payment-provider adapter (ACH API). Provenance = `provider-receipt` (via the `executeCallbackTransaction`/`Receipt` kernel).
  - *Manual rail* — generate the bank artifact (US: **NACHA** ACH file; MX: **SPEI/CIE** layout) + step instructions; human executes at the bank; confirms → provenance = `human-attestation` (via `ComplianceEvidence`).
- **Convergence:** a `Disbursement`/`DisbursementBatch` record per `PayRun` carries `rail`, `status`, and exactly one of `providerReceiptRef` | `humanAttestationRef`, and drives `Payslip.disbursementStatus` (`pending → submitted → paid | returned | failed`). Reconciliation and audit are identical across rails.
- **Reused substrate (verified 2026-08-11):** `ComplianceEvidence` (`schema.prisma:9355`, `lib/govern/compliance-types.ts`) for attestations; `executeCallbackTransaction` + `Receipt` (`lib/integrations/kernel/audit`) for automated interaction receipts + idempotency; `lib/finance/banking-validation.ts` for routing/account validation (both rails); the `fetchImpl`/`HarvestFetch` injection pattern (`integrate/greenhouse/harvest-client.ts`) for provider-adapter tests; `markPayslipDisbursed` (this branch) as the write-back hook.

## 3. Backlog (phased; each BI has an execution tail)

Effort key: S ≤1d, M ~2–4d, L ~1–2wk. Every BI: `type=product` unless noted, `triageOutcome=build`, `scopeKind=common` (platform where it touches shared schema), epic `EP-PAYROLL-DISBURSEMENT`.

### Phase 0 — rail-agnostic foundations + the manual rail (ships the non-automated option first; no provider decision, no external creds)

**BI-DR-01 — `DisbursementRail` port + `Disbursement`/`DisbursementBatch` persistence.** [L, platform]
- Scope: define the port interface; add Prisma `DisbursementBatch` (per `PayRun`: rail, status, totals, createdBy) + `Disbursement` (per `Payslip`: amount, rail, status, `providerReceiptRef?`, `humanAttestationRef?`, bank-account ref). Wire `Payslip.disbursementStatus` transitions to the batch. **Kernel-decide the model shape** (batch-per-run vs per-payslip only; where the bank account for the payee lives) before build.
- Acceptance: a `PayRun` can open a `DisbursementBatch`; each payable `Payslip` gets a `Disbursement` at `pending`; the port compiles with a no-op rail; status transitions are the single source truth for `disbursementStatus`.
- Tail: mirror the `PayRun`/`Payslip` model pattern already on this branch; migration is additive (nullable FKs) → attest `-- @migration-safety: data-safe:`, add `docs/data-impact/*.json` (kind `model`, regulated-record retention). Reuse `banking-validation.ts` for the payee bank account.
- Deps: none (builds on the landed `PayRun`/`Payslip`).

**BI-DR-02 — Manual rail: NACHA (US ACH) file generator + payment-instruction artifact.** [L, platform]
- Scope: pure generator `DisbursementBatch → NACHA file` (file header/batch header/entry detail/batch control/file control records, hash/entry counts, balancing) + a human-readable instruction sheet (what to upload where, effective date, total). Format-pluggable (US NACHA now; interface leaves room for MX SPEI/CIE — BI-DR-11).
- Acceptance: for a known batch, the generated NACHA file is byte-correct per spec (golden-file test) and balances; the instruction sheet lists the total, employee count, effective date, and file location.
- Tail: NACHA is a deterministic fixed-width spec → golden-file unit tests, no external dependency. Validate routing/account via `banking-validation.ts` before emitting. This BI alone makes the **manual route shippable**.
- Deps: BI-DR-01.

**BI-DR-03 — Manual rail: human-attestation evidence capture.** [M]
- Scope: after a customer executes the file at their bank, capture a `ComplianceEvidence` attestation (who, when, bank trace/reference, optional uploaded confirmation doc) that flips the `Disbursement`/`Payslip` to `paid` (or `returned`/`failed`). Immutable + audit-logged; requires the operator's explicit confirm.
- Acceptance: an operator attests a manual batch as paid with a reference; the payslips flip to `paid`; the attestation is retrievable as durable evidence and cannot be silently edited.
- Tail: reuse `ComplianceEvidence` + the evidence-collection helpers (`lib/govern/`); this is the "record that they did it manually as human-derived evidence" path. Governance approves the evidence, not the provenance.
- Deps: BI-DR-01, BI-DR-02.

**BI-DR-04 — Fake-provider double + `DisbursementRail` contract test suite.** [M]
- Scope: an in-memory `fakeProviderRail` implementing the port + a shared contract test any rail must pass (prepare→submit→poll state machine, idempotency, returned/failed handling). The reusable harness that pins the interface spec.
- Acceptance: `manualRail` and `fakeProviderRail` both pass the contract suite; a rail that skips a transition fails.
- Tail: model on the `audit.test.ts` fake-Receipt pattern + `fetchImpl` injection. This is the harness that makes "the interface specification and process interactions work as expected" a tested claim.
- Deps: BI-DR-01.

### Phase 1 — the automated rail (gated on a governed provider decision)

**BI-DR-05 — Payment-provider selection (decision BI, no code).** [S, decision]
- Scope: WWMD kernel decision (`principle_decide`) over ACH provider candidates (Increase / Modern Treasury / Dwolla / direct-bank API), each first run through the `tool-evaluation` skill (security, compliance/SOC2, data-residency, sandbox quality, lock-in). Record the ledger + the chosen rail default.
- Acceptance: a recorded kernel ledger + tool-evaluation dossier name the provider and the fallback; "never adopt an unvetted external tool" satisfied.
- Tail: run when MCP is back. Weigh `data_privacy`, `operational_independence`, `vendor_lock_in` (cost axis), `governance_compliance`.
- Deps: none (parallel to Phase 0).

**BI-DR-06 — Automated ACH provider adapter (behind the port).** [L]
- Scope: `providerAchRail` — fetch-injected client for the chosen provider (auth, create-transfer/payment, idempotency key = `(payRunId, employee)`, redaction of PII/bank data before any LLM context), mapping `DisbursementBatch` → provider requests and responses → `Disbursement` status.
- Acceptance: unit + **contract tests** (recorded provider request/response fixtures) prove the mapping + error/return codes; the adapter passes the BI-DR-04 contract suite.
- Tail: reuse the `harvest-client.ts` fetch-injection + `@dpf/integration-shared` redact patterns; NO network in CI.
- Deps: BI-DR-05, BI-DR-01, BI-DR-04.

**BI-DR-07 — Provider status webhook → receipt → `markPayslipDisbursed`.** [M]
- Scope: inbound webhook route verifying the provider signature → `executeCallbackTransaction(deliveryKey=<provider event id>)` → advance `Disbursement`/`Payslip` (`submitted → paid | returned | failed`); idempotent on re-delivery.
- Acceptance: a signed settlement webhook flips the payslip to `paid` once; a re-delivery is a no-op; a `return`/`NSF` webhook flips to `returned` with reason.
- Tail: copy the Postmark/Greenhouse inbound-webhook kernel pattern (`verifyInboundSignature` + `executeCallbackTransaction`).
- Deps: BI-DR-06.

**BI-DR-08 — Sandbox integration harness (operational proof).** [M]
- Scope: a dispatched workflow (like `ux-route-sweep.yml`) that runs `providerAchRail` against the provider **sandbox** through the full lifecycle (initiate → pending → settled → returned) using test ACH numbers, asserting each transition and recording receipts. Gated/scheduled; needs sandbox creds (operator-provided secret).
- Acceptance: the harness drives a sandbox payment end to end and asserts the state machine + a persisted receipt; runs green on demand.
- Tail: this is the "operational test harness" for the external dependency — proves process interactions, not just mapping. Not a per-PR gate.
- Deps: BI-DR-06, BI-DR-07.

### Phase 2 — operationalize, safety, jurisdiction, close-the-loop

**BI-DR-09 — Per-run disbursement approval gate (dual-control optional).** [M]
- Scope: no batch submits (automated) or emits a file (manual) without an explicit operator **approve-to-pay** on the run (amount, employee count, effective date shown); optional second-approver dual control. Satisfies "outbound and irreversible actions require explicit go."
- Acceptance: a batch cannot move to `submitted` without a recorded approval; the approval names the approver, timestamp, and totals.
- Deps: BI-DR-01.

**BI-DR-10 — Pay-stub delivery + employee pay history.** [M]
- Scope: generate the employee-facing pay stub (earnings, deductions, taxes, net, YTD) from `Payslip` + deliver (self-service surface and/or email); an employee pay-history view.
- Acceptance: a paid employee can see/download their stub; totals reconcile with the `Payslip`.
- Tail: new route → the new-route gauntlet (page-purpose + ux-fit). No new PII beyond the payslip.
- Deps: `PayRun`/`Payslip` (landed).

**BI-DR-11 — Mexico disbursement format (SPEI/CIE) for the manual rail.** [M]
- Scope: implement the MX bank layout behind the same manual-rail interface (BI-DR-02), with CLABE validation; serves Infinitum's Tijuana/Coahuila hires.
- Acceptance: a MX batch generates a valid SPEI/CIE file (golden-file test) with CLABE-validated accounts.
- Tail: coordinate with `EP-MULTICOUNTRY-HR` (per-entity currency MXN, statutory IDs). Format-pluggable via BI-DR-02's interface.
- Deps: BI-DR-02.

**BI-DR-12 — Reconciliation + returns/NSF handling.** [M]
- Scope: reconcile provider settlement (or the manual attestation) against the `PayRun`; handle returns/NSF (flip to `returned`, reason, re-issue path); surface unreconciled items.
- Acceptance: a returned payment is visible, reasoned, and re-issuable; a fully-settled run reconciles to zero exceptions.
- Deps: BI-DR-07 (automated) / BI-DR-03 (manual).

**BI-DR-13 — GL posting of a disbursed `PayRun`.** [M]
- Scope: post the run to the finance ledger (Dr wages / Cr net-pay-payable / Cr tax-payable; on disbursement Dr net-pay-payable / Cr cash).
- Acceptance: a disbursed run produces balanced GL entries in `EP-FINANCE-ACCOUNTING-CORE`.
- Tail: coordinate with finance ledger owners; reuse the invoice→GL auto-post pattern (`lib/actions/finance.ts`).
- Deps: BI-DR-01; §3.2 GL item of the seam design.

**BI-DR-14 — Go-live verification playbook (operator-executed).** [S]
- Scope: the live-install go-live gate — a controlled penny/1-cent real transfer to a controlled account, run by the operator per `dpf-verify-on-live-install`; capture the result as human-derived evidence; CAN-TEST/MUST-ADVANCE/BLOCKED preflight.
- Acceptance: a documented, operator-run smoke with recorded evidence before any production payroll disburses for real.
- Tail: agent prepares the playbook + evidence template; operator executes the real transfer.
- Deps: BI-DR-06/07/08 (automated) or BI-DR-02/03 (manual) as applicable.

## 4. Sequencing

- **Ship first (no external dependency, no provider decision):** BI-DR-01 → 02 → 03 → 04. This delivers the **manual rail end to end** — a customer with no bank API can pay employees today, with human-derived evidence. Highest-value, lowest-risk, fully testable in CI.
- **Then, gated on BI-DR-05 (kernel + tool-eval):** BI-DR-06 → 07 → 08 — the automated rail behind the same port.
- **Operationalize alongside:** BI-DR-09 (approval), BI-DR-10 (stubs), BI-DR-11 (MX), BI-DR-12 (recon), BI-DR-13 (GL), BI-DR-14 (go-live).

## 5. Governance

- **Money-movement boundary** (whole epic): platform prepares/tracks/records; real sends are operator-approved (BI-DR-09) and, in tests, sandbox-only. No agent moves real money.
- **Tool-evaluation** (BI-DR-05) precedes any provider adoption.
- **Regulated records:** `DisbursementBatch`/`Disbursement` retained per payroll/tax law → data-impact manifests on the schema BIs.
- **Kernel decisions to run when MCP returns:** model shape (BI-DR-01), provider selection (BI-DR-05); both are `dpf-decision-via-kernel` candidates.

## 6. Filing instructions (execute when the DPF MCP reconnects)

1. `create_epic`: title + scopeKind `common` + rationale from §1; capture the returned `EP-…` id.
2. For each BI in §3, `create_backlog_item` with: title, `type` (product; BI-DR-05 is a decision), `workType` (feature; BI-DR-05 chore/decision), `status open` + `triageOutcome build` + `effortSize` (S/M/L → small/medium/large), `epicId` = the new epic, `scopeKind`, and the scope/acceptance/refs body from this doc's BI entry (the "tail" is the body).
3. Record dependencies in each body (already listed). File Phase 0 first.
4. Run the two kernel decisions (BI-DR-01 shape, BI-DR-05 provider) via `principle_decide`; attach ledgers.
5. This doc remains the durable design of record; link it from each BI.
