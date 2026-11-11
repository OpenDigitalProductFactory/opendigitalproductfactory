---
status: active
---

# Keep fix diagnosis recoverable when dispatch cannot run

Status: source implemented; 117 recovery tests and 64 related build-action controls passed. Independent client review closed the stale-write finding and identified lost escalation acknowledgements; that correction needs final review. Canonical exact-tree gate, publication, deployment and served acceptance remain unrun.

Backlog: BI-E492F313. Workroom: WC-9B3C9677. This is one atomic corrective change to the existing recoverability policy, not a replacement carrier or a new execution framework.

## Grounding

The current source baseline is `41afd6e6bb5bce14b3fd84068cdaac5a2e930402`. The fix-specific branch in `apps/web/lib/build/ideate-on-approval.ts` increments diagnosis rounds before dispatch, catches dispatch failures and continues, then escalates without producing a diagnosis. The general design/plan repair paths already use `review-fix-outcome.ts` to keep infrastructure-blocked work recoverable.

The real Finance counterexample, FB-C1934227, is recorded as `cmwbapdeu4h0701p011x42zqr` and `cmwbap17u4gz301p0fh7e4jg4`. Its two unsettled CLI attempts caused abandonment and owner deferral despite retained plan evidence. Historical delivery of the general design/plan policy is preserved. Research receipt: `initiative-4be2b40e-8836-47d3-acdc-9f170855b2ab`.

## Objectives and acceptance

- **OBJ-1:** A dispatch that cannot return a diagnosis leaves the build and backlog recoverable, with an accurate reason and no immediate duplicate dispatch.
- **OBJ-2:** A stale diagnosis worker cannot apply its answer or escalate work that has moved beyond its failed review.
- **OBJ-3:** Preserve grounded-diagnosis validation and the existing bounded handling of substantive refusals; never manufacture a diagnosis or approval.

| Check | Objective | Required evidence |
|---|---|---|
| AC-1 | OBJ-1 | Native-CLI uncertainty and provider-dispatch exceptions return the existing blocked outcome, consume no completed diagnosis round and never call escalation or a diagnosis writer. |
| AC-2 | OBJ-1 | No failed dispatch is retried within this invocation; the existing review and owner backlog disposition remain intact. The activity identifies recovery as pending. |
| AC-3 | OBJ-2 | A build already in Plan, terminal, or moved during inference receives no diagnosis write or abandonment. A changed problem/review is not overwritten by an old answer. Version preconditions reach the transactional mutation; a losing write cannot upsert its business brief and a losing escalation creates no report, attention or deferral. |
| AC-4 | OBJ-3 | Actual substantive refusals retain the bounded refusal policy; complete grounded diagnoses retain normal review. An unsuccessful diagnosis write is not reported as recorded or followed by review. An incomplete reviewer panel is held without inventing a defect verdict or escalating its execution failure. |
| AC-5 | OBJ-1, OBJ-2, OBJ-3 | First-failing regressions, affected existing controls, typecheck and exact-tree verification qualify the change. Source-local tests do not claim served Finance/email acceptance. |
| AC-6 | OBJ-1, OBJ-2 | An escalation committed before a lost acknowledgement is reconciled by its exact attempt marker before completing report/cleanup/deferral. If readback cannot prove that transition, return explicit uncertainty without retrying or claiming retained recovery. |

## Ordered work

1. Resolve the claimed impact contract. `find_related_tests` identifies the colocated `ideate-on-approval.test.ts`; include the existing diagnosis-parser, review-fix-outcome and dispatch-failure-class controls. Run the unchanged baseline suite, then add regressions for dispatch uncertainty and a worker becoming stale during inference. Observe those regressions fail before implementation.
2. In the existing fix-diagnosis branch, use the shared recoverability outcome on dispatch failure and stop this invocation without treating an unexecuted attempt as exhausted substantive repair. Re-read current phase/review/problem before applying an asynchronous answer and before escalation. Carry the captured `updatedAt` through the existing authenticated brief tool/action into a transactional conditional update covering owner, phase, nonterminal state and version. Guard escalation with the same phase/version condition before creating an owner question or deferring work. Respect diagnosis-writer failure. Preserve legacy callers and the independent design-revision path; add no classifier, table, permission, provider or retry allowance.
3. Make the regressions green, retaining controls for substantive refusal, grounded success, missing problem, incomplete review and stale state. Refactor only under green. Run affected tests and the web package typecheck with the actual package name `web`; reject no-project/zero-test output as unrun.
4. Run the impact-contract style guard, documentation index/link checks, preflight and exact-tree canonical gate; obtain independent semantic review, DCO publication and PR health. A later normal release and controlled served workflow must establish deployed recovery; this plan does not authorize runtime mutation or certify the old failed upgrade.

## Backlog coverage and boundaries

All steps implement BI-E492F313's existing five acceptance criteria through AC-1–AC-5 above. They are internal sequencing of one change and not independently shippable features. The governing contracts are the existing `resolveReviewFixOutcome`/`outcomeKeepsBuildRecoverable` policy, diagnosis parser and Build Studio phase ownership. Canonical coverage must be recorded against the immutable pushed plan; this text is not a coverage receipt.

No changes to verifier projection BI-57AF5162, native review routing BI-C51C266A, promoter recovery BI-F81AC573, mailbox onboarding, provider grants, customer scopes, or production settings belong in this diff.

## Risks and rollback

A phase fence can incorrectly suppress legitimate diagnosis if it compares against stale state; tests must cover the ordinary ideate path and the explicitly independent plan-phase design-revision path. Retrying uncertain execution can duplicate side effects, so dispatch uncertainty returns a recoverable hold rather than retrying. A failed writer cannot be treated as a persisted diagnosis. The existing semantic-refusal ceiling remains bounded. Roll back through the normal protected PR/release process; preserve the original build artifacts and failure evidence throughout.
