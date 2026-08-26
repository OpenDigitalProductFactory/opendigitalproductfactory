---
status: active
---

# Initiative readiness traversal repair implementation plan

**Backlog item:** BI-F0715C9C
**Workroom:** WC-7FF8A505
**Branch:** `fix/initiative-readiness-traversal-recovery`
**Recovery base:** `f20a78f63dc1884eea0fc171d04556b4be8de32f`
**Design:** `docs/superpowers/specs/2026-08-23-initiative-readiness-traversal-repair-design.md`

> **For agentic workers:** execute this plan one independently reviewable backlog
> item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green
> implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate
> before any success claim, and `dpf-pr-with-dco` for handoff.


## Delivery contract

The repair has seven testable slices: universal policy-authority projection,
profile/policy, actionable reviewer routing, server-derived reviewer
authority, provider-verified Workroom reconciliation, existing-Workroom replay,
and bounded plan-coverage persistence.
Production implementation starts only after governed implementation intent is
allowed by the deployed policy bridge or by the ratified one-time
first-deployment repository envelope in the design; design/plan work proceeds
under design intent.

This committed plan is intentionally pre-implementation. Its Red tests are
traceability commitments, not claims that production code or tests already
exist. The first production/test mutation occurs only after the exact
post-amendment operator ratification makes the one-time envelope effective.

## Traceability matrix

Every path below was resolved against the tree at `origin/main`; none is assumed.

| Acceptance | Task | Red test | Production surface |
|---|---|---|---|
| `AC-PROFILE-FIX`, `AC-PROFILE-MONOTONIC` | 2 | `initiative-readiness-policy.test.ts` profile cases | `apps/web/lib/backlog/initiative-readiness/profiles.ts` |
| `AC-POLICY-DIFFERENT` | 3 | table-driven fix/feature/cross-domain cases in the same suite | `apps/web/lib/backlog/initiative-readiness/evaluate.ts` |
| `AC-RECOVERY-ROUTE` | 4 | recovery resolver and claim-response tests | initiative tool-grant lane registry, recovery adapter, claim handler |
| `AC-UI-TARGET` | 4 | exact-target and stale-target launcher tests | recovery action / coworker launcher component |
| `AC-REVIEW-SEPARATION` | 5 | external no-thread request and receipt-separation tests | coworker pack -> `apps/web/lib/mcp-task-submit.ts` |
| `AC-SPEC-AUTHORITY` | 6 | authority-writer and exact spec-approval traversal tests | `apps/web/lib/govern/authority/resolve-coworker-tool-authority.ts`, `.../coworker-tool-authority-gate.ts`, `.../initiative-readiness/baseline-repository.ts` |
| `AC-RECEIPT-FRESHNESS` | 7 | pre-baseline and post-baseline supersession tests | `apps/web/lib/backlog/initiative-readiness/entry-adapter.ts` |
| `AC-HEAD-RECONCILE`, `AC-REPLAY` | 8, 13 | provider, handler, capture/adopt tests | `apps/web/lib/work-capsules/external-session-capture.ts`, `.../work-capsule-store.ts` (`adoptWorktreeCapsule`) |
| `AC-AUTHOR-AFTER-SYNC`, `AC-FAIL-CLOSED` | 9 | `repository-artifact.test.ts` positive/negative fixtures | `apps/web/lib/backlog/initiative-readiness/repository-artifact.ts` |
| `AC-COVERAGE-TX` | 10 | slow-preflight, five-mapping commit, stale-binding, and transaction-expiry tests | `apps/web/lib/planning/plan-backlog-coverage.ts` (`recordPlanBacklogCoverage`) |
| `AC-POLICY-BRIDGE-YES`, `AC-POLICY-BRIDGE-DENY` | 4A | affirmative, non-affirmative, signal-quality, conflict, and owning-gate fixtures | policy-authority projector (new), `AuthorizationDecisionLog`, `CoworkerActionEnvelope` |
| `AC-POLICY-BRIDGE-SCOPE`, `AC-POLICY-NOT-RBAC`, `AC-POLICY-RECOVERY` | 4A | policy/delegation/artifact/expiry/replay, direct-DI prohibition, and exact-route tests | `apps/web/lib/govern/authority/coworker-tool-authority-gate.ts`, `DelegationGrant`, envelope lifecycle, readiness recovery |
| `AC-FIRST-DEPLOY-WARRANT`, `AC-FIRST-DEPLOY-INDEPENDENCE`, `AC-FIRST-DEPLOY-CONSUME` | 0, 12 | immutable bootstrap-contract, drift/revocation/replay, exact-tree review, branch-rule, and merge-consumption evidence | design/plan documents, Workroom audit, DCO/review/pregate/PR boundary |

## Backlog coverage

- Decision: atomic
- Parent: `BI-F0715C9C`
- Receipt: `cmt6xp5k2000c51kpdb76su1t`
- Rationale: The five sequencing groups alter one fail-closed readiness contract; deploying any group independently would leave implementation authorization or recovery traversal incomplete.
- Dependencies: none outside the five ordered mappings below

### Atomic coverage projection

These five mappings are sequencing groups within one atomic repair, not
independently shippable deliverables. They change one readiness contract and
must deploy together: shipping any group alone would leave the governed
implementation path fail-closed or would expose an incomplete recovery path.

| Mapping | Objective requirements | Acceptance verification | Depends on |
|---|---|---|---|
| `policy-profile` | `OBJ-IRT-001` | `AC-PROFILE-FIX`, `AC-PROFILE-MONOTONIC`, `AC-POLICY-DIFFERENT` | none |
| `recovery-review` | `OBJ-IRT-002`, `OBJ-IRT-003` | `AC-RECOVERY-ROUTE`, `AC-UI-TARGET`, `AC-REVIEW-SEPARATION`, `AC-REVIEWER-READ` | `policy-profile` |
| `authority-freshness` | `OBJ-IRT-004` | `AC-SPEC-AUTHORITY`, `AC-RECEIPT-FRESHNESS`, `AC-FAIL-CLOSED`, `AC-POLICY-BRIDGE-YES`, `AC-POLICY-BRIDGE-DENY`, `AC-POLICY-BRIDGE-SCOPE`, `AC-POLICY-NOT-RBAC`, `AC-POLICY-RECOVERY` | `recovery-review` |
| `reconciliation-coverage` | `OBJ-IRT-005` | `AC-HEAD-RECONCILE`, `AC-AUTHOR-AFTER-SYNC`, `AC-REPLAY`, `AC-COVERAGE-TX` | `authority-freshness` |
| `bootstrap-shipping` | `OBJ-IRT-006` | `AC-FIRST-DEPLOY-WARRANT`, `AC-FIRST-DEPLOY-INDEPENDENCE`, `AC-FIRST-DEPLOY-CONSUME` | `reconciliation-coverage` |

### Governed planning evidence

- Canonical design artifact: commit
  `8ba87200bfc093a6ebd981f6c1923a33a3c6428f`, provider blob
  `1cdc523f5552f7d366d746ce55224addf41815b4`.
- Independent research receipt:
  `initiative-8042dea2-327d-4a67-9b64-109c6752805c`.
- Independent spec-approval receipt:
  `initiative-5eab8246-8bc5-4a41-8e28-36669796a538`.
- Canonical scope baseline:
  `baseline-acd3d154-8d63-4939-9382-4318f7bf045e`.
- Atomic plan-coverage artifact: commit
  `eb792d235c9da8d64ec6606aeb46cd99d99341fd`, provider blob
  `5482400611e2a3306b049c83bba1ad0ae2cc1b2e`.
- Atomic plan-coverage receipt: `cmt6xp5k2000c51kpdb76su1t`.

The receipt is bound to the immutable pre-receipt plan artifact above. This
evidence section records the resulting identities; it does not rewrite or
proxy that receipt.

### Receipt liveness — verified 2026-08-26

`check_plan_backlog_coverage` against the identities above returns
**`receipt-not-found`**:

```
itemId=BI-F0715C9C
planPath=docs/superpowers/plans/2026-08-23-initiative-readiness-traversal-repair.md
receiptId=cmt6xp5k2000c51kpdb76su1t
-> { "error": "receipt-not-found" }
```

**Cause, from `WC-7FF8A505` activity `cmt6xr47b0kjd01mxtemerijv`:** the receipt was
minted on a **non-production preview lease**, `NPEL-0583244D50`, against the
repaired writer — `command: "27B research/spec approved replay;
record_plan_backlog_coverage via preview /api/mcp/v1"`. The same run produced
research receipt `initiative-8042dea2-…`, spec-approval receipt
`initiative-5eab8246-…`, and baseline `baseline-acd3d154-…`.

This is not a database reset: `WC-2ABA65F7` and `WC-7FF8A505` both still resolve.
The receipt simply never existed in the canonical runtime. AGENTS.md §1 is explicit
that the canonical runtime is the only source of runtime truth; a preview-minted
receipt is not runtime truth, and the other three identities above are open to the
same question.

Two consequences worth separating:

1. **The record above stays.** These are the real historical identities the
   delivery was reviewed and merged against; deleting them would destroy audit
   history. They are recorded as history, not asserted as current state.
2. **The CI gate does not catch this.** `check-plan-backlog-coverage.mjs`
   regex-matches that a `Receipt:` line exists and is not `pending`/`none`/`n/a`.
   It never asks the substrate whether the receipt resolves, and it cannot tell a
   production receipt from a preview one. A plan citing a non-production receipt
   therefore passes the gate — the same class of defect this design exists to fix:
   evidence that *projects* as satisfied without being verified.
   `check_plan_backlog_coverage` is the tool that would close it, and calling it
   from the gate is the smallest repair.

3. **This warrants its own backlog item.** Preview-minted governance receipts
   reaching a merged plan is a governance-substrate defect, not a documentation
   defect, and it is out of scope for a repair that has already shipped.

Re-minting is currently impossible: `record_plan_backlog_coverage` is uncallable
(`BI-CC9D5997`, claimed on `WC-C3B828AE`). Do not replace the identities above with
a hand-written value — that is the substitution the design forbids.


## Delivery status

Recorded 2026-08-26 from live state. **This plan has been executed.** PR
[#4633](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/4633)
merged `ddd1ae31e` to `main` on 2026-08-24, DCO-signed by Mark Bodman, carrying
Tasks 2–10 as one contribution. Read the task list below as the record of what was
built, not as outstanding work.

| Task | State | Evidence |
|---|---|---|
| 0 — policy-authority boundary | resolved | Envelope never consumed; the human root authored and signed the contribution directly. |
| 1 — rebase / Workroom scope | done | — |
| 2 — profile derivation | **live** | `profiles.ts` on `main`; `BI-F0715C9C` derives `fix` under `v2`. |
| 3 — policy v2 | **live** | `INITIATIVE_READINESS_POLICY_VERSION = "initiative-readiness.v2"` on `main` and in live readiness decisions. |
| 4 — authority-aware recovery | **live, with a regression** | Shipped; PR #4641's lane row caused `BI-CC9D5997`. |
| 4A — policy-authority bridge | **live** | `policy-authority-projector.ts`, `resolve-policy-action-authority.ts` on `main`. |
| 5 — external reviewer dispatch | **live** | `mcp-task-submit.ts` +376 lines in #4633. |
| 6 — organization-bound authority | **live** | `authority-subject.ts`, `coworker-authority-decision.ts` on `main`. |
| 7 — receipt freshness | **live** | `entry-adapter` / `baseline-repository` changes in #4633. |
| 8, 9 — head reconciliation, artifact author | **live** | `external-session-capture.ts`, `repository-artifact.test.ts` in #4633. |
| 10 — bounded plan coverage | **live** | `plan-backlog-coverage.ts` +79 lines in #4633. |
| 11, 12 — verification, publication | done | 34 checks green through the protected merge queue. |
| 13 — blocked-Workroom recovery proof | **outstanding** | Post-merge replay for `WC-E8275570`, `WC-B0DD2B2F`, `WC-A31DBE53` not recorded here. |

### What this plan does not cover

Acceptance 20 and 21 on `BI-F0715C9C` were added on 2026-08-25 and concern the
**completion** lane — delivered work that cannot reach `done`. No task below
addresses them; see the design's Delivery status section. They need a successor
plan, and `BI-CC9D5997` is a prerequisite because `PLAN_REQUIRED` cannot clear
while the coverage writer is unreachable.

## Risks and rollback

Every slice is additive against existing modules, so rollback is per-slice revert
plus one policy-version decision. The ordering below is chosen so that no slice
can land in a state where readiness is *weaker* than `initiative-readiness.v1`.

| Risk | Blast radius | Detection | Rollback |
|---|---|---|---|
| Profile derivation (Task 2) under-classifies real cross-domain work | Every open BI with `scopeKind=platform` or `common` re-derives on next claim; a genuinely coupled change could enter implementation on `fix` obligations | Re-run readiness against the live backlog before merge and diff derived profiles against the recorded ones; any BI that *drops* a profile without a recorded stronger signal is the finding | Revert `profiles.ts` alone. The change is one function and carries no persisted state — derivation is recomputed per claim. |
| Policy `v2` (Task 3) removes an obligation that was load-bearing | Every claim evaluated after deploy | Decision rows carry `policyVersion`; compare `v1` and `v2` verdicts over the last 30 days of claims before merge | Revert `evaluate.ts` and pin `INITIATIVE_READINESS_POLICY_VERSION` back to `v1`. Receipts are version-stamped and stay valid. |
| Bridge (Task 4A) projects an authorization it should not | The widest risk in this plan — an incorrect projection authorizes a real action | `AC-POLICY-BRIDGE-DENY` and `AC-POLICY-BRIDGE-SCOPE`; every projection appends an `AuthorizationDecisionLog` row citing its `DecisionInteraction`, so a bad projection is queryable, not silent | Revoke outstanding envelopes (existing lifecycle), then revert the projector. Nothing consumed the projection irreversibly except an already-merged PR, which the repository boundary independently gated. |
| Threadless dispatch (Task 5) lets a read-only PAT trigger a write | External identities | Task 5 step 4 proves read-only PAT denial explicitly | Revert the adapter branch; portal calls are untouched by construction. |
| Organization binding (Task 6) blocks a subject kind that used to work | Any caller of the generic authority gate, not just readiness | Only `itemId` gains a resolver; §5 keeps other subject kinds on current behavior — assert that with a regression test over existing callers before merge | Revert the subject-derivation change. |
| Head reconciliation (Task 8) adopts a wrong head | One Workroom per call | Provider branch-head equality is the precondition; `adoptWorktreeCapsule` records old and new heads | Replay evidence with the correct SHA — adoption is idempotent and the old head is in the audit trail. |
| Coverage transaction restructure (Task 10) moves a check outside the lock | Plan coverage receipts | Task 10 step 5 proves head/owner/baseline/mapping races still fail closed with no create call | Revert `plan-backlog-coverage.ts`; the pre-existing behavior is a timeout, not corruption. |

Two risks have no clean rollback and are therefore gated, not mitigated:

- **The first-deployment envelope (Task 0).** Once consumed by a protected merge
  it cannot be un-consumed. This is why it is single-use, path-confined,
  72-hour-bounded, and requires independent exact-tree review — the envelope's
  constraints *are* the rollback plan.
- **Live recovery replay (Task 13).** It runs only after merge and verification,
  touches Workroom heads through the same idempotent adoption path, and never
  rewrites `fix/wordpress-operator-regressions`.

Standing prohibition for every rollback path: no direct database edit, no
fabricated receipt, no relabelled design mutation. A rollback that needs one of
those is not a rollback.

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
4. Preserve `DI-053D69EADEDC` as the bridge architecture decision,
   `DI-568FF23AF27B` as the canonical first-deployment authorizer decision, and
   `DI-5B6BF3990A83` as its corroborating architecture-local comparison.
   Preserve abstained `DI-ECE6A1FCFFCA` and superseded
   `DI-F7361DD540E2` as non-authorizing audit history.
5. Publish and independently review the amended design/plan exact tree. Then
   return the design's exact ratification text filled with the immutable base,
   commit, design blob, and plan blob. The earlier `go` is not sufficient.
6. Prove the governed persistence path before requesting activation. The audit
   currently finds no callable writer that atomically binds the DI, standing
   policy, human ratification, exact subject/action/artifacts, expiry,
   revocation, and consumption. `record_workroom_evidence` is evidence only;
   the generic authority-log helper is not an action-specific projector; the
   current approval envelope is a 15-minute human exact-tool proposal with no
   source-implementation binding.
7. After the operator ratifies the proven path, persist its immutable
   authorization identity and record a Workroom pointer to that identity,
   instruction, and timestamp. The envelope expires 72 hours later at the
   latest. Verify the repository/branch/base/artifacts and permitted path/action
   set before the first Red mutation.
8. Keep the normal implementation claim and its denial visible; do not mark it
   allowed or fabricate receipts. The external repository envelope authorizes
   only the first-deployment authorship needed to create the canonical bridge.
9. If the persistence path is unproven, ratification is
   absent/revoked/expired, a judgment is non-affirmative, a
   policy floor requires a distinct human unavailable on this install, or any
   binding drifts, stop with the exact reason. Do not use direct
   DecisionInteraction reads, an AI or second-human proxy, superuser execution,
   direct DB writes, or the null-organization spec-approval writer.

The current live audit reaches step 6. Existing governed writers can assemble
and audit the DI, Workroom, DCO, review, check, and merge evidence but none can
currently persist the complete linked authorization for repository
implementation. The proposed external repository envelope remains inactive
until its exact activation/persistence path is proven and ratified. GitHub
currently requires zero approving reviews, so independent governed exact-tree
review is explicit and may not be inferred from the merge queue.

## Task 1 - Rebase and refresh Workroom scope

Fetch `origin/main`, follow the repository rebase runbook, preserve existing DCO
design commits, claim implementation/test/doc-index paths in WC-7FF8A505, and
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
floors instead of copying arrays. The design's budget is ~80% refactor of existing
substrate; the retired 80/20 feature-first split
(`docs/design/golden-triangle-design.md:654`) does not apply. Refactoring may not
broaden untested behavior.

## Task 4 - Red/green authority-aware recovery

1. Map each unmet accountable role to canonical receipt tool/grant.
2. Return only active, production, non-archived exact-grant agents.
3. Exclude the current author agent.
4. Return one escalation when no eligible agent exists.
5. Add recovery to unsuccessful governed claims without changing their verdict,
   and prove `claim-backlog-item-handler.ts` preserves the complete recovery
   object in the MCP `initiative_not_ready` result.
6. Return an executable `request_coworker` packet from the canonical recovery
   producer. It must contain the exact target `agentId`, deterministic
   `requestKey`, `objective`, `questionPacketSummary`, `tier=2`,
   `enteredVia=handoff`, BI, Workroom, gate, and immutable artifact identity.
   Missing or stale bindings return an exact escalation and never dispatch.
7. Preserve the recommended canonical `agentId` through any recovery launcher;
   stale targets fail visibly and refresh, never fall back to a default agent.
8. Centralize lane metadata in the existing initiative tool-grant module and
   make the receipt pack consume it.
9. When policy authority cannot be projected, return the exact owning WWMD,
   WWWD, or WSID evaluation/escalation packet. When the remaining gap is an
   independent receipt, return the exact eligible reviewer route. Neither path
   is a receipt or a grant.
10. Prove every unmet requirement appears as an executable next action or one
    explicit escalation; the MCP adapter may not drop recovery and the caller
    may not construct missing packet fields out of band.

## Task 4A - Red/green universal policy-authority bridge

This task may begin only after Task 0 yields either a scoped implementation
authorization through the deployed governing policy path or an effective,
unexpired one-time first-deployment envelope. The latter never changes the
failed readiness claim and is consumed by the protected merge.

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
5. Red-test that an immediate `sideEffect=false` immutable read does not require
   a per-call HITL envelope solely because the target coworker's coarse approval
   policy is `all`; keep proposal execution and every side-effecting action
   approval-gated.
6. Reuse existing TaskRun lifecycle, clearance, grants, and audit code.

## Task 6 - Red/green server-derived reviewer authority

Before head reconciliation, repair the independently reproduced spec-approval
authority path:

1. Add `itemId` as a server-recognized backlog-item authority subject.
2. Resolve authority scope from the BacklogItem server-side before the authority
   log is written; do not accept caller-supplied organization authority. An
   organization-bound item requires an authenticated exact tenant match. An
   organizationless platform item retains its exact backlog-item subject and
   uses the existing non-tenant authority-scope sentinel
   `organizationId="platform"`.
3. Prove an eligible independent reviewer receives the matching server-derived
   allow decision and can traverse the existing spec-approval repository for
   both tenant-bound and platform-scoped items.
4. Prove missing item, missing authenticated organization for a tenant-bound
   item, conflicting tenant context, a real/mismatched organization asserted
   for a platform item, wrong reviewer grant, and author/reviewer collision
   remain denied.

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

Repeat the exact preview claim for BI-F0715C9C/WC-7FF8A505. Its MCP result must
retain `recovery` and the exact packet without changing the fail-closed verdict.
Repeat responsive inspection only to preserve evidence for existing
BI-812AC0D8, which remains a blocking dependency for any claim of multi-surface
readiness UX completion; this repair does not add unratified portal paths.

## Task 12 - Governed publication

Commit with one DCO trailer, synchronize WC-7FF8A505 to the stable commit,
obtain fresh independent semantic review, run shared-lease exact-tree local CI
and full pregate, push only green reviewed SHA, open a ready PR, read bot
findings, run `pnpm pr:health`, and use the protected merge queue. Verify the
live install before closing BI-F0715C9C. Before merge, prove the bootstrap
envelope is still bound, unexpired, unrevoked, and path-confined. Protected
merge consumes it; record that consumption and reject any replay.

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
