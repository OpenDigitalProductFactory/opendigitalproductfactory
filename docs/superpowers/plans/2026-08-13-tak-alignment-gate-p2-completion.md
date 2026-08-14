# TAK alignment gate — P2 completion implementation plan

**Epic:** EP-1C37C089

**Slices:** BI-FB036C59, BI-51CCB81C, BI-F23E07D5, BI-A8C735BA, BI-238E46C1

**Spec:** `docs/superpowers/specs/2026-08-13-wwwd-constitutional-alignment-gate.md`

**Depends on:** P1 foundation plan and batch PR

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time. The five slices intentionally share one batch branch and PR, while each BI retains its own test-first commit and evidence. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Standards contract

TAK owns action gating, GAID owns subject identity and receipts, and TAK-JSI owns qualification. WSID supplies specialist craft evidence; WWWD supplies organization direction. Every composition is narrowing: JSI eligibility does not authorize the action, an alignment approval does not prove competence, and owner identity does not exempt a call from policy.

## Backlog coverage

- Decision: `decomposed`
- Receipt: `cmss8h3lj000y01p2x1hfxeo5`
- Parent BI: `BI-FB036C59`
- `jsi` -> BI-FB036C59
- `rooms` -> BI-51CCB81C; depends on `jsi`
- `preconditions` -> BI-F23E07D5
- `embeddings` -> BI-A8C735BA
- `uniform-receipts` -> BI-238E46C1; depends on all prior P2 deliverables

## Slice 4 — JSI-qualified specialist delegation (BI-FB036C59)

- **Red:** add cases beside `apps/web/lib/decision-perspective/profession-gate.test.ts` and `apps/web/lib/tak/delegation-policy.test.ts` proving product/GTM checks route to the corpus owner, use `evaluate_profession_decision`, return evidence, and fail closed for absent/stale/out-of-scope qualification.
- **Green:** compose `apps/web/lib/tak/coworker-collaboration.ts`, the coworker intent router, profession gate, and existing delegation chain. Add a narrow alignment-check envelope and qualification result; never pass action permission through the specialist verdict.
- **Verify:** qualified specialist succeeds; unqualified specialist is refused before corpus access/action; the resulting chain-of-custody is present on audit and receipt.

## Slice 5 — Work Room collaboration shapes (BI-51CCB81C)

- **Red:** extend `room-participation.test.ts`, room read-model tests, and receipt-envelope tests for `specialist-alignment`, `approval-sign-off`, `outward-review`, `change-consequential`, and `escalation` shapes.
- **Green:** add a typed shape registry over `room-types.ts` and resolve participants through existing `room-participation.ts`/Principal lineage. Shapes declare coordinator, specialist, approver, inclusion order, authority ladder level, and sensitivity step-up. No room, membership, identity, or channel model is added.
- **Verify:** human and AI initiators produce the same required role set and authority ladder; veto returns through the room and lands as a `DecisionInteraction`/Outcome Packet receipt.

## Slice 6 — precondition and ordering check (BI-F23E07D5)

- **Red:** add an employee-identity-before-asset-allocation fixture and drift cases to the EA/value-stream and TAK gate suites.
- **Green:** project an executable precondition view from existing value-stream/FPAW ordering and the `data-model-mirror`/Prisma FK metadata. Add it as a fourth narrowing check family in the P1 gate; an unmet or incoherent prerequisite blocks or escalates with evidence.
- **Verify:** asset allocation before employee identity is rejected with the unmet prerequisite and references both the value-stream stage and FK mirror; no parallel workflow engine is introduced.

## Slice 7 — embedding self-heal (BI-A8C735BA)

- **Red:** extend `apps/web/lib/wiki/embeddings.test.ts` for an idle-evicted provider that succeeds on bounded retry, a true outage that retains fail-safe behavior, and a published missing-vector page reconciled on the next governed run.
- **Green:** make `storeWikiPage` trigger bounded load-on-demand through the existing embedding provider. Extract the reusable portion of `apps/web/scripts/reembed-wiki-store.ts` into a governed reconciliation service/job that selects published missing-vector pages and idempotently backfills them.
- **Verify:** publish during idle eviction stores a vector; skipped pages self-heal when the provider returns; genuine unavailability remains observable and safe.

## Slice 8 — uniform actors, amend-not-bypass, GAID receipts (BI-238E46C1)

- **Red:** add end-to-end governed-execute cases for owner, employee, and coworker origin; reject any bypass/override argument; prove a deliberate stance revision changes the policy version and allows a freshly evaluated action; require a receipt for every consequential verdict including deny/escalate.
- **Green:** resolve human and agent actors through the existing Principal/GAID identity spine. Extend `ToolExecutionReceipt`/`ReceiptEnvelope` with gate decision, policy versions, actor/GAID reference, delegation chain, qualification status, evidence refs, and amendment lineage. Make missing mandatory receipt creation fail closed before an approved side effect.
- **Verify:** owner and employee are governed identically; the only route from reject to allow is a versioned stance amendment and fresh decision; receipts join back to the GAID subject and Work Case.

## Batch completion gate

- Targeted suites pass after every BI commit; full affected web/db tests pass at batch end.
- Production web build passes; any migration applies against existing data and a clean schema.
- UX verification covers rejection, escalation, deliberate amendment, and Work Room participant/receipt presentation in light and dark themes using existing `--dpf-*` tokens and shared primitives.
- Canonical customer-zero acceptance passes exactly: toaster/Alaskan fishermen grounded DECLINE; MSP partner and self-host support subscription APPROVE; every consequential call emits a GAID-bound ledger receipt.
- Documentation/conformance surfaces accurately distinguish implemented behavior from specified future maturity.

## Risks and rollback

- **Delegation outage or qualification drift:** fail closed/narrow/escalate; never substitute an unqualified generalist.
- **Room fan-out:** create/use one finite room per consequential decision and reuse standing rooms only when the case already owns the action.
- **Architecture drift:** refuse executable preconditions whose business and systems evidence disagree; surface reconciliation work.
- **Embedding pressure:** bounded retry/backfill with idempotency and provider-health limits.
- **Receipt failure after side effect:** prevent execution when the mandatory receipt channel cannot be reserved; reconcile only legacy/non-gated paths.
- **Rollback:** revert the P2 batch PR and its forward migration if one is introduced via a new compensating migration; P1 remains a coherent guarded foundation.
