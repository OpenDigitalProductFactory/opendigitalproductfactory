---
status: active
---

# Initiative readiness traversal repair implementation plan

**Backlog item:** BI-F0715C9C
**Workroom:** WC-2ABA65F7
**Branch:** `fix/initiative-readiness-bootstrap`
**Design:** [`../specs/2026-08-23-initiative-readiness-traversal-repair-design.md`](../specs/2026-08-23-initiative-readiness-traversal-repair-design.md)

> **For agentic workers:** execute this plan one independently reviewable backlog
> item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green
> implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate
> before any success claim, and `dpf-pr-with-dco` for handoff.

## Delivery contract

The repair has nine testable slices:

| # | Slice | Task |
|---:|---|---|
| 1 | Universal policy-authority projection | 4A |
| 2 | Profile derivation | 2 |
| 3 | Per-profile requirement policy (`v2`) | 3 |
| 4 | Actionable reviewer routing and recovery | 4 |
| 5 | Threadless external reviewer dispatch | 5 |
| 6 | Organization-bound reviewer authority | 6 |
| 7 | Pre-baseline receipt freshness | 7 |
| 8 | Provider-verified Workroom reconciliation and artifact author | 8, 9 |
| 9 | Bounded plan-coverage persistence | 10 |

Existing-Workroom replay (Task 13) is post-merge recovery proof, not a build
slice. Production implementation starts only after governed implementation intent
is allowed by the deployed policy bridge or by the ratified one-time
first-deployment repository envelope in the design; design/plan work proceeds
under design intent.

### Branch state

The ratified design-only checkpoint is commit
`a537d7a1ebb19b40f9ccc1426d9fb62fc0312b89`. Source implementation began only
after the operator activated the one-time repository contribution envelope in
Workroom activity `cmt5xoo250jj401rm57xnzi6f`. Verify that the current patch is
confined to exact Workroom claims with:

```
git diff --name-only origin/main...HEAD -- apps packages
```

The command is now expected to list implementation files. Any path absent from
the current exact claims on `WC-2ABA65F7`, or any mutation of
`fix/wordpress-operator-regressions`, is a stop. The repository envelope remains
single-use and expires at `2026-08-26T15:00:06.989Z` or earlier on revocation,
protected merge, scope drift, or a failed required gate.

## Backlog coverage

`node scripts/check-plan-backlog-coverage.mjs` currently **fails** on this plan:
the canonical section below has no live receipt.

- Decision: *(pending — `record_plan_backlog_coverage`)*
- Parent: `BI-F0715C9C`
- Receipt: *(pending)*
- Dependencies: *(pending)*

This is not an oversight and must not be closed with a hand-written value.
`recordPlanBacklogCoverage` resolves the plan blob from the provider, so it needs
this plan published at an immutable commit; and on the reproduction in Task 10 it
expires against Prisma's 5,000 ms interactive-transaction limit before it can
append the receipt. **This plan cannot satisfy its own coverage gate until the
defect it repairs (Task 10) is deployed.** Record that as the explicit gate
exception when the branch is pushed, and mint the real receipt in Task 12 once
Task 10 is live — a fabricated receipt is the exact substitution the design
forbids.

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
5. Publish and independently review the amended design/plan exact tree. The
   completed identity is commit `a537d7a1ebb19b40f9ccc1426d9fb62fc0312b89`,
   tree `7033afb666113bb5e3dc33122a21552028c37fb0`, design blob
   `dedf8f19a94e5bcb126f2e5774e60237974ff4da`, plan blob
   `de1703b6cae2f6ec1b555c20e66346b5311a6ebd`, and semantic-review receipt
   `cmt5xkrai0jhk01rm4apogtih`.
6. Prove the governed persistence path before requesting activation. The audit
   currently finds no callable writer that atomically binds the DI, standing
   policy, human ratification, exact subject/action/artifacts, expiry,
   revocation, and consumption. `record_workroom_evidence` is evidence only;
   the generic authority-log helper is not an action-specific projector; the
   current approval envelope is a 15-minute human exact-tool proposal with no
   source-implementation binding.
7. The operator ratified the non-circular repository contribution boundary.
   Workroom activity `cmt5xoo250jj401rm57xnzi6f` is the durable pointer to the
   human instruction, DI lineage, immutable artifacts, three-band semantics,
   and constraints; `cmt5xqem60jjv01rms0eubr7l` records the systemic directive.
   This is source-authorship authority only, not an `AuthorizationDecisionLog`.
8. Keep the normal implementation claim and its denial visible; do not mark it
   allowed or fabricate receipts. The external repository envelope authorizes
   only the first-deployment authorship needed to create the canonical bridge.
9. If the persistence path is unproven, ratification is
   absent/revoked/expired, a judgment is non-affirmative, a
   policy floor requires a distinct human unavailable on this install, or any
   binding drifts, stop with the exact reason. Do not use direct
   DecisionInteraction reads, an AI or second-human proxy, superuser execution,
   direct DB writes, or the null-organization spec-approval writer.

Steps 1-7 are complete. Production implementation is active only inside the
ratified repository envelope; the runtime bridge remains absent until protected
merge and must not be represented as active authority. GitHub currently
requires zero approving reviews, so independent governed exact-tree review is
an explicit precondition and may not be inferred from the merge queue.

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

> **Open questions before this task's tests are locked in.** The design's §2
> matrix was reshaped to be strictly additive, and two cells changed meaning:
> `doc-only` implementation obligations (**OQ-1**) and whether the `feature` row
> restates `PLAN_REQUIRED` (**OQ-2**). See the design's `## Open questions`.
> `evaluate.ts` currently excludes `doc-only` from `PLAN_REQUIRED`,
> `DEPENDENCY_UNRESOLVED`, and `CAPSULE_IDENTITY_MISMATCH`; the earlier prose said
> `doc-only` carries capsule identity. **Do not write a test asserting either
> reading until OQ-1 is decided** — a test here freezes whichever side happens to
> be in the tree. Both predate BI-F0715C9C and are outside this repair's blast
> radius; if OQ-1 resolves toward "yes" it needs its own backlog item.

Refactoring allocation: centralize common requirements and additive profile
floors instead of copying arrays. The design's budget is ~80% refactor of
existing substrate — the retired 80/20 feature-first split
(`docs/design/golden-triangle-design.md:654`) does not apply here. Refactoring may
not broaden untested behavior.

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

After every Red/Green slice run the suite that owns it, then the related
projection, baseline, receipt, Workroom, coworker, MCP task/route, and
external-evidence suites. Run tests through the worktree junction, not a bare
`pnpm install` in the worktree.

1. `pnpm --filter web exec vitest run lib/backlog/initiative-readiness lib/planning lib/work-capsules lib/govern/authority lib/mcp`
2. `pnpm --filter web build` — the production build is the only gate that
   surfaces TypeScript errors (AGENTS.md §4); typecheck and vitest do not.
3. Blast-radius analysis (`dpf-blast-radius`) — Task 6 and Task 4A both touch the
   generic authority gate, so the radius is wider than readiness.
4. Independent architecture review bound to the exact tree.
5. UX review of the model-facing recovery copy from Tasks 4 and 4A — this is
   operator-visible text, so `dpf-ux-fit-review` applies.
6. `pnpm run pregate:preflight`. `pregate:status` is the verdict; an unlisted
   test never runs. If it exits `4294967295` that is a terminated wrapper, not a
   test failure — diagnose before retrying.

## Task 12 - Governed publication

Commit with one DCO trailer, synchronize WC-2ABA65F7 to the stable commit,
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
   WC-E8275570 with repository, branch, worktree, and a `commits` array
   containing exactly one published 40-character SHA:
   `6b4ea6b906836b8e67b2afa53cf2aab25fdf03b1`. The server derives the candidate
   head; callers do not assert a trusted `headSha`.
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
