---
status: draft
---

# Initiative readiness traversal repair implementation plan

**Backlog item:** BI-F0715C9C  
**Workroom:** WC-2ABA65F7  
**Design:** `docs/superpowers/specs/2026-08-23-initiative-readiness-traversal-repair-design.md`

## Delivery contract

The repair has seven testable slices: universal policy-authority projection,
profile/policy, actionable reviewer routing, organization-bound reviewer
authority, provider-verified Workroom reconciliation, existing-Workroom replay,
and bounded plan-coverage persistence.
Production implementation starts only after governed implementation intent is
allowed; design/plan work proceeds under design intent.

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
| `AC-UI-TARGET` | exact-target and stale-target launcher tests | recovery action / coworker launcher |
| `AC-REVIEW-SEPARATION` | external no-thread request tests and receipt separation tests | coworker pack -> `submitRemoteCoworkerTask` |
| `AC-SPEC-AUTHORITY` | authority writer and exact spec-approval traversal tests | subject derivation, authority decision log, baseline repository |
| `AC-RECEIPT-FRESHNESS` | pre-baseline and post-baseline supersession tests | readiness entry adapter / receipt projection |
| `AC-HEAD-RECONCILE`, `AC-REPLAY` | provider, handler, capture/adopt tests | external evidence and external session capture |
| `AC-AUTHOR-AFTER-SYNC`, `AC-FAIL-CLOSED` | repository-artifact positive/negative fixtures | existing artifact resolver |
| `AC-COVERAGE-TX` | slow-preflight, five-mapping commit, stale-binding, and transaction-expiry tests | plan coverage recorder and repository binding recheck |
| `AC-POLICY-BRIDGE-YES`, `AC-POLICY-BRIDGE-DENY` | affirmative, non-affirmative, signal-quality, conflict, and owning-gate fixtures | policy-authority projector, decision ledger, authorization log/envelope |
| `AC-POLICY-BRIDGE-SCOPE`, `AC-POLICY-NOT-RBAC`, `AC-POLICY-RECOVERY` | policy/delegation/artifact/expiry/replay, direct-DI prohibition, and exact-route tests | governed authority gate, delegation, envelope lifecycle, readiness recovery |

## Task 0 - Establish the policy-authority boundary

Before any production source or test mutation:

1. Commit and publish this design/plan-only tree with DCO.
2. Record `DI-053D69EADEDC` and Workroom evidence
   `cmt5wqbft0j8c01rm8l54p0g5` as the selected architecture decision, including
   signal quality and contribution evidence. Mark the earlier
   `DI-F7361DD540E2` two-human bootstrap recommendation superseded, without
   deleting it.
3. Bind the design-only commit, design blob, plan blob, BI, Workroom,
   repository, and branch in durable Workroom evidence. Do not treat that
   evidence as implementation authority or an initiative receipt.
4. Resolve the owning WWMD evaluation for the exact BI-F0715C9C production
   implementation envelope. The action is allowed only if the deployed bridge
   can project a current, explicit, autonomy-eligible affirmative judgment into
   the existing scoped authorization substrate.
5. If the bridge is unavailable, or the judgment is no/defer/escalate,
   ambiguous, stale, or advisory-only, stop and return that exact reason and
   owning decision route. Do not use direct DecisionInteraction reads, a
   second-human proxy, an AI reviewer, superuser execution, direct DB writes,
   or the null-organization spec-approval writer.

The current live audit reaches step 5. `DI-053D69EADEDC` decides the bridge
architecture; it is not the production-action judgment, and the projector is
not deployed. The one-human roster proves the superseded per-work dual-approval
shape is non-traversable, but it does not weaken independent specialist review
or invalidate the human-rooted standing WWMD criteria.

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
6. Preserve the recommended canonical `agentId` through any recovery launcher;
   stale targets fail visibly and refresh, never fall back to a default agent.
7. Centralize lane metadata in the existing initiative tool-grant module and
   make the receipt pack consume it.
8. When policy authority cannot be projected, return the exact owning WWMD,
   WWWD, or WSID evaluation/escalation packet. When the remaining gap is an
   independent receipt, return the exact eligible reviewer route. Neither path
   is a receipt or a grant.

## Task 4A - Red/green universal policy-authority bridge

This task may begin only after Task 0 yields a scoped implementation
authorization through the governing policy path.

1. Add a pure, closed projector input that combines the server-resolved action
   binding with the sealed DecisionInteraction, current profile/version and
   promoter, signal-quality/contribution evidence, and active delegation.
2. Red-test all three owning gates. Only their registered affirmative option
   with usable, high, stable, strongly covered, autonomy-eligible,
   conflict-free signal may return `allow`; no/revise/defer/escalate/null,
   arbitrary text, and advisory recommendations deny or escalate.
3. Red-test human-rooted provenance and isolation: WWMD uses the approved
   platform criteria; WWWD and WSID resolve their own owner/profile and cannot
   inherit platform authority. Superseded policy versions, missing promoters,
   revoked/expired delegation, wrong organization/profession, and risk excess
   fail closed.
4. Append the existing `AuthorizationDecisionLog` and create or advance the
   exact `CoworkerActionEnvelope` transactionally. Record DI, profile/policy
   version, human provenance, evidence refs, scored options/weights digest,
   subject/action/artifact fingerprint, constraints, issue/expiry, and use
   limits. Reuse `DelegationGrant`/`DelegationChain`; add no table or grant.
5. Make governed execution consume only that projected, unexpired, matching
   authorization. Prove a DI id by itself grants nothing, the projector cannot
   satisfy a receipt or create a role/grant, and replay/artifact drift fails.
6. Add the exact recovery output for owning evaluation, human escalation, or
   independently eligible reviewer dispatch. Reuse existing decision and
   readiness surfaces; add no policy-specific top-level queue.

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

## Task 7 - Red/green receipt artifact freshness

1. Reproduce the live pre-baseline defect: an `e89f362` specialist receipt must
   not satisfy an `ad873ed` proposed design.
2. Derive the pre-baseline candidate digest only from the latest valid
   `design-spec` receipt.
3. Mark different-digest specialist receipts stale while retaining their audit
   rows.
4. Prove malformed/absent design-spec evidence is fail-closed and that an
   approved baseline digest remains authoritative after approval.

## Task 8 - Red/green provider-verified head reconciliation

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

## Task 9 - Artifact-author and fail-closed integration

Start with a subject Workroom whose head is null. Reconcile it through external
evidence, resolve the immutable artifact/author, then repeat with mismatched
head, unsigned commit, conflicting DCO principal, ambiguous Workrooms, and
provider failure. No artifact-author relaxation belongs in production code.

## Task 10 - Red/green bounded plan-coverage persistence

1. Reproduce WC-A31DBE53 with five valid mappings and a provider resolver that
   takes longer than five seconds; prove the delay occurs before the transaction
   callback starts.
2. Carry the resolved immutable plan identity plus exact capsule binding into
   the serializable callback.
3. Lock and revalidate subject, repository, head, owner, baseline, and mapped
   BacklogItems without provider/network work inside the transaction.
4. Prove the five mappings append one governed receipt within the default
   interactive transaction window.
5. Prove head/owner/baseline/mapping races, provider mismatch, and ambiguous
   Workrooms remain fail-closed with no create call.
6. Map Prisma transaction timeout/conflict to a typed retry action; never report
   it as plan-artifact-invalid or a partial success.

Refactoring allocation: split provider preflight from mutable binding
revalidation in the existing repository-artifact module. Reuse both halves in
the plan recorder; do not duplicate DCO or Workroom-selection rules.

## Task 11 - Verification and reviews

Run focused suites after every Red/Green slice, then related projection,
baseline, receipt, Workroom, coworker, MCP task/route, and external-evidence
suites; typecheck; blast-radius analysis; independent architecture review; UX
review of model-facing recovery copy; and `pnpm run pregate:preflight`.

## Task 12 - Governed publication

Commit with one DCO trailer, synchronize WC-2ABA65F7 to the stable commit,
obtain fresh independent semantic review, run shared-lease exact-tree local CI
and full pregate, push only green reviewed SHA, open a ready PR, read bot
findings, run `pnpm pr:health`, and use the protected merge queue. Verify the
live install before closing BI-F0715C9C.

## Task 13 - Existing blocked-Workroom recovery proof

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

Finally, replay coverage for `BI-79449954` / `WC-A31DBE53` with plan blob
`8f933b3c9312f0a3b2f01794f421ac4b9cace01e` and the same five mappings. Confirm
the receipt commits without holding provider I/O inside the transaction. Preserve
repair evidence `cmt5c515e07e101rmafeg61tg` and veterinary evidence
`cmt5c516h07e301rm7dkeokmu`; no direct database edit or fabricated receipt is a
valid recovery step.
