---
status: active
backlogItem: BI-25CB699C
workroom: WC-BB716B11
---

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
   Register the new regression suite in `scripts/lib/ci-policy-guards.mjs` so
   protected CI executes it; do not add it to an exclusion allowlist.
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
Native atomic coverage receipt: `cmv5qcetxf4rr01mwdd6d4czg`, binding the plan at
`b6a5901019cd1c6a230c0c51a061d4d47efae4d5`. No dependency edges. This receipt is
not an implementation test result or delivery claim.
Refreshed coverage after CI inventory scope registration:
`cmv5qqayffhxk01mwwxx0kk55`, binding `c8f00a6f4d6a854b1f8684c8d9853888dfc904f3`.

## Implementation checkpoint and remaining boundary

Host preflight and PR readiness now share the existing stage-receipt and
owner-fenced local-convergence-lock mechanisms. Receipt storage is bounded to
one result per stage per worktree. Reuse expires after one hour and preserves
the execution timestamp; that is a local verification policy, unrelated to an
AI provider's prompt-cache retention. Commit metadata changes still invalidate
host guard receipts because several guards read commit messages. Integration
tree equivalence remains the existing server evidence planner's responsibility.
PR body and labels are in the readiness command plan identity. Dirty/untracked
files, changed main, command plan, environment or toolchain invalidate reuse.

The current pre-push hook has PASS or an audited override, not a native
post-publication cloud-delegation receipt. Do not manufacture a full local PASS.
For this authorized DEV recovery, use its documented scoped operator-emergency
route and preserve skipped/unrun checks. Permanent cloud-delegation policy stays
open in BI-25CB699C: it must bind the actual open PR/repository/branch/head,
affected tests and independent changed-code review, and retain required GitHub
checks and protected merge queue. This checkpoint does not claim AC-1/AC-2 or
the entire BI is complete. Do not automatically relaunch full local validation
merely because a published PR is blocked; diagnose its actual GitHub failure.

Independent source review reproduced a cached-hit race on shared origin/main.
Both cache-hit paths now re-read identity before returning a reused result;
the regression failed before this correction and passes after it. The runbook
owner released the exact documentation claim through the native tool, and this
Workroom claimed it before editing; no force/co-claim was used.

## Publication attestation follow-up

Coverage receipt: `cmv5vj5t3211201pg2kczysxk`, binding the follow-up plan at
`8b0c959f4766cfa916e9c2a6495622e5e8400737`. Research receipt:
`initiative-661f9726-3ee9-4a8f-b57c-117ba86bf315`.

CT-PUBLICATION / FLOW-CORRECTION / VC-PUBLICATION: PRs #6235 and #6236
omitted local-CI trailers after readiness reported READY. Their bodies have
since been repaired without repeating executed validation. Extend the existing
readiness command to reject missing publication attestation for non-docs changes.
An evidence trailer must match a qualified, current-head result from the existing
slot manifests and `classifySlotRecord`, not an arbitrary ID
or an admission. Reuse the existing override classifier; an allowed override
remains explicitly UNRUN, never PASS. Do not introduce a new gate or ledger.

Sequence: reproduce missing attestation with a failing readiness test; add tests
for failed, expired, foreign-head/branch, pending and skipped evidence, plus a
qualified matching result and a truthful permitted override; wire the existing
read-only gate reader into readiness; update contributor documentation. Keep
metadata checks outside reusable guard execution. A docs-only change retains
the existing evidence-policy exemption. Report unavailable proof as unresolved,
not an instruction to repeat the entire gate. Existing protected CI remains
authoritative. This is a continuation of the same atomic publication contract;
the broader refresh/delegation requirements above remain open.

Touched source: `scripts/pr-readiness.mjs`, `scripts/pr-readiness/core.mjs`,
`scripts/pr-readiness.test.mjs`; documentation: `docs/testing/pr-health.md`.
The native impact contract has no testImpact or guardObligation entries; run
the readiness, pregate-status, PR-health, override and receipt regression suites
and affected source guards. Rollback is a signed revert of this bounded adapter
change. No runtime, schema, grant or UI changes are included.

Compatibility boundary confirmed by the coordinator: ordinary external readiness
requires local-CI attestation. Build Studio retains its existing server-owned
`requireInPlatformPreflightRecord` before publication and detached exact-ref
mechanical checks afterward. Absent external slot files do not block that path;
text and JSON state local proof UNPROVEN, with no authority or PASS inferred
from the flag. Supplied malformed or unqualified proof still blocks. Exercise
the actual `buildPublishedReadinessCommand` and guard the caller's existing
server preflight ordering. Broader projected-tree proof transport stays open;
never rebind a private-tree PASS onto the remapped published tree.

## Host-resource retry identity follow-up

AC-4 remains incomplete for `host-heavy-resource`: the runner derives its claim
key from the current PID, while a detached retry starts a new process. Five
queued leases were observed for one receiver invocation on October 12. The
server also rejects PID changes on an existing host claim. Changing only the
client key would replace duplicate rows with failed retries.

CT-HOST-RESUME / FLOW-HOST-RESUME / VC-HOST-RESUME extend the existing claim,
`resumeLeaseId`, detached resumer and local queue observer. No new queue,
service, table or evidence authority is introduced. One logical invocation gets
a random attempt identifier plus a digest of source, command, owner, worktree,
branch and resource budget. Replays carry that identity before the child-command
separator; genuinely new invocations get new identifiers. Changed inputs stop
the old attempt unrun rather than silently admitting different work.

Within the existing locked lease transaction, only an exact same-owner,
same-provider, same-contract, pinned queued host lease may transfer process
identity. Preserve its lease ID and original queue timestamp. Missing, foreign,
terminal, active or mismatched resume targets never create a replacement or
take over an active execution. Fresh claims retain normal capacity admission.

The existing observer directory retains the actual resumer PID, child PID and
bounded per-attempt output. The launcher PID is explicitly a launcher, not
claimed as the durable child. Credentials and raw environment are not logged.
Cancellation, source drift and terminal leases stop retries without running the
command. Keep recursion suppression and the existing retry deadline.

Sequence: add failing runner/resumer and mocked-transaction regression tests;
implement the bounded identity handoff; run those suites and existing resume,
host-admission and resumer suites; independent review and protected CI precede
publication. No live claim storm or lease cleanup is part of this repair.
Touched paths: `scripts/host-resource-runner.mjs` and its test,
`scripts/lib/durable-wait-resumer.mjs` and its test,
`scripts/local-ci-durable-wait-resumer.mjs`, and
`apps/web/lib/nonprod/environment-lease.ts`, `environment-lease-resume.ts` and
their host-resource/resume tests. A source-local helper may isolate identity
calculation without adding a durable store. The shared client transport must
retain ordinary local-CI behavior.

Regression coverage must prove stable lease count and queue age across changing
PIDs, fresh identities for new invocations, exact argv preservation, changed
source/command/owner/budget rejection, terminal/foreign/active lease refusal,
normal queued-to-admitted progression, and retained child output and identity.
The server PID handoff is the principal risk: accept it only for the exact pinned
queued lease. Rollback is a signed revert; do not mutate historical leases.

This is the remaining AC-4 repair under BI-25CB699C, not completion of the wider
BI. Early quiescence detection before expensive preflight remains separate.
During QR-2026-10-13-k0qmxdnz, native claim writes returned `portal_quiescing`.
The operator-authorized recovery route permitted bounded source work. After
the upgrade, the normal claim succeeded as WC-FAB79D1A and atomic coverage
`cmv5yzgu7009801nvclvqc2xp` bound plan commit
`0b0c7f3ecc215639ec191e9cc579f326088cbf5b`. Implementation readiness returned
allowed. No backlog completion or live resource lease was created.

The existing MCP pack must project the two added identity/expiry refusals as
structured errors, so clients stop unrun rather than report a product failure.
Include its pack and dispatch tests in VC-HOST-RESUME. Operational instructions
are updated in `docs/operations/local-ci-sandbox-slots.md`; the general pattern
and developer-environment pages keep their existing resource-admission policy.
The native impact contract identifies the lease and pack test suites plus the
style-drift guard. Run all related suites, both TypeScript programs and affected
policy guards. Full local integration and native semantic review remain unrun
under the authorized recovery route; independent source review and protected
GitHub checks remain required. No UI, schema or capacity-policy change occurs.

## Automatic published-correction policy — October 16 continuation

BI-25CB699C / WC-0B3EF2C5, branch `fix/published-correction-validation`,
source base is merge PR #6432 (`c1febac87438`). The earlier implementation
checkpoints above remain historical evidence, not completion of AC-1/AC-2.

The October 12 founder clarification is the governing direction for this
continuation. Current measured examples repeat the symptom: 156 readiness
guards finished on unchanged source, but a concurrent `origin/main` update
made their aggregate inconclusive; a second chat repeated 84 guards with the
same outcome. Neither result is converted into a full PASS. The protected
GitHub queue continues to perform the actual merged-tree integration.

### Existing substrate and chosen boundary

Extend the existing publication policy, not the canonical integration verdict.
The source homes are `.githooks/pre-push-gate`, `scripts/pr-readiness.mjs` and
`core.mjs`, `scripts/pr-health.mjs`, and the packaged
`pregate-evidence-guard.mjs` / `lib/local-ci-override.mjs`. Reuse
`scripts/ci-evidence-plan.mjs` for changed-file/test/package recommendations,
`scripts/lib/host-command-invocation.mjs` for portable command execution, and
the existing atomic JSON/stage-receipt primitives for local observations.
The shared canonical gate records and their historical PASS/FAIL identities
remain unchanged. No database model, grant, queue or service is introduced.

Add one closed, machine-evidence-bound `published-correction` publication
reason to the existing override contract. It explicitly means **local full
integration UNRUN / delegated to protected GitHub**, never `gatePassed: true`.
A prose trailer alone cannot qualify this reason. Every existing consumer
must validate its structured current-head proof. Keep the proof in the
existing unslotted publication record; preserve the original slot receipts.

Eligibility requires an actual open, non-draft PR in the configured repository,
matching the local named branch and canonical `main` base, plus provider-read
confirmation that active branch rules require checks and a merge queue.
Unreadable provider state, a wrong or closed PR, absent queue protection,
dirty source, ambiguous history or changed source identity fails closed to an
explicit unresolved publication result. It does not automatically request a
new full local lease. Initial publication retains its existing requirements.

Classify against the actual published head and its branch-authored diff:
unchanged head; identical tree with changed commit metadata; main refresh with
unchanged authored diff; and authored correction. Record both immutable source
identities, the class, executed command/results and delegated obligations.
The unchanged and metadata cases execute no source suite. A changed tree runs
the existing planner's affected tests and package typechecks, with named
failure reproduction where supplied. Unmapped or unsupported local execution
is an explicit unresolved prerequisite, never zero-check success. Planner
global-risk/exhaustive recommendations remain visible and are delegated to
the protected integration path rather than silently discarded.

Readiness detects the existing published PR automatically and chooses the
bounded correction plan. Fresh repository, DCO, body/label and relevant trailer
checks remain mandatory. Broad source guard execution is delegated explicitly;
cached source results retain their original identity/time. Before returning or
persisting permission to publish, re-read clean Git/source identity and actual
PR/rule identity. A race, failed check, interrupted child or malformed receipt
cannot become reusable proof. Publication evidence has bounded freshness and
cannot expand authority or imply runtime acceptance.

### Ordered verification and delivery

1. CT-PUBLICATION / FLOW-CORRECTION: first reproduce the repeated-validation
   behavior in tests. Add executable Git-fixture/command-adapter tests for all
   four classes, first publication, wrong repo/branch/base, missing protected
   checks/queue, foreign/expired/malformed proof, dirty source, drift during
   execution, failed or skipped affected checks and unsupported source mappings.
   VC-PUBLICATION must prove zero full-gate/lease invocations on eligible
   corrections, and no borrowed full PASS on changed bytes.
2. Implement one shared packaged proof classifier and one source-side adapter;
   route the Git hook, PreToolUse, readiness and PR health through that contract.
   Tests must exercise those actual consumer paths, including refusal of a
   prose-only `published-correction` trailer and preservation of an earlier FAIL.
   Register the regression in `scripts/lib/ci-policy-guards.mjs` after the
   current scale-adapter owner releases its normal scope claim.
3. Update `docs/testing/pr-health.md` and this plan; no UI or schema changes.
   Resolve the native impact advice for the three packaged-hook paths before
   Red. Run affected Node/hook/readiness/health suites, shell syntax and named
   design-grounding/convergence/doc guards. This is source verification;
   protected GitHub CI/queue remains the integration authority.
4. Obtain independent source assessment, publish through the normal signed
   branch/PR route, and exercise an actual post-publication correction without
   another full local lease. Record executed, reused and delegated separately.
   AC-3 protection stays unchanged; AC-4 uses the already delivered resume
   identity work and is not rewritten in this continuation.

These steps implement one publication-policy change under the existing medium
BI. The shared classifier and all consumers must ship together; partial reader
acceptance would create inconsistent publication behavior. Normal scope claims
cover the 15 source/document paths before implementation. The current native
impact contract is resolved, identifies the three packaged-hook related-test
lookups, and requires design-grounding and convergence trailers. No explicit
guard obligations were inferred; that does not exempt affected source checks.

Risk: accepting stale/foreign evidence or treating delegated integration as a
PASS. Prefer a refusal to inferred equivalence; keep original evidence and
truthful UNRUN labels. Roll back through one signed revert; unsupported
`published-correction` records then fail closed without deleting any history.
Current coverage for this exact continuation must be recorded before code;
no prior coverage ID above is asserted to cover this scope.
