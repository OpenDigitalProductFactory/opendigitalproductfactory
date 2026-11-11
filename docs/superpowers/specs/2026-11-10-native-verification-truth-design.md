# Native verification truth (BI-57AF5162)

**Status:** proportional medium-fix design and ordered implementation plan.
Source implementation is not approved by this document alone.
**Workroom:** WC-C96C7635; branch `codex/native-verification-truth`.

## Problem and research

On November 10, native build FB-F765639B advanced to Review with contradictory
verification evidence. Its deterministic record explicitly said no tests ran
because the changed files were unknown, but recorded one passing test and zero
failures. The retained QA report said 99 passed and three failed, with a clean
typecheck. The Finance coordinator corrected that record through the normal
artifact writer, preserving the original. That correction was not a test run.

The defect is reproduced on source
`4fff0a44d8b957e479a1d17379eab3041c2e2432`, unchanged in the relevant modules at
the current base `41afd6e6bb5bce14b3fd84068cdaac5a2e930402`:

- `deterministic-build-verification.ts` converts the runner's overall Boolean
  success into one passing test, including `scope: none`.
- `resolveQaVerification` always prefers that result to the parsed QA evidence,
  even when it executed no tests. The retained QA excerpt is limited to 500
  characters.
- Its fallback changed-file discovery reads only committed merge-base-to-HEAD
  changes and suppresses git failures. A missing projection can therefore miss
  intended staged, unstaged or untracked source. This is a source hypothesis
  for F765's missing scope, not a proven cause of that runtime observation.

A source-local invocation of the existing pure policy functions actually ran:
an injected zero-test, typecheck-only result produced `testsPassed: 1`; the
resolver also replaced a reported 99/3 QA outcome with 1/0. Both assertions
failed with exit 1. Workroom reproduction
`cmwbbmovu4mhe01p0vovq1kku` and DPF report DOC-D9846C32 retain the evidence.
This was not a product test, sandbox execution or passing repair.

The two pure-policy assertions were repeated on the governed current base
`41afd6e6bb5bce14b3fd84068cdaac5a2e930402`; both failed again. A separate
actual invocation of `listBuildChangedFiles` used a disposable temporary Git
repository with a base commit, later committed file, staged file, unstaged
tracked file and untracked file. It returned only the committed file. An
invalid base printed a Git fatal error but returned an empty array. The
fixture was removed. This rules out a prose-parser-only diagnosis and proves
the discovery defects on current source; it still does not prove why F765's
runtime projection was missing. No live container or product source changed.

Reuse the existing [scoped-agent-test design](2026-10-08-sandbox-scoped-agent-tests-design.md),
especially recording only what ran and catching related test failures. Preserve
the delivered history of BI-CEE688D6, BI-BD483DF0 and BI-E0931D5C. The new item
owns the uncovered orchestration/fallback integration; BI-F5D4FA50 retains
scoped execution and resource-envelope ownership.

## Objectives and acceptance

**OBJ-TRUTH:** Count only executed checks and make unrun tests explicit.

**OBJ-SOURCE:** Qualify the intended current source without losing failures or
conflicting evidence.

**OBJ-RECOVERY:** Retain proportional checks and normal native recovery and
protected delivery.

The quoted criteria are the BI's current acceptance contract.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-1 | OBJ-TRUTH | No executed tests yields0testpasses and explicit not-run/not-applicable meaning, never a fabricated1pass. |
| AC-2 | OBJ-TRUTH, OBJ-SOURCE | Unknown changed scope cannot supply positive qualification for required feature tests. Preserve permitted exempt/no-covering-test cases without claiming tests ran. |
| AC-3 | OBJ-SOURCE, OBJ-RECOVERY | A no-test deterministic result cannot silently supersede a known reported failure. Resolve conflicts through actual source-bound scoped checks or prove failure out of scope; retain original evidence. Do not restore unreliable prose parsing as authoritative execution. |
| AC-4 | OBJ-SOURCE | Staged/unstaged/untracked intended source, empty commits, unknown git scope and reader failure are covered through the existing isolation/source resolver; unrelated work is excluded. Do not infer no changes from missing projection. |
| AC-5 | OBJ-TRUTH, OBJ-SOURCE, OBJ-RECOVERY | Reproduce actual F765 sequence and current pure RED assertions; affected tests/typecheck, independent review and protected delivery. Verify native saved structured counts/commands/source after correction and after reload. |
| AC-6 | OBJ-RECOVERY | No whole-suite sandbox fallback, grant/credential/guard bypass, fabricated PASS, manual DB rewrite or live container/proof change. Legitimate later assembled commit remains supported. |

## Options and chosen approach

1. Keep the current Boolean-to-test-count conversion and deterministic
   precedence. Rejected: the source-local counterexample reproduces false
   positive evidence without executing a test.
2. Trust QA prose instead of deterministic execution. Rejected: this restores
   the unreliable inference repaired by BI-E0931D5C.
3. Extend the existing verifier and isolated source discovery so execution,
   applicability, counts and conflicts retain their own meaning. Chosen.

No new verifier, scheduler, agent, schema or lifecycle is introduced. Use the
existing runner, normalized verification output, scoped gate and source
resolver. Typecheck success remains separate from test execution. A runner's
Boolean success must not invent a test count; retain actual counts where
available and explicit not-observed meaning otherwise.

A no-test deterministic result may establish its actual typecheck result. It
cannot qualify required feature tests or silently supersede unresolved failure
evidence. Preserve the reported QA result and provenance as a conflict until
actual source-bound scoped checks resolve it. Do not turn a parsed sentence
into verified execution. Existing low-confidence/unknown handling must keep
such a result from becoming an authoritative test pass.

Distinguish unknown scope from an observed empty diff and from legitimate
exempt/no-covering-test work. Read only the build's existing isolated workdir;
include its intended committed, staged, unstaged and untracked files. A failed
reader or missing merge base is not an empty change. Do not sweep another
build's workspace or fall back to the whole suite.

## Ordered work and traceability

One atomic deliverable, `verification-truth`, belongs to BI-57AF5162. The steps
below are internal sequencing, not independently shippable features. Counts,
scope discovery and fallback qualification must agree before the outcome is
safe. Contract references C-COUNTS, C-SCOPE and C-CONFLICT; flows F-NO-TEST,
F-WIP and F-QUALIFIED-RERUN; verification references V-POLICY, V-GIT,
V-INTEGRATION and V-SERVED are defined by these steps.

1. Preserve F765's original record, corrected CLIENT provenance and partial
   source. Do not guess the missing three failure names or require a per-task
   commit when the native contract captures the assembled change later.
2. **V-POLICY / C-COUNTS / F-NO-TEST:** add failing regressions to the existing
   deterministic verification tests for zero executed tests, explicit
   applicability and unresolved QA failure. Retain real scoped-pass and
   typecheck-failure controls. Run RED on the named base before implementation.
3. **C-CONFLICT / F-QUALIFIED-RERUN:** correct counting and qualification in the
   existing verifier. Preserve conflicting reported evidence until a real
   relevant rerun resolves it. Use current normalized fields and gate semantics
   rather than inventing a parallel status system.
4. **V-GIT / C-SCOPE / F-WIP:** reproduce discovery with temporary git fixtures,
   then correct committed/staged/unstaged/untracked handling and reader errors.
   Prove isolation and empty-diff versus unknown behavior. No live Docker action.
5. **V-INTEGRATION:** exercise the actual producer-to-saved-output-to-gate path
   with the existing orchestrator tests. Known relevant failures stay blocked;
   real scoped verification can advance; legitimate exempt work retains
   proportional checks and truthful counters.
6. Run affected tests and package typecheck, independent source review and the
   required exact-tree shared/cloud gate. Preserve every failure or unrun
   result. Publish through a signed-off protected PR and normal canonical
   release. Do not claim this design or a local pure test is runtime proof.
7. **V-SERVED:** use authorized isolated native fixtures to verify saved
   structured counters, command/source provenance, no-test/conflict handling,
   failure recovery and reload. Record actual evidence before completion.

Expected implementation surface is the existing
`apps/web/lib/build/deterministic-build-verification.ts` and its tests,
`coding-agent.ts` and its tests only where runner contract changes require it,
and `build-orchestrator.ts` and its tests for actual integration. Claim exact
paths and consume the change-impact contract before editing product source.
No separate plan document is required for this medium fix; record and check
live plan coverage against this immutable design's ordered work.

## Compatibility, risk and rollback

No migration. Keep old records auditable and never relabel them as a new
execution. Preserve compatible fields; existing normalized unknown/low
confidence and applicability semantics must remain explicit. Do not globally
require tests for docs, type-only or legitimately exempt changes.

The principal risk is either falsely admitting required tests or blocking
legitimate no-test work. The regression matrix must cover both. A second risk
is reading unrelated WIP; git fixtures and actual isolated-root wiring cover
it. Revert the bounded code change through normal protected delivery if it
regresses those contracts; retain failure evidence and never restore false
positive qualification as a workaround.

## Boundaries and current authority

BI-5D2E6F71 diagnostic repair, BI-E492F313 lifecycle recovery and BI-C51C266A
review routing remain separately owned. No Finance data, expense, payment,
contact, mailbox, grant, credential, source-enrollment policy or container work.

The prior source hold and unsuccessful research writes remain in the audit.
After genuine canonical run SUR-774AD7B6, normal doc-only edit scope was
accepted in release epoch `7289ee84-4ce9-4aca-9230-ca154a18eeb0`. This permits
design authoring; actual research, plan and implementation gates still apply.
The managed preparation draft DOC-04BAE62B is superseded by this repository
design when this source is recorded, not an independent approval.
