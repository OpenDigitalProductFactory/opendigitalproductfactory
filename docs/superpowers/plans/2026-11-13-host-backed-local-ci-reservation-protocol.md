---
status: draft
backlog: BI-34955E1F
workroom: WC-C1F703FD
spec: docs/superpowers/specs/2026-11-13-host-backed-local-ci-reservation-protocol-design.md
---

# Host-backed local-CI reservation protocol: remaining implementation

This plan covers the remaining protocol of BI-34955E1F. Native PLAN admission
IRD-FB10B4E46B95 permits planning. Independent spec approval, a current scope
baseline, immutable plan coverage, implementation admission and delivery remain
pending. This document grants none of them.

The design is published at 49b776ed2a7caf00b760ccf6017c8daef1a6d364,
blob 6ce3337197c8c0879c0637e646e5f4f7088cfe1e. Its two issued spec-review
submissions were refused before allocation, including after the prescribed
planning refresh. Preserve those refusals; do not repeat an unchanged request.
BI-5D06B748 owns the malformed-prerequisite routing correction. Its verification
is currently held after two transport failures; no containing fix is credited.

For agentic workers: execute this plan one independently reviewable backlog item
at a time: one BI, one branch, one PR. Use dpf-tdd for red-green implementation,
dpf-local-merge-ci-before-push plus the completion gate below before a success
claim, and dpf-pr-with-dco for handoff.

## Grounding and delivery boundary

Reuse the existing shared leases, host budget, revision floor, refusal classifier
and durable resumer. The September 25 platform-owned memory plan belongs to
BI-903FB5F9 and covers its calibration/cache-drop slice; it does not supply this
item's remaining client protocol or approve its criteria. The July 31 starvation
plan remains supporting architecture. Do not edit another owner's plan or
reopen either delivered slice.

The first reservation slice shipped in PR6894. Retain it as delivered context.
The remaining server floor, client report and terminal refusal handling form one
atomic compatibility change under BI-34955E1F; none may ship alone while another
component would admit or indefinitely requeue the wrong client. Its phases below
are internal sequencing. The transport-diagnostic patch is separate retained
work and is excluded.

Protected comparator for the current design publication:
6fbcbac652749923c6ac1a3b6c0acdbfe379c0d5.
Retained implementation commit: 16760dde22c20004a2e205d7b2d03fedc6faccc7.
Retained tree: ae959a1aec4b816771c907a5ddb2bdd4c66e6fdb.
The twelve original blob identities and binary patch are preserved in this
chat's c1-retained167-pre-design-packaging-20261113 evidence. Their preservation
does not make the old implementation current or admitted.

Current source already has revision3 and its obsolete-pin protection
(BI-EB864226). Integration must retain that protection while adding revision4;
never restore an older revision2 implementation over current main.

## Traceability and original acceptance

| Requirement | Objective | Original criterion |
| --- | --- | --- |
| AC-C1-1 | OBJ-C1-1 | An admitted gate cannot be starved by work admitted after it. |
| AC-C1-2 | OBJ-C1-2 | The refusal happens at admission, where it is actionable, rather than mid-build. |
| AC-C1-3 | OBJ-C1-1, OBJ-C1-2 | No client-side headroom check is required for the pool to conserve capacity. |
| AC-C1-4 | OBJ-C1-3 | A run that still cannot proceed is reported as infrastructure and re-runnable on the same SHA, as today. |

These four statements remain unchanged. AC-C1-4 describes supported recovery of
settled infrastructure, not permission to replay UNKNOWN work. Original e4 is
INCONCLUSIVE and E9 is UNKNOWN/unverified/retryfalse.

| Deliverable | Requirements | Contracts | Flows | Verification |
| --- | --- | --- | --- | --- |
| Remaining reservation/client protocol | AC-C1-1, AC-C1-2, AC-C1-3, AC-C1-4 | C-C1-BUDGET, C-C1-REVISION, C-C1-REFUSAL | F-C1-CLAIM, F-C1-DURABLE | V-C1-SOURCE, V-C1-GATE, V-C1-LIVE |

C-C1-BUDGET: one conservative existing physical-host budget accounts once for
active reservations in both admission directions, with inherited configured
bounds and lock order. No sampling, new collector or budget increase.

C-C1-REVISION: matched revision4 client/server contract requires a positive finite
physical total for a gate claim on Windows and POSIX, including an absent path;
non-gate probes retain their existing behavior.

C-C1-REFUSAL: stale clients receive gate_client_upgrade_required and invalid host
observations receive invalid_host_pressure before allocation or wait creation.
They are non-retryable usage/UNRUN outcomes, not a new queued attempt.

F-C1-CLAIM: real gate client -> existing claim_nonprod_environment_lease ->
server revision/host validation -> shared reservation admission or refusal.

F-C1-DURABLE: real gate/resumer -> existing terminal outcome classifier ->
retained exact result and supported renewal/release; no replacement nonce.

V-C1-SOURCE: first-failing behavior regressions, relevant Node and web suites,
both web TypeScript programs, impact guards and documentation checks on the
restored integrated immutable source.

V-C1-GATE: one normally admitted current-source canonical integration result,
independent source assessment, native publication policy and protected checks.

V-C1-LIVE: source/lease-bound functional evidence of all four original criteria
on the containing canonical release; missing evidence remains incomplete.

## Phase 1: establish the executable prerequisites

Deliverable: actual current independent approval/baseline/coverage and
implementation admission. No runtime file is restored before this phase passes.

Keep the same item, room, branch and worktree. Re-read current source, ownership,
lease and normal native recovery. After verified routing remediation, obtain the
current issued review packet; never synthesize it or reuse a historical UNKNOWN
execution. Resolve findings and establish the actual scope baseline and plan
coverage through their own writers. A planning allowance is not implementation.

The resolved fourteen-path impact contract requires related-test resolution for
nonprod-lease-definitions.ts, nonprod-lease-pack.ts and gate-client-revision.ts.
Current graph reads returned the two exact colocated suites for the latter two;
the definitions file has no linked tests despite a ready index. Retain that gap
and require exhaustive canonical verification rather than infer an exemption.
Resolve advice again if source or the impact contract changes.

## Phase 2: restore and adapt the retained protocol

Deliverable: one integrated current implementation preserving existing controls.

After actual implementation admission, fetch and integrate protected main through
the normal merge path. Compare the retained twelve blobs and patch to current
interfaces; restore only this item's own delta, using a normal new commit, not
reset, rebase, force or an unreviewed wholesale file replacement.

Touched server files:
- apps/web/lib/nonprod/gate-client-revision.ts and its colocated test;
- apps/web/lib/mcp/packs/nonprod-lease-definitions.ts;
- apps/web/lib/mcp/packs/nonprod-lease-pack.ts and its colocated test.

Touched client/resumer files:
- scripts/lib/gate-client-revision.mjs;
- scripts/gate-worktree.mjs and scripts/gate-worktree-resume.test.mjs;
- scripts/local-ci-durable-wait-resumer.mjs;
- scripts/lib/durable-wait-resumer.test.mjs.

Preserve revision3 obsolete-pin handling, exact reservation identity, process
fences, checkpoint publication and genuine queue/cancel/expiry behavior. Change
only the revision4 report/validation and non-retryable terminal handling.

## Phase 3: prove behavior and document the actual contract

Deliverable: current frozen-source evidence, with failed/unrun history intact.

Observe meaningful RED before GREEN for stale revisions; Windows, POSIX and
absent paths; missing, zero, negative, nonfinite and wrong-type physical totals;
valid gate claims; unchanged non-gate probes; once-only refusal without allocation;
and durable usage/UNRUN completion. Retain both reservation-direction and mixed
size/self-exclusion tests so the first delivered slice cannot regress.

Run the actual affected web suites and Node gate/resumer suites through current
normal host admission; run both web TypeScript programs. Exercise the impact
contract's style-drift guard. Update docs/testing/pre-pr-gate.md and
docs/architecture/build-gate-runbook.md for the shipped revision/refusal behavior.
For context-engineering-standards.md, dpf-patterns.md,
mcp-tool-authorization-runbook.md and platform-support-watchlist.md, inspect each
pending impact and either update it under a normal scope claim or record a
concrete not-affected disposition. Run affected registered-artifact freshness,
spec/status and link checks; do not rewrite baselines to hide failures.

Freeze a DCO-signed clean commit and earn one exact current canonical gate via
normal preflight/admission. A genuine moving-main or transport refusal is UNRUN,
not a product PASS. No second gate competes with an active original controller.
Preserve the original focused75 PASS on167 as historical evidence only.

## Phase 4: publish and verify the containing release

Deliverable: one ready protected PR, its containing canonical release, and actual
functional acceptance. A pushed design/plan artifact is not a completed PR.

Obtain an immutable independent assessment and fulfill the current native
publication contract. Use the normal PR/merge queue, all required checks and
pr:health. Advance only through the acknowledged canonical upgrade owner, then
run supported live preflight against the actual merged source.

On admitted disposable verification work, demonstrate that later platform claims
cannot consume an admitted run's reserved capacity; invalid clients/observations
refuse before allocation; server accounting needs no client politeness; and a
settled infrastructure failure retains only its supported same-source recovery.
Bind observations to actual source, leases, child outcomes and cleanup evidence.
Never induce an unfenced real-host OOM, kill an unknown process or replay E9.

## Backlog coverage

Umbrella and sole atomic deliverable: BI-34955E1F. Dependency BI-5D06B748 owns
its separate review-routing repair; no independent work is left as an unfiled
checkbox here. The compatibility rationale above explains the one-PR boundary.

Coverage receipt: NOT RECORDED. Large work requires the real current scope
baseline and immutable plan reference. After those prerequisites exist, call
record_plan_backlog_coverage with decision atomic and the exact requirement,
contract, flow and verification references above; retain the returned receipt
and validate it with check_plan_backlog_coverage. Do not fabricate a receipt or
claim this draft completes planning.

## Risks and rollback

A mismatched floor/client rollout can refuse every old caller. Ship the matched
contract and verify current-client reachability. Incorrect usage classification
can lose a refusal or create duplicate waits; test both boundaries.

Rollback is a reviewed source/release operation preserving calibration, reservation
history and compatibility. Never lower host floors or delete calibration/data to
make a result pass. Original uncertainty, foreign holders, grants, budgets,
credentials, VM/cache settings and paired-peer data remain unchanged.
