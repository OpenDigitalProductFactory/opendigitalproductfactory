---
status: active
---

# Initiative readiness traversal repair implementation plan

**Backlog item:** BI-F0715C9C
**Workroom:** WC-7FF8A505
**Branch:** `fix/initiative-readiness-traversal-recovery`
**Recovery base:** `f20a78f63dc1884eea0fc171d04556b4be8de32f`
**Design:** `docs/superpowers/specs/2026-08-23-initiative-readiness-traversal-repair-design.md`

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

| Acceptance | Red test | Production surface |
|---|---|---|
| `AC-PROFILE-FIX`, `AC-PROFILE-MONOTONIC` | policy and adapter fixtures | `profiles.ts` |
| `AC-POLICY-DIFFERENT` | table-driven fix/feature/cross-domain tests | `evaluate.ts` and policy version |
| `AC-RECOVERY-ROUTE` | recovery resolver plus MCP-handler tests proving the full recovery object and exact no-thread packet survive serialization | lane registry, recovery adapter, `claim-backlog-item-handler.ts` |
| `AC-UI-TARGET` | exact-target and stale-target launcher tests | recovery action / coworker launcher |
| `AC-REVIEW-SEPARATION` | external no-thread request tests and receipt separation tests | coworker pack -> `submitRemoteCoworkerTask` |
| `AC-REVIEWER-READ` | immediate `sideEffect=false` read under coarse approval policy `all`, plus unchanged proposal/side-effect approval cases | coworker authority decision |
| `AC-SPEC-AUTHORITY` | authority writer and exact spec-approval traversal tests | subject derivation, authority decision log, baseline repository |
| `AC-RECEIPT-FRESHNESS` | pre-baseline and post-baseline supersession tests | readiness entry adapter / receipt projection |
| `AC-HEAD-RECONCILE`, `AC-REPLAY` | provider, handler, capture/adopt tests | external evidence and external session capture |
| `AC-AUTHOR-AFTER-SYNC`, `AC-FAIL-CLOSED` | repository-artifact positive/negative fixtures | existing artifact resolver |
| `AC-COVERAGE-TX` | slow-preflight, five-mapping commit, stale-binding, and transaction-expiry tests | plan coverage recorder and repository binding recheck |
| `AC-POLICY-BRIDGE-YES`, `AC-POLICY-BRIDGE-DENY` | affirmative, non-affirmative, signal-quality, conflict, and owning-gate fixtures | policy-authority projector, decision ledger, authorization log/envelope |
| `AC-POLICY-BRIDGE-SCOPE`, `AC-POLICY-NOT-RBAC`, `AC-POLICY-RECOVERY` | policy/delegation/artifact/expiry/replay, direct-DI prohibition, and exact-route tests | governed authority gate, delegation, envelope lifecycle, readiness recovery |
| `AC-FIRST-DEPLOY-WARRANT`, `AC-FIRST-DEPLOY-INDEPENDENCE`, `AC-FIRST-DEPLOY-CONSUME` | immutable bootstrap-contract, drift/revocation/replay, exact-tree review, branch-rule, and merge-consumption evidence | design/plan, Workroom audit, DCO/review/pregate/PR boundary |

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
floors instead of copying arrays. This is part of the requested 20% refactoring
budget and may not broaden untested behavior.

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
