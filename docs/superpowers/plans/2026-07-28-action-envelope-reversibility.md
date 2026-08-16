# Universal AI Business-Record Action Envelope And Reversibility Matrix

Date: 2026-07-28

Backlog item: `BI-35E9EE62`

Epic: `EP-2984B02B`

Work Capsule: `WC-0FCC67BF`

Branch: `feat/action-envelope-reversibility`


> **Rescue note (2026-08-16).** Recovered from a branch that was pushed and never proposed as a PR, found in the 2026-08-15 never-proposed-branch sweep. **The design landed here; the implementation did not.**
>
> - Tracked by `BI-3B01B725` (recovered tail designs). Read it before acting on this document.
> - Preserved implementation: `feat/action-envelope-reversibility` @ `705c73597fb891390257f6a206f0884996745946`, pinned at `refs/salvage/2026-08-15/feat/action-envelope-reversibility` and listed in `~/dpf-deleted-remote-branch-tips-2026-08-15.txt`. Restore with `git push origin 705c73597fb891390257f6a206f0884996745946:refs/heads/feat/action-envelope-reversibility`.
> - Backlog ids cited below that do **not** resolve in this install: `BI-35E9EE62`. Treat them as labels, not links.
> - No coverage receipt is recorded and none should be until a thread actually starts — a receipt bound to unstarted work would be fiction. This document is deliberately outside the plan-backlog-coverage gate (it carries no bolded backlog-item metadata line).

## Goal

Create the first enforceable platform contract for AI-initiated business-record mutations: every action class has an explicit propose, approve, commit, receipt, and reversal/compensation posture, and existing proposal/action/receipt substrates can be classified against one shared matrix.

This slice does not rewrite every domain mutator. It establishes the reusable contract and tested classification surface that follow-on domain BIs can adopt.

## Substrate Verification

- `AgentActionProposal` already exists in `packages/db/prisma/schema.prisma` and `packages/types/src/entities.ts`; this work extends its semantics rather than adding another approval table.
- `RemoteAction` already exists as the governed remote-execution primitive, with read-only actions able to reach `approved` and mutating actions remaining `proposed` until per-action approval.
- Work Case already owns the receipt projection through `apps/web/lib/work-management/receipt-envelope.ts`; this work references that envelope instead of creating a second receipt model.
- `DataControlOperation` already owns durable multi-target data mutation intent, authorization consumption, target idempotency, verification, compensation, and partial Work Case escalation.
- The current generic attention projection for `AgentActionProposal` marks all proposals as `bounded-write` and `irreversible: false`; the new matrix should make that classification explicit and reusable.

## Delivery Plan

1. Add a pure action-envelope module under the governance/action domain.
   - Define closed vocabularies for action mutation class, risk tier, reversibility, required HITL posture, receipt posture, and follow-up status.
   - Define `BusinessRecordActionEnvelope` and classification helpers for proposal rows and known action families.
   - Keep the module pure and migration-free so it can be adopted by UI, tool execution, Work Case, and data governance code without introducing a DB dependency.

2. Seed a source-controlled coverage matrix for current known action families.
   - Cover proactivity changes, field-dispatch customer notifications, activity-harness tuning, staffing schedule publishing, federated/remote actions, organization join actions, security responses, and data-control operations.
   - Mark unknown/unregistered business-record mutations as requiring human approval and child-gap follow-up.
   - Preserve the distinction between governed actions, observed events, and unclassified gaps.

3. Add focused contract tests.
   - Prove irreversible/high-risk classes require explicit human approval.
   - Prove read-only/non-mutating classes cannot be accidentally described as business-record commits.
   - Prove known current families resolve to stable matrix rows.
   - Prove unknown mutating actions fail closed and produce a follow-up gap.

4. Wire one low-risk consumer.
   - Use the classification helper in `agent-proposal` attention projection so proposal cards stop hardcoding `bounded-write` and `irreversible: false`.
   - Keep UI copy and layout unchanged in this slice; only improve the data classification behind it.

5. Update architecture recovery documentation.
   - Point the roadmap guardrail at the source-controlled matrix and helper.
   - Record which domains conform, which are pending integration, and which need child BIs.

## Backlog Coverage

Coverage receipt: `cms4t9v9w0vvv01rufctszlei`

Decision: `atomic`

Rationale: the independently reviewable outcome is one source-controlled contract plus matrix plus tests. Splitting the type contract, matrix, and first consumer would create partial surfaces where agents can import labels with no tested policy meaning, or tests can assert classifications that no projection uses. Domain rewrites are deliberately out of scope and will be mapped as child gaps after this contract lands.

Deliverables:

| Key | Title | Independently shippable | BI |
| --- | --- | --- | --- |
| `action-envelope-contract` | Universal AI business-record action envelope and reversibility matrix | No | `BI-35E9EE62` |

## Verification

- `git diff --check`
- Focused Vitest for the new action-envelope module and the touched attention projection.
- TypeScript check for the touched modules. If the worktree remains source-only, use cached root package binaries where possible and record any unrun gates honestly.
- Shared `local-integration-ci` pregate before PR creation.

UX verification is not applicable for this slice beyond existing projection tests because no visual layout, route, or interaction is changing.

Migration verification is not applicable because this slice is migration-free.

## Risks And Rollback

- If the matrix is too broad, future domains may treat labels as permission. Mitigation: helper returns an explicit required approval posture and unknown mutating actions fail closed.
- If the matrix duplicates existing action-specific logic, adoption will fork. Mitigation: map current families by importing their existing action constants or known stable action names and keep execution logic in the owning domains.
- If attention projection changes wording unexpectedly, UI tests should catch it. This slice should preserve existing labels while improving risk/reversibility metadata.

Rollback is a source revert of the new module, tests, and attention projection import. No data migration or persisted state rollback is required.
