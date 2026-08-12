# Recruiting -> hiring -> paying seam implementation plan

**Backlog anchors:** BI-A90203A4, BI-3E300172, BI-838F8D00, BI-DR-02, BI-DR-03.  
**Designs:** `docs/superpowers/specs/2026-08-11-recruiting-hiring-payroll-seam-design.md` and `docs/superpowers/specs/2026-08-11-payroll-disbursement-rails-epic-and-backlog.md`.  
**Work Capsule:** WC-EB23CDAD.

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Objective and boundary

Carry accepted-offer compensation through the canonical `EmployeeProfile` spine, compute and persist an auditable payslip, and prepare the validated manual bank artifact plus the proof-required status-transition core. The code prepares artifacts and records status; it never submits a real transfer. BI-DR-01 supplies durable encrypted payee/batch data, and BI-DR-03 remains open until the human attestation is immutable `ComplianceEvidence`. Automated provider work stays blocked behind completion of its tool evaluation, an operator approval gate, and sandbox-only integration proof.

## Grounded substrate

- `EmployeeProfile.{payType,hourlyRate,annualSalary,standardAnnualHours}` is the payroll input spine.
- `lib/hr/labor.ts#Compensation`, `compensationFromEmployee`, and `computePayslip` are the canonical compute contracts.
- `IntegrationCredential.fieldsEnc` and `credential-crypto.ts` are the existing encrypted-secret pattern; BI-DR-01 extends that pattern instead of storing bank details in clear text.
- `ComplianceEvidence`, `Receipt`, and `executeCallbackTransaction` remain the evidence and idempotency homes.
- Existing umbrella BI-PAY-001 covers the broader payroll record; BI-838F8D00 is its independently reviewable persistence slice.

## Phases

### 1. Offer compensation handoff — BI-A90203A4

Deliver a typed parser and mapper from `Offer.compensation` to the exact `EmployeeProfile` columns payroll reads, wire the shared hire landing path, and prove the round-trip against `compensationFromEmployee`. Preserve graceful `no-compensation` behavior and reuse the mapper from native recruiting P4.

Verification: parser/mapper unit cases, shared hire-landing idempotency, and the end-to-end compensation round-trip.

### 2. Employee payslip compute — BI-3E300172

Add the application-service caller that resolves the worker, compensation, and approved time, then invokes the pure payroll calculation with an injected statutory function.

Verification: hourly/salary gross-to-net cases plus explicit `no-employee` and `no-compensation` outcomes.

### 3. Durable PayRun/Payslip — BI-838F8D00

Persist normalized `PayRun` and per-employee `Payslip` records, idempotent on `(payRunId, employeeProfileId)`, while exposing only an auditable status hook for downstream disbursement.

Kernel decision: DI-2E77D02EB450 selected normalized PayRun/Payslip over JSON snapshots or reconstruction-only storage (high confidence, autonomy eligible).

Verification: additive migration safety, migration application in the governed integration sandbox, persistence/idempotency tests, non-payable skip evidence, and regulated-record data-impact coverage.

Refactoring delivered: `payRunRef` is the stable retry key; a retry cannot mutate its defining period or recompute a run after `draft`. `PayRun.status` and `Payslip.disbursementStatus` are database-enforced Prisma enums with generated TypeScript unions rather than new free-form strings. `PayRun` and `Payslip` are registered as confidential, local-only regulated payroll assets; amount and component projections are mask-on-read.

Intentional substrate budget: DI-2E77D02EB450 requires two relational identities with different cardinality and lifecycle (`PayRun` aggregate and per-employee `Payslip` line). The measured `prismaModelCount` ratchet therefore moves from 589 to 591; folding the lines into JSON would defeat the selected normalized shape, employee FK, and per-run uniqueness constraint. No other non-increasing substrate metric is relaxed.

### 4. Manual disbursement artifact — BI-DR-02

Generate a deterministic PPD-credit NACHA file and operator instruction summary from validated payee input. Keep the generator pure and format-pluggable.

Verification: golden fixed-width output, block/count/hash totals, balanced amount, and invalid routing/account refusal.

Safety hardening delivered: ABA checksum, account-width, whole-cent amount, date, file-modifier, and non-empty-batch validation fail closed before an artifact is emitted.

### 5. Human attestation transition core — partial BI-DR-03

Require a named attester, timestamp, and bank reference before atomically marking only pending payslips paid. This branch returns the evidence projection; durable, immutable `ComplianceEvidence` and operator UI follow after BI-DR-01 provides the batch identity.

Verification: missing-reference refusal, attestation projection, atomic multi-payslip status update, and proof that the code has no external bank call.

Refactoring delivered: the batch update is one database transaction, duplicate targets are refused, and the shared write-back hook cannot silently rewrite a non-pending regulated payroll record.

## Follow-on decisions, not scope creep

- DI-02525F508D14 selected an EmployeeProfile-owned encrypted payment account plus `DisbursementBatch`/`Disbursement` lines for BI-DR-01.
- DI-3D7890D23409 provisionally selected Modern Treasury behind `DisbursementRail`. Increase, Modern Treasury, Dwolla, and direct-bank API evaluations were opened; provider adoption remains blocked until those governed evaluations complete and a human approves the choice.
- Native recruiting P1-P5 and BI-DR-01 are separate BIs, branches, and PRs after this seam branch merges.

## Refactoring allocation

One fifth of implementation effort was reserved for consolidation: one `Compensation` contract across recruiting/payroll, one transaction-safe hire mapper across Greenhouse/native P4, one pending-only disbursement status hook across rails, typed payroll lifecycles, and fail-closed NACHA validation.

## Risks and rollback

- Payroll records are confidential and regulated; never log compensation, bank numbers, or NACHA contents.
- A stale branch can conflict with newer schema work. Reconcile against `origin/main`, rerun generated artifacts, and stop on semantic conflict rather than forcing a merge.
- Roll back by reverting the PR through the normal PR path. The migration is additive; do not drop payroll tables or wipe data as a rollback shortcut.
- Real-money movement remains operator-only. Tests use pure files, fixtures, fakes, or provider sandboxes.

## Completion gate

- Affected Vitest files and the full relevant package suite pass from the exact worktree tree.
- Production web build passes in the governed local-integration sandbox.
- The additive migration applies against existing data state.
- Documentation index is regenerated and checked.
- Independent semantic review, pregate evidence, DCO, ready PR, merge queue, and mechanical PR health all pass.

### Source-verification ledger

- Full web Vitest: 2,656 files and 22,752 tests passed; declared skips/todos only.
- Final payroll data-governance composition: 2 focused files and 6 tests passed.
- Web and `@dpf/db` typechecks, Prisma schema validation, substrate measurement, and all 37 pregate preflight guards passed.
- The source-only `@dpf/db` run passed 246 files/2,156 tests; five existing DB-integration files (19 tests) could not connect while the shared PostgreSQL lease was occupied. Migration application, those DB-backed tests, and the production build remain mandatory outputs of the governed local merged-code pregate before publication.

## Backlog coverage

Governed receipt `cmspndncd0aif01nvtkn16kgg` records the `decomposed` decision for umbrella BI-44C79A02 and validates six live mappings:

- `offer-comp-handoff` -> BI-A90203A4
- `employee-payslip-compute` -> BI-3E300172
- `payrun-payslip-persistence` -> BI-838F8D00
- `payee-bank-account-store` -> BI-DR-01
- `manual-nacha-artifact` -> BI-DR-02
- `manual-attestation` -> BI-DR-03

Dependencies in the receipt: compute depends on the handoff; persistence depends on compute; the bank-account store depends on persistence; the NACHA core depends on persistence; attestation depends on the bank-account store and NACHA artifact.
