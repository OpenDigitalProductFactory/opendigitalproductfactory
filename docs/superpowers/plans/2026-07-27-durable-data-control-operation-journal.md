# Durable data-control operation journal implementation plan

**Backlog item:** BI-DG-014
**Parent epic:** EP-DATA-GOVERNANCE
**Depends on:** BI-DG-002, BI-DG-003, BI-DG-011 (done)
**Coordinates with:** BI-DG-012 (in progress) for the shared PDP/PEP adapter contract
**Design authority:** `docs/superpowers/specs/2026-07-17-data-management-governance-design.md` §6.3
**Existing umbrella plan:** `docs/superpowers/plans/2026-07-17-data-management-governance-plan.md` Task 4B

> **For agentic workers:** execute this plan as one safety boundary on one branch and one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Add one durable, organization-scoped operation journal for consequential data mutations that span Postgres and external or derived stores. The journal persists intent before effect, binds a single-use authorization to the exact operation envelope, resumes safely after crashes, verifies effects independently from provider acknowledgements, compensates where possible, and remains visibly partial with a governed Work Case when an irreversible target cannot be reconciled.

The first delivery establishes the reusable journal and worker boundary. MDM merge/unmerge/publish, legal-hold issue/release, archive, disposition, projection cleanup, and subject access/erasure adopt it in their owning BIs; no legacy action is silently inferred or backfilled into the journal.

## Backlog coverage

- Decision: atomic
- Parent: `BI-DG-014`
- Receipt: `cms3v5y6400k201pndf5t9vej`
- Dependencies: `BI-DG-002`, `BI-DG-003`, and `BI-DG-011` (done). `BI-DG-012` supplies the shared PDP/PEP implementation later; this BI defines an injected adapter so neither branch must import unmerged code.
- Deliverable: `durable-data-control-journal` → `BI-DG-014`
- Rationale: the operation and step schemas, transactional intent/outbox write, authorization consumption, claims, verification, compensation, partial-case projection, and recovery worker form one fail-closed protocol. Shipping any subset would either permit an effect without durable recovery or expose a journal that can falsely report success.

## Existing substrate and reuse verdict

- `AuthorizationDecisionLog` is the canonical authorization-decision evidence. `DataControlOperation` links to it and stores only the immutable execution binding that the journal itself must consume.
- `RuntimeCapabilityTransition` is a host-install-specific saga and `IntegrationCallbackReceipt` is a connector-callback receipt. Both prove local patterns, but neither can own cross-domain data-control actions without mixing bounded contexts.
- `WorkItem` plus the Work Case projection is the canonical governed-case substrate. Non-compensable partial operations create an idempotent `data-control-operation` Work Item; no new generic case table is introduced.
- `ToolExecutionReceipt` remains tool-execution evidence and is not repurposed as a data-mutation checkpoint.
- A pending `DataControlOperationStep` is the transactional outbox record. A third outbox table would duplicate ordering, idempotency, lease, and retry state.
- No matching model, service, open PR, or recent `origin/main` implementation exists for `DataControlOperation`.

## Architecture review (advisory)

- **Alignment summary:** aligned after constraining the journal to orchestration state and reusing canonical authorization and Work Case substrate.
- **Important — avoid a second case system:** add `data-control-operation` to the Work Case source registry and project an idempotent `WorkItem` for non-compensable partials.
- **Important — distinguish acknowledgement from truth:** keep `targetReceipt` and `verificationReceipt` separate; only an explicit verifier may advance `applied` to `verified`.
- **Important — make the outbox structural:** persist operation, target steps, and any source-row mutation in one caller-supplied Prisma transaction. Dispatch is derived from pending/retryable steps, not an ambient fire-and-forget event.
- **Important — approve the measured substrate delta:** the operation aggregate and independently claimable target checkpoint have different identity, cardinality, indexing, lease, and recovery semantics. Keep both relational models and ratchet `prismaModelCount` from 528 to 530; a JSON step collection would defeat compare-and-set recovery and target-level constraints.
- **Important — bind authorization once:** hash the exact operation, actor authority, action, input, policy/hold versions, approvals, requested targets, and target PEPs. Consume that binding with a compare-and-set transition before the first effect and reject replay or drift.
- **Minor — preserve domain ownership:** the generic worker coordinates adapters; compensation and verification logic remain registered by the owning data domain.
- **Standards adopted:** transactional outbox atomicity and idempotent consumers; orchestrated saga checkpoints, explicit irreversible pivots, resumable compensation, and human escalation for non-compensable failure. The IETF `Idempotency-Key` work remains a draft, so DPF adopts its payload-binding principle without treating it as a final wire standard.

## Phase 1 — Executable contracts (red)

**Files**

- Add `packages/db/src/data-control-operation-schema.test.ts`
- Add `apps/web/lib/govern/data/control-operation-domain.test.ts`
- Add `apps/web/lib/govern/data/control-operation.test.ts`
- Add `apps/web/lib/queue/functions/data-control-operation.test.ts`
- Extend `apps/web/lib/work-management/source-registry.test.ts`

**Cases**

- Schema exposes stable operation/step identifiers, organization ownership, intent envelope, authorization binding, target ordering, checkpoints, retry/lease state, receipts, compensation metadata, case linkage, and terminal evidence.
- The state machine rejects every transition outside the documented graph.
- Reusing an idempotency key with a different input hash or requested target envelope fails closed.
- Authorization can be consumed once and only when actor, action, input, policy/hold versions, approvals, and target PEPs still match.
- A provider success records `applied`, never `verified`; only verifier evidence advances the step.
- Crash injection before and after intent, claim, effect, receipt, verification, compensation, case projection, and terminal evidence resumes without double effect.
- A non-compensable failed target stays `partially-complete`, opens one Work Item, and cannot emit reconciled evidence.
- Terminal evidence is accepted only after all required targets are verified or the operation has reached the explicit compensated terminal state.

## Phase 2 — Fleet-safe persistence

**Files**

- Modify `packages/db/prisma/schema.prisma`
- Add `packages/db/prisma/migrations/<timestamp>_add_data_control_operation/migration.sql`
- Update data-impact, classification, retention, and legacy-coverage manifests required for new persistent models

**Implementation**

- Add additive `DataControlOperation` and `DataControlOperationStep` models with organization and authorization-decision relations.
- Use TypeScript-owned kebab-case string registries for operation and step states; assert schema defaults and indexes in the DB contract test.
- Enforce organization-scoped request idempotency and operation-scoped target identity.
- Store intent and policy snapshots as immutable JSON/arrays while keeping query-critical state, lease, retry, and timestamps as typed columns.
- Represent the transactional outbox with step rows created alongside intent; no separate delivery table.
- Add no legacy backfill. Existing operations cannot be reconstructed truthfully.
- Annotate every tightening constraint with fleet-safety evidence and apply it only to newly-created rows.

## Phase 3 — Pure state machine and transactional service

**Files**

- Add `apps/web/lib/govern/data/control-operation-domain.ts`
- Add `apps/web/lib/govern/data/control-operation.ts`
- Add corresponding tests

**Implementation**

- Keep transition rules, canonical hashing, retry classification, terminal-state derivation, and evidence eligibility pure.
- Accept a caller-supplied Prisma transaction for `planOperation` so a source mutation and journal intent/steps can commit atomically.
- Create-or-replay by organization and idempotency key; return the existing operation only when the canonical envelope hash matches.
- Authorize with a decision-log reference and immutable single-use binding; recheck current authority and holds through injected PDP/PEP adapters immediately before compare-and-set consumption.
- Claim steps with lease expiry and compare-and-set semantics. Preserve attempt and cursor across crashes.
- Require effect adapters to consume the operation/step idempotency key and return a bounded receipt.
- Require a separate verifier adapter before marking a target verified.
- Retry transient failures, compensate domain-declared reversible steps, and leave irreversible failures partial.
- Create one governed Work Item in the existing escalation queue through an idempotent adapter and persist its reference before returning the partial outcome.
- Emit terminal evidence only after reconciliation/compensation has been derived from persisted step truth.

## Phase 4 — Recovery worker and registry wiring

**Files**

- Add `apps/web/lib/queue/functions/data-control-operation.ts`
- Modify `apps/web/lib/queue/functions/index.ts`
- Modify `apps/web/lib/queue/inngest-client.ts` if a typed on-demand event is needed
- Modify `apps/web/lib/work-management/source-registry.ts`
- Extend queue and source-registry tests

**Implementation**

- Register an event-driven runner plus a scheduled recovery sweep over authorized, executing, partially complete, and compensating operations whose step lease is available.
- Gate scheduled entry through the canonical quiescence seam and limit concurrency.
- Make the runner a thin adapter around the journal service; it must not duplicate transition policy.
- Register `data-control-operation` as a governed Work Case source with evidence-required consequential transitions.
- Ensure duplicate queue delivery, worker death, and expired leases converge on persisted checkpoint truth.

## Phase 5 — Documentation and adoption contract

**Files**

- Update `docs/architecture/` with the journal boundary and adapter contract
- Update Task 4B in `docs/superpowers/plans/2026-07-17-data-management-governance-plan.md`
- Add a short developer-facing adoption checklist near the service

**Implementation**

- Document intent-before-effect, same-transaction step creation, single-use authorization, target idempotency, acknowledgement-versus-verification, compensation, and Work Case escalation.
- State explicitly that this PR does not retrofit or activate legacy operations.
- Name downstream adoption owners: MDM, legal hold, archive/disposition, projection cleanup, and subject rights.

## Refactor allocation

Reserve approximately 20 percent of implementation effort for reusable boundary cleanup:

- extract the pure state machine and canonical envelope hashing from Prisma orchestration;
- centralize status registries, transition guards, retry classification, and terminal-state derivation;
- introduce narrow effect/verifier/compensator/case adapters instead of embedding domain conditionals;
- reuse the Work Case source registry and queue primitives rather than adding a journal-specific case surface;
- keep each implementation module below the module-size guard by separating domain rules, persistence orchestration, and queue wiring.

## Completion gate

1. Focused DB schema, domain, service, queue, and Work Case registry tests pass.
2. Crash-point and duplicate-delivery tests prove resume without double effect.
3. Affected package typechecks pass.
4. Prisma validates and the migration applies cleanly in the governed sandbox.
5. Exact merged-code local CI passes the production build, migrations, docs, data-impact, module-size, and full-test gates.
6. Documentation names the first adopting domains and forbids acknowledgement-only reconciliation.
7. `pnpm pr:health <PR>` reports every check terminal and passing with zero unresolved review threads.

## Risks and rollback

- **False reconciliation:** a provider acknowledgement could be mistaken for verified effect. Mitigation: structurally separate receipts and require verifier evidence.
- **Authorization replay:** a stale or reused approval could authorize changed inputs. Mitigation: immutable binding hash, immediate recheck, and compare-and-set consumption.
- **Double effect after crash:** a lease can expire between external effect and receipt persistence. Mitigation: mandatory target idempotency plus verification-first recovery; never fabricate a receipt.
- **Case invisibility:** irreversible partials could remain buried in logs. Mitigation: idempotent Work Item projection is part of partial-state settlement.
- **Domain coupling:** a generic coordinator could absorb domain rules. Mitigation: registered adapters and a pure generic state machine.
- **Migration drift:** constraints could wedge populated installs. Mitigation: additive tables only, no backfill, inline safety attestations, and sandbox migration evidence.
- **Rollback:** disable runner registration and revert service callers first. The additive journal tables may remain inert for audit continuity; do not destructively remove operation history.
