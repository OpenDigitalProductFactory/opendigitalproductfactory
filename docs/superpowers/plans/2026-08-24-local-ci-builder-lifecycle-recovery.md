# Local-CI Builder Lifecycle Recovery Implementation Plan

- **Status:** independent spec approval complete; plan-coverage receipt pending
- **Date:** 2026-08-24
- **Backlog item:** `BI-B131F357`
- **Architecture:** `docs/superpowers/specs/2026-08-24-local-ci-builder-lifecycle-recovery-design.md`
- **WWMD decision:** `DI-308054F94780` (`bounded-transition`)
- **Workroom:** `WC-DD1EF64C`
- **Spec-approval receipt:** `initiative-cb7780d2-bcaf-4d85-afbe-0eb6c41d3a17`
- **Scope baseline:** `baseline-6d23cd68-5db5-4ac4-91f0-ac20c6b71389`
- **Backlog coverage receipt:** recorded in the live backlog after this immutable
  plan revision is committed

## Backlog coverage

- Decision: atomic
- Parent: `BI-B131F357`
- Deliverable: bounded builder recovery, fail-fast placement, production-build
  revalidation, structured lifecycle evidence, and truthful pregate status ->
  `BI-B131F357`
- Dependencies: none
- Immutable plan attempted: commit
  `544830a220adbda0570da17e391dabd0d429b1fc`, provider blob
  `5c1b7349c2848f6676ea8e4e075105b6526bb144`
- Receipt: pending the immutable commit containing this traceability correction
- Prior observed blocker: `BI-91AF30A5` — the first external-client attempt did
  not invoke the documented independent reviewer-coworker path

The provider first rejected the plan because the install's stored
`github-pr-sync` credential was invalid. After that development credential was
rotated through the install's encrypted credential store, the provider verified
the signed commit and exact blob. The recorder then returned
`traceability-incomplete`: `BI-B131F357` has no `initiative_scope_baseline`, and
the baseline writer is not reachable from an MCP session.

The error prescribed citing `BI-B9403248`, but live `get_backlog_item` returned
`not_found` for that ID. That remains defect evidence, not a receipt. The
documented paved road was followed: the independently identified reviewer
coworker reviewed the immutable design, recorded spec approval, and thereby
created the scope baseline. No failed call, Markdown marker, or absent
blocker ID is represented as a coverage receipt, and source implementation does
not start until a valid receipt is written and revalidated.

The independent Change Reviewer recorded spec-approval receipt
`initiative-cb7780d2-bcaf-4d85-afbe-0eb6c41d3a17`, which atomically created
scope baseline `baseline-6d23cd68-5db5-4ac4-91f0-ac20c6b71389` for the approved
design. The atomic deliverable traces to every baseline objective and acceptance
statement:

- Requirements: `OBJ-LCBLR-001`, `OBJ-LCBLR-002`, `OBJ-LCBLR-003`,
  `OBJ-LCBLR-004`
- Contract: `local-ci-builder-lifecycle.mjs`
- Flow: `Move builder discovery ahead of expensive verification`
- Verification: `AC-LCBLR-001`, `AC-LCBLR-002`, `AC-LCBLR-003`,
  `AC-LCBLR-004`, `AC-LCBLR-005`, `AC-LCBLR-006`, `AC-LCBLR-007`

## Outcome

Make the currently enforced local-CI Docker gate recover safely from stale
Buildx registration metadata, discover builder blockers before expensive tests,
and give the operator a truthful next action when automatic recovery cannot
restore the governed builder.

## Atomic delivery decision

This is one compatibility-hardening boundary under `BI-B131F357`. Automatic
recovery without fail-fast placement still wastes the exhaustive suite when
recovery fails. Early preflight without production-build revalidation leaves a
time-of-check/time-of-use gap. Structured failure metadata without reader changes
continues to recommend blind retries. The lifecycle, plan placement, evidence,
and status-reader changes therefore ship together.

The separate migration from local heavy verification to the cloud is not part of
this atomic unit.

## 1. Specify lifecycle classification as pure behavior

### Files

- modify `scripts/lib/local-ci-builder-lifecycle.mjs`
- modify `scripts/lib/local-ci-builder-lifecycle.test.mjs`

### Red-green sequence

1. Add failing tests that classify a missing expected container separately from
   generic inspection failure and resource drift.
2. Add failing tests for the bounded actions: create when absent, recover once
   when registration is stale, keep when valid, and fail closed otherwise.
3. Implement the smallest pure classifier/action contract that makes the tests
   pass. Keep Docker process execution outside the pure module.

## 2. Harden bounded-builder preflight and its evidence

### Files

- modify `scripts/local-ci-bounded-build.mjs`
- modify `scripts/local-ci-bounded-build.test.mjs`
- modify `scripts/lib/local-ci-bounded-builder.mjs` if an argument helper is needed
- modify `scripts/lib/local-ci-bounded-builder.test.mjs` with any helper change

### Red-green sequence

1. Add failing tests for a preflight-only invocation and for the exact managed
   `buildx rm` then `buildx create` recovery sequence.
2. Prove that recovery happens only for a missing-object classification, only for
   the configured managed builder, and at most once.
3. Add failing tests for stable `failureClass`, `failureFingerprint`,
   `recoveryAction`, and `retryable` metadata after recovery exhaustion, generic
   inspection failure, and resource drift.
4. Implement `--preflight-only`; it performs control-plane health checks and
   bounded-builder validation/recovery but never starts an image build.
5. Replace the historical receipt backlog ID with a stable contract identifier.

## 3. Move builder discovery ahead of expensive verification

### Files

- modify `scripts/lib/local-integration-ci.mjs`
- modify the existing local-integration plan tests that own command ordering
- modify `scripts/local-integration-ci.mjs`
- modify its existing receipt/metadata tests

### Red-green sequence

1. Add a failing plan test proving that `docker-build` inserts
   `local-ci-bounded-build.mjs --preflight-only` before typecheck and Vitest, and
   that host builds do not.
2. Add a failing test proving the production build still performs its own
   preflight and remains last.
3. Add a failing provenance assertion for the stable integration contract ID.
4. Implement the command placement without changing merge, freshness, generated
   client, doc-guard, typecheck, test, or production-build semantics.

## 4. Make the authoritative status reader truthful

### Files

- modify `scripts/lib/pregate-status.mjs`
- modify `scripts/lib/pregate-status.test.mjs`
- update `docs/testing/pre-pr-gate.md` if its operator contract changes

### Red-green sequence

1. Add a failing test that a non-retryable builder-lifecycle receipt produces a
   `BLOCKED` verdict with the recorded recovery action.
2. Add a failing reconciliation test proving an exact-HEAD `PASS` still wins over
   a sibling slot's `BLOCKED` record.
3. Add a failing rendering test proving `BLOCKED` does not print the generic
   `pnpm run pregate` instruction.
4. Preserve current guidance for stale records, pending evidence, and retryable
   lease outcomes.
5. Implement the reader-only classification and render changes. Do not infer a
   lifecycle blocker from log text.

## 5. Verify the compatibility boundary

1. Run the touched Node test files and record the expected red-to-green sequence.
2. Run all local-CI/pregate-status script tests.
3. Run documentation links/index checks and repository guards.
4. Run typecheck and affected tests according to the current pre-push contract.
5. Run blast-radius checks for receipt/status consumers and Buildx lifecycle
   callers.
6. Run the exact-tree gate once. If external builder infrastructure blocks it,
   preserve the receipt and report the infrastructure failure without claiming a
   passing gate.
7. Record Workroom evidence, obtain independent semantic review, and ship through
   a DCO-signed PR only when the governed gates permit it.

## Rollback

Revert the source commit. No data migration or persistent runtime state is added.
A builder registration recreated by the compatibility path remains governed by
the pre-existing policy and can be stopped or reaped by the existing lifecycle
commands.
