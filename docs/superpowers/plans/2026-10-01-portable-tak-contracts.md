---
status: draft
---

# Portable TAK contracts implementation plan

**Backlog:** BI-F9582C48 · **Epic:** EP-B932453F · **Workroom:** WC-895D0009
**Design:** [Portable TAK contracts and reference transitions](../specs/2026-09-27-portable-tak-contracts-design.md), approved blob `9dd26b8bfdd34d8cdeacc06e36ce6daddb869534` at `c304c2de5b38fdb7ea2e92858533aa89cee27afe`.
**Objective baseline:** `baseline-61b69ddc-912c-4b71-a15d-49618462877d`.
**Admission:** planning allowed by `IRD-964DDECE3ADB`; implementation requires this plan's coverage and independent approval.

For agentic workers: execute this plan one independently reviewable backlog item at
a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation,
`dpf-local-merge-ci-before-push` plus the completion gate below before a success
claim, and `dpf-pr-with-dco` for handoff.

## Delivery boundary and backlog coverage

One atomic deliverable, `portable-reference`, maps to **BI-F9582C48**. Its schemas,
semantic validation, reference transitions, compatibility exports and examples
are inseparable for this acceptance: schemas alone could admit representations
whose mandatory semantics are silently ignored, and an untested loop could imply
authority or safe retries it does not provide. Phases below are internal sequencing,
not separate independently shippable work.

The live coverage receipt belongs to the PostgreSQL item, bound to this plan's
provider-verified commit and blob. Record it with `record_plan_backlog_coverage`
after the plan is committed and pushed; verify it with
`check_plan_backlog_coverage` before implementation. This section is the stable
pointer to that receipt, avoiding edits to the reviewed plan merely to insert its
own later-generated receipt ID. No Markdown checkbox substitutes for live coverage.

| Deliverable | BI | Independent | Dependencies | Requirements | Contracts | Flows | Verification |
|---|---|---|---|---|---|---|---|
| portable-reference | BI-F9582C48 | No; atomic contract | None within this plan | OBJ-PC-PORTABLE, OBJ-PC-AUTHORITY, OBJ-PC-RECOVERY, OBJ-PC-INTEGRITY; AC-PC-01..08 | PC-01..08; TAK-PD-001..008; TAK-DG-001..004; GAID-PD-001; JSI-PD-001..002; GPP §§2.1, 7, 9 | import-validate; decide-bind; reserve-dispatch; reconcile-retry; export-explain | CT-01..08 |

The DPF demonstration (BI-F3C2EC7A), family-wide conformance (BI-2AB781FA), portable
bundle (BI-07A2B207), Hermes (BI-FEA232AF), Cursor (BI-0E56BA38) and second archetype
(BI-72ED2A22) remain separate existing deliverables. This plan neither closes them
nor implements the GPP shape compiler or permit issuer owned by BI-6DA17863 and
BI-69415B68.

## Phase 1 — Canonical vocabulary and structural contracts

**Files:** `packages/validators/src/decision-scope.ts`, `outcome-disposition.ts`,
`trusted-agent-contracts.ts`, `trusted-agent-contracts.test.ts`, `index.ts`;
`apps/web/lib/shared/outcome-disposition.ts` and
`apps/web/lib/decision-perspective/decision-scope-admission.ts`.

1. Establish failing cases for the five artifact kinds, version discrimination,
   strict fields, finite bounded values and JSON Schema generation (CT-01/02).
2. Move the existing pure scope constants/type/predicate and disposition owner into
   validators. Web keeps compatibility exports and existing scope admission logic;
   preserve every literal, function signature and retry posture.
3. Define strict Zod schemas for work definitions, operating profiles,
   qualifications, decisions and effect receipts, using the reviewed bounds.
   Separate structural schemas from semantic validation. Export generated Draft
   2020-12 JSON Schema in memory using the pinned Zod owner, with stable identifiers.
4. Represent canonical sources as opaque versioned references. Include applicable
   GPP binding versions separately from shape versions. Never copy policy bodies,
   credentials, raw arguments or a permit signing implementation into artifacts.

**Verification:** CT-01/02 structural cases; all validator tests (the new files have
no graph-linked tests yet); the six existing web tests listed below. Confirm JSON
Schema generation never falls back to unconstrained `any` for unsupported types.

## Phase 2 — Required semantics, restrictions and compatibility

**Files:** `trusted-agent-contracts.ts` and `.test.ts`.

1. Establish rejection cases before implementing duplicate/dangling stage, option,
   capability and extension detection; enforce the declared collection ceilings.
2. Negotiate exact schema and extension versions. Unknown mandatory extensions and
   recognized names with unsupported versions fail. Required extensions need a
   semantic validator. Preserve unknown optional extension data under bounded JSON
   limits; reject excess rather than truncate. Bound nesting as well as size.
3. Validate selected options against eligibility and canonical disposition. Preserve
   owning scope, profile revision, hard constraints and restricted evidence
   references. Missing restrictions never become public-by-default.
4. Validate declared GPP projections, matching stage/shape and owning scope without
   expanding capabilities. Reject consequential advancement with missing required
   binding references; unsupported flow semantics cannot be flattened silently.
5. Check validity windows and reference consistency without claiming to authenticate
   the source. Exported structural validity is explicitly weaker than the complete
   importer and weaker still than current runtime authority.

**Verification:** CT-02/03/04/07 with malformed input, incompatible versions,
forbidden selections, scope mismatch, missing/changed GPP revisions, duplicate
references, restricted export and optional-extension round-trip cases. Error
results are bounded and structured; malformed input does not escape as a throw.

## Phase 3 — Pure reference transitions and uncertain effects

**Files:** `trusted-agent-reference-loop.ts` and `.test.ts`.

1. Write failing transition cases for `ready`, `awaiting-decision`,
   `awaiting-authorization`, `awaiting-reservation`, `awaiting-dispatch`,
   `awaiting-reconciliation` and `stopped` before adding the transition function.
2. Accept only validated state/events. Bind correlation to the exact work,
   composition, selected action, actor, target/account, operation revision,
   argument digest/canonicalization, purpose, policy generation, applicable GPP
   binding and attempt. Wrong-order, duplicate or mutated events cannot dispatch.
3. Emit commands in this order: scoped decision, current authorization, durable
   reservation, mediated dispatch with a fresh authorization check, reconciliation
   if uncertain, then recording the outcome. Commands are requests to an adapter,
   never tool calls or reusable authorization tokens.
4. Distinguish not-submitted, succeeded, proven no-effect and unknown. An exception
   or timeout after possible submission remains unknown. Replay from serialized
   state retains effect identity and does not create another submission.
5. Reconciliation may observe effects after revocation but cannot reauthorize them.
   Retry only after proven no-effect, within bounds, with a new attempt identity
   and current authorization. A changed binding requires renewed resolution.
6. Count bounded transitions, attempts and reconciliation work. Exhaustion produces
   an explicit hold/stop owned by a named resolver; it does not fabricate a denial
   of the business objective. Waiting and infrastructure uncertainty remain typed.

**Verification:** CT-04/05/06, including reservation refusal, stale authorization,
revocation between preparation and mediated dispatch, lost acknowledgement,
duplicate completion, unknown effect across restart, reconciliation exhaustion and
fresh authorization after proven no-effect. A pure test cannot prove an external
adapter's atomicity: test the command contract and label that limitation.

## Phase 4 — Runnable examples, guide and final evidence

**Files:** `trusted-agent-examples.ts`, both new test files,
`docs/architecture/trusted-agent-reference-contract.md`, `index.ts`.

1. Provide minimal valid and invalid fixtures plus a deterministic reference run,
   executable through the repository's pinned tooling without a DPF connection,
   model, credential or external side effect. Mark all fixture observations simulated.
2. Include success, refusal, scope mismatch, unknown-effect reconciliation and
   optional/mandatory extension examples. Cover the public exports, not private
   implementation-only helpers, so the examples are useful to another harness.
3. Document the owning standards, exact supported schema version, importer versus
   structural-schema checks, adapter obligations, privacy restrictions, extension
   registration, retry/recovery and schema evolution. Include a runnable command.
4. State that the module does not qualify an actor, grant capabilities or certify
   GPP-Modeled/Enforced/Evidenced. Link existing external reproduction and canonical
   DPF demo work rather than implying they are implemented here.
5. Reconcile all eight acceptance statements with executed evidence and request
   independent completion assessment. Missing or inconclusive evidence stays open.

**Verification:** CT-08 and the complete CT-01..08 corpus; inspect the example's
imports for Prisma, Next, filesystem, network and model dependencies; run the
consumer command exactly as documented.

## Traceability for completion

| Acceptance | Phase | Contract | Flow | Evidence |
|---|---|---|---|---|
| AC-PC-01 | 1 | PC-01 | import-validate | CT-01 |
| AC-PC-02 | 1, 2 | PC-02 | import-validate | CT-02 |
| AC-PC-03 | 2, 3 | PC-03 | decide-bind | CT-03 |
| AC-PC-04 | 2, 3 | PC-04; GPP §§2.1, 7, 9 | decide-bind; reserve-dispatch | CT-04 |
| AC-PC-05 | 3 | PC-05 | reconcile-retry | CT-05 |
| AC-PC-06 | 3 | PC-06 | reserve-dispatch; reconcile-retry | CT-06 |
| AC-PC-07 | 2, 4 | PC-07 | import-validate; export-explain | CT-07 |
| AC-PC-08 | 1, 4 | PC-08 | export-explain | CT-08 |

## Impact contract and completion gate

The 2026-10-01 Workroom scope claim resolved all 13 planned paths. Its graph lookup
found these web tests; include all six after the vocabulary moves:

- `lib/decision-perspective/decision-scope-admission.test.ts`
- `lib/shared/outcome-disposition.test.ts`
- `lib/explore/phase-gate-disposition.test.ts`
- `lib/operate/mcp-call-efficiency/refusal-codes.test.ts`
- `lib/tak/run-status-closed-set.test.ts`
- `lib/work-management/work-shape-stop-disposition.test.ts`

The validators barrel links `src/field-dispatch-policy.test.ts`; run the complete
validator suite because new modules have no graph links. Before Red, refresh the
lookup if source paths or the owning contracts change. The impact contract names
`node scripts/check-style-drift.mjs` as a guard obligation, doc-index/doc-diagrams
as derived artifacts and an 800-line target/1,000-line hard cap per module.

Run:

- `pnpm --filter @dpf/validators exec vitest run`
- `pnpm --filter @dpf/validators typecheck`
- `pnpm --filter web exec vitest run` with the six explicit web test paths above
- `pnpm --filter web typecheck`
- `node scripts/check-style-drift.mjs`, doc/derived-artifact checks and `pnpm pregate:preflight`
- The applicable governed publication gate and independent semantic review on the
  final committed tree; cloud CI owns the heavy production build under AGENTS.md.
- `pnpm pr:ready` before opening a regular PR and `pnpm pr:health` before merge.

There is no UI, migration, new persisted status or live dispatch change in this
slice. Runtime enforcement and live UX evidence belong to the existing demo BI;
never substitute fixture results for them. Use the canonical runtime/shared lease
for any runtime-bound gate that does apply. Report an infrastructure failure as
inconclusive and a skipped check as unrun.

## Risks and rollback

The primary risk is treating valid data or a reference command as authority. The
strict importer, bound events and documented adapter responsibilities address it;
independent review challenges those claims. Vocabulary moves can break imports,
so preserve web compatibility exports and run the graph-linked tests. Restriction
loss, permissive JSON Schema conversion and uncertain effects receive dedicated
negative tests. Do not add dependencies, tables, policy modes or a second ledger.

Rollback is one PR revert. It removes the new portable exports and restores the
pure vocabulary owners; there is no data migration or live enforcement mode to
reverse. Do not mark the BI complete until the plan coverage, independent reviews,
executed tests and baseline acceptance mappings are recorded and the delivery is
available through the normal PR process.
