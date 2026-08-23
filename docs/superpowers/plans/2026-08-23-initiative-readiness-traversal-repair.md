---
status: draft
---

# Initiative readiness traversal repair implementation plan

**Backlog item:** BI-F0715C9C  
**Workroom:** WC-2ABA65F7  
**Design:** `docs/superpowers/specs/2026-08-23-initiative-readiness-traversal-repair-design.md`

## Delivery contract

The repair has five testable slices: profile/policy, actionable reviewer
routing, organization-bound reviewer authority, provider-verified Workroom
reconciliation, and existing-Workroom replay. Production implementation starts
only after governed implementation intent is allowed; design/plan work proceeds
under design intent.

This committed plan is intentionally pre-implementation. Its Red tests are
traceability commitments, not claims that production code or tests already
exist. The first code mutation occurs only after a fresh readiness decision
authorizes implementation intent.

## Traceability matrix

| Acceptance | Red test | Production surface |
|---|---|---|
| `AC-PROFILE-FIX`, `AC-PROFILE-MONOTONIC` | policy and adapter fixtures | `profiles.ts` |
| `AC-POLICY-DIFFERENT` | table-driven fix/feature/cross-domain tests | `evaluate.ts` and policy version |
| `AC-RECOVERY-ROUTE` | recovery resolver and claim-response tests | lane registry, recovery adapter, claim handler |
| `AC-REVIEW-SEPARATION` | external no-thread request tests and receipt separation tests | coworker pack -> `submitRemoteCoworkerTask` |
| `AC-SPEC-AUTHORITY` | authority writer and exact spec-approval traversal tests | subject derivation, authority decision log, baseline repository |
| `AC-HEAD-RECONCILE`, `AC-REPLAY` | provider, handler, capture/adopt tests | external evidence and external session capture |
| `AC-AUTHOR-AFTER-SYNC`, `AC-FAIL-CLOSED` | repository-artifact positive/negative fixtures | existing artifact resolver |

## Task 1 - Rebase and refresh Workroom scope

Fetch `origin/main`, follow the repository rebase runbook, preserve existing DCO
design commits, claim implementation/test/doc-index paths in WC-2ABA65F7, and
record a fresh change-impact contract before Red.

## Task 2 - Red/green profile derivation

1. Add a BI-A45D744A-shaped test: bug + small + platform derives `fix`.
2. Prove `common` is also ownership-neutral.
3. Prove recorded cross-domain still wins over current bug metadata.
4. Prove archetype and explicit cross-domain signals stay conservative.
5. Make only the scope projection change and run focused tests.

## Task 3 - Red/green policy v2

Using one all-missing fact fixture, prove:

- fix requires research and, for implementation, canonical plan evidence,
  dependency disposition, and capsule identity;
- feature adds design, spec approval, architecture, baseline/author, plan
  review, coverage, and traceability;
- cross-domain adds data, UX, security, compliance, and domain dispositions;
- archetype remains cross-domain plus provisioning/completeness;
- failed, malformed, stale, or projection-error evidence stays fail-closed.

Then encode additive profile builders and bump the decision version to
`initiative-readiness.v2`.

Refactoring allocation: centralize common requirements and additive profile
floors instead of copying arrays. This is part of the requested 20% refactoring
budget and may not broaden untested behavior.

## Task 4 - Red/green authority-aware recovery

1. Map each unmet accountable role to canonical receipt tool/grant.
2. Return only active, production, non-archived exact-grant agents.
3. Exclude the current author agent.
4. Return one escalation when no eligible agent exists.
5. Add recovery to unsuccessful claims without changing their verdict.
6. Centralize lane metadata in the existing initiative tool-grant module and
   make the receipt pack consume it.

## Task 5 - Red/green external reviewer dispatch

1. Keep in-portal calls with a real parent thread unchanged.
2. Require deterministic `requestKey` for external PAT/no-thread calls.
3. Delegate that branch to `submitRemoteCoworkerTask` with
   `riskClass=bounded-write`, explicit target agent, and caller agent null.
4. Prove read-only PAT denial, idempotent retry, and non-PAT missing-thread
   behavior.
5. Reuse existing TaskRun lifecycle, clearance, grants, and audit code.

## Task 6 - Red/green organization-bound reviewer authority

Before head reconciliation, repair the independently reproduced spec-approval
authority path:

1. Add `itemId` as a server-recognized backlog-item authority subject.
2. Resolve the BacklogItem organization server-side before the authority log is
   written; do not accept caller-supplied organization authority.
3. Prove an eligible independent reviewer receives a matching organization-bound
   allow decision and can traverse the existing spec-approval repository.
4. Prove missing item, missing organization, conflicting authenticated context,
   wrong reviewer grant, and author/reviewer collision remain denied.

## Task 7 - Red/green provider-verified head reconciliation

1. Explicit head plus matching provider branch passes SHA to capture.
2. A single full SHA in `commits` is inferred for compatibility.
3. Multiple commits without explicit head return an exact next action.
4. Provider unavailable, branch missing, mismatch, malformed SHA, and repo
   mismatch never pass a head to capture.
5. Evidence remains durable when head sync is unavailable.
6. Capture passes only verified head to adoption; reuse updates the existing
   Workroom.

Refactoring allocation: share canonical provider identity/header/full-SHA
helpers where contracts truly match. Keep branch-head verification separate
from blob/DCO verification because their failure semantics differ.

## Task 8 - Artifact-author and fail-closed integration

Start with a subject Workroom whose head is null. Reconcile it through external
evidence, resolve the immutable artifact/author, then repeat with mismatched
head, unsigned commit, conflicting DCO principal, ambiguous Workrooms, and
provider failure. No artifact-author relaxation belongs in production code.

## Task 9 - Verification and reviews

Run focused suites after every Red/Green slice, then related projection,
baseline, receipt, Workroom, coworker, MCP task/route, and external-evidence
suites; typecheck; blast-radius analysis; independent architecture review; UX
review of model-facing recovery copy; and `pnpm run pregate:preflight`.

## Task 10 - Governed publication

Commit with one DCO trailer, synchronize WC-2ABA65F7 to the stable commit,
obtain fresh independent semantic review, run shared-lease exact-tree local CI
and full pregate, push only green reviewed SHA, open a ready PR, read bot
findings, run `pnpm pr:health`, and use the protected merge queue. Verify the
live install before closing BI-F0715C9C.

## Task 11 - Existing blocked-Workroom recovery proof

After merge/live deployment:

1. Do not rewrite `fix/wordpress-operator-regressions`.
2. Replay `record_external_development_evidence` for BI-A45D744A and
   WC-E8275570 with branch, worktree, commits, and explicit
   `headSha=6b4ea6b906836b8e67b2afa53cf2aab25fdf03b1`.
3. Confirm provider match and exact Workroom head.
4. Re-read readiness; absent stronger approved history, it must derive `fix`.
5. Follow returned recovery for remaining research/plan evidence and dispatch
   the named eligible agent; never borrow its grant.
6. Re-claim implementation and confirm only fix obligations remain.
7. Continue the WordPress task through its own tests, semantic review, pregate,
   exact-tree CI, PR health, and merge. Never proxy the old missing receipts.

Then replay the reviewer route for `BI-D2A51B36` / `WC-B0DD2B2F` at immutable
head `49140d33a9f7c2d62abcf1ffc28e0fbff50b1203`. Confirm readiness recommends an
exact eligible agent and that threadless dispatch creates an auth-bound TaskRun
rather than returning `missing_threadId` or opening a default coworker. Preserve
manual-check evidence `cmt5b0dy006gd01rmfykifyq3` in the audit trail, and notify
the owning task only after the protected repair is merged and verified live.
