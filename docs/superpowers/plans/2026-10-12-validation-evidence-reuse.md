# Validation evidence reuse

Backlog: BI-25CB699C. Workroom: WC-BB716B11.
Base: 8c50a27dbbd60c04fed59377888794e1ae702f8f.

## Design grounding

Extend `docs/superpowers/specs/2026-08-25-immutable-gate-single-flight-design.md`
and `docs/superpowers/specs/2026-09-04-delivery-closeout-cost-efficiency-design.md`.
The existing `scripts/lib/local-ci-stage-receipt.mjs` owns atomic stage receipts;
`scripts/lib/pregate-preflight.mjs` owns host guard execution;
`scripts/pr-readiness/core.mjs` owns readiness policy. No new server workflow,
table, evidence authority, or local runtime is needed.

The October 12 founder clarification supersedes AC-2's unconditional full local
gate for changed authored logic: run affected checks and reproduce the named
failure, then delegate integration to protected GitHub checks. A delegated
check is not an executed local PASS. Initial publication requirements remain.

Measured evidence supplied by release coordination: 84 guards passed in 762.9
seconds, then pregate immediately reran them without a source change. Separately,
the preceding PR in this thread passed 84 guards in 526.2 seconds. These are
individual observations, not average savings. Concurrent precommit diagnostics
share `/tmp/pre-commit-tc.log`; contaminated output is not proof the wrong test
process ran.

## Acceptance criteria from the live item

- AC-1: After a PASS at commit A, a signed merge of origin/main with no change to the branch's own diff can be pushed after the refresh tier passes, without waiting for a full local-CI slot.
- AC-2: A merge that changes the branch's own diff, such as hand-resolved conflicts in the branch's files, runs the affected tests. A merge that alters branch-authored logic still requires the full gate.
- AC-3: The merge queue remains the authoritative main+PR build. Nothing merges without it.
- AC-4: A re-claimed waiting gate keeps its queue position.

AC-2 is quoted for traceability, with its supersession stated above, not silently
implemented as the former requirement. AC-4 reuses existing immutable gate
single-flight/FIFO behavior; verify its existing tests rather than add a queue.

## Implementation sequence

One delivery unit: reliable reuse across the existing publication commands.
Phases below are internal sequencing, not independently accepted outcomes.

1. **CT-VALIDATION-IDENTITY / FLOW-REUSE.** Extend existing stage receipts for
   host preflight and readiness. Bind repository/worktree, tree, commit range,
   policy and command plan, toolchain and environment inputs. Require a clean
   tree, bounded freshness and an entirely successful executed result. Recheck
   identity after execution. Failure, skip, partial execution, missing identity,
   expiration and dirty files cannot become reusable PASS. Coordinate concurrent
   runs through an atomic per-identity claim without deleting another owner.
   **VC-REUSE:** unchanged replay executes zero guards; changing each identity
   input reruns; failed/skipped/expired receipts miss; concurrent callers do not
   both execute; mutation during execution cannot publish reusable evidence.
2. **CT-PUBLICATION / FLOW-CORRECTION.** Keep repository, DCO and PR metadata
   checks fresh. Reuse only checks actually covered by the matching receipt.
   Report reused, executed and delegated distinctly. Separate unchanged status
   failures from changed source; a GitHub failure is diagnosed with pr:health,
   not treated as a command to lease another full local build. Prove protected
   checks stay authoritative and affected tests remain required.
   **VC-PUBLICATION:** changed body/labels invalidate metadata checks; unchanged
   published source reuses valid results; new source never inherits full PASS.
3. **CT-DIAGNOSTICS / FLOW-COMMIT.** Isolate Prisma and typecheck log files per
   hook invocation and preserve exact failing output through diagnosis.
   **VC-DIAGNOSTICS:** concurrent invocations have distinct log paths; shell
   syntax and regression tests cover failure and cleanup.
4. Reconcile the existing build-gate runbook with its current editing owner
   (WC-EE471770 / BI-9369DEB5); do not overwrite their changes. Run affected
   Node tests, guard tests, shell syntax, doc-index and source guards. Inspect
   pr:health on publication and hand off release verification, not a waiting
   author conversation.

## Impact, risks and rollback

The native scope impact contract is resolved: no inferred testImpact or
guardObligation entries; Convergence-Impact is required for the hook and
doc-index regeneration is required for this new plan. Source guards and affected
tests remain mandatory; an empty inferred list is not permission to omit them.
No UI, schema, or runtime deployment changes are proposed. Refactoring reuses
one receipt writer and one execution policy rather than duplicating caches.

Primary risk is a false green from incomplete identity or concurrent writes.
Prefer a cache miss to guessed equivalence. Preserve actual execution timestamps
on reuse. Local optimization never creates canonical integration evidence.
Rollback the publication change through a signed PR; old receipts can be ignored
by policy-version mismatch without deleting user work or coordination records.

## Backlog coverage

Planned mapping: one atomic deliverable `validation-reuse` -> BI-25CB699C.
Requirement references: AC-1, AC-2, AC-3, AC-4.
Contract references: CT-VALIDATION-IDENTITY, CT-PUBLICATION, CT-DIAGNOSTICS.
Flow references: FLOW-REUSE, FLOW-CORRECTION, FLOW-COMMIT.
Verification references: VC-REUSE, VC-PUBLICATION, VC-DIAGNOSTICS.
Native immutable-plan coverage receipt is not yet recorded. This plan is not a
coverage PASS, implementation admission, test result, or delivery claim.
