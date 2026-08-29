---
status: active
---

# Change-delivery latency — tier by risk, fail open on infrastructure

- Spec: `docs/superpowers/specs/2026-08-29-change-delivery-latency-tiering-design.md`
- Epic: EP-ABB3AC9D
- Umbrella backlog item: BI-D908DA0A
- Decision ledger: DI-0DD38401DF9F
- Receipt: pending

> **Receipt status.** `record_plan_backlog_coverage` requires a
> `planArtifactRef` of kind `repo-blob-at-commit` with a provider-verified
> `providerBlobId`. That blob does not exist until this plan is committed and
> pushed, and pushing runs the pre-push gate. The receipt is therefore minted in
> Phase 0 below, after the first push, and copied back into this line — which is
> itself one instance of the gate-satisfaction commit class this plan exists to
> reduce (17.0% of all commits in the measured sample). Recording that honestly
> here rather than writing a placeholder that reads as satisfied.

## What the measurement established

Full baseline: https://claude.ai/code/artifact/05d0d22a-9fb6-4530-9fad-9baccbfec72c

The load-bearing numbers, measured 2026-08-29 against `main` @ 97b32d3:

- All 95 guards run serially in **76.3s**; the 55 added in the last six weeks
  cost **17.9s** of that. Guards are **9.8%** of the 776s median slot hold.
- Single-slot queue wait p90 **1053s**, max 3666s, at **45.1%** utilisation.
- **60 of 60** host preflight commands are a strict subset of the cloud policy
  profiles. **79 of 142** profile commands are guards testing themselves.
- **32.5%** of 200 commits across 60 merged PRs are process, not product.
- Hook prechecks reach Claude **22**, Grok **13**, Codex **10**.

The guard surface is not the bottleneck. No phase below retires a guard.

## Phase 0 — activate the second slot

Umbrella: BI-D908DA0A. Independently shippable. No dependencies.

The largest single win, and the cheapest. Replay of the real 286-lease arrival
trace: capacity 2 takes total queued time from **23.8h to 2.1h** across five
days, a 91% reduction. Running the real policy functions against this host
returns `hostBuildCapacity: 2` and `hostStageCapacity: 2` today; the only
blocker is the absent `PlatformConfig` row.

1. Add a governed activation action that creates and validates the
   `local_ci.sandbox_pool` row. Shape v1: `requestedCapacity` (1 or 2),
   `ceilings{minAvailableMemoryBytes, maxSustainedCpuPercent, minDiskFreeBytes}`,
   `rollback{maxServiceDurationRegressionPercent ≤ 15,
   maxInfrastructureFailureRatePercent ≤ 5, evidenceMismatchTolerance = 0}`.
   Validation is `localCiPoolConfigError`, which already exists — call it, do
   not restate it.
2. Seed an explicit `requestedCapacity: 1` at install, so `config-absent` stops
   being the silent default path and activation becomes an edit.
3. Surface `effectiveCapacity`, `hostSafeCapacity`, `source` and
   `rollbackReason` on an operator health surface. The resolver already returns
   all four; nothing reads them.
4. Activate at capacity 2 on this host.

Rollback: `contractLocalCiPoolAfterGateResult` already contracts 2 → 1 on a bad
slot-1 result. It ships; it is the one half of the pilot that was finished.

Verification: re-measure queue-wait percentiles over the following seven days
against the 1053s p90 recorded here, from the same
`NonProductionEnvironmentLease` query.

## Phase 1 — an honest verdict

Umbrella: BI-D088D06D. Independently shippable. No dependencies. Ships together
with BI-0F2E42D5 and BI-A7EAB5AA, which repair the same injustice one layer down.

1. Add `INCONCLUSIVE` to the verdict set in `scripts/lib/pregate-status.mjs`.
   It is written when the gate state carries an infrastructure classification —
   a recorded signal death, a control-plane starvation, a lost slot bind — and
   never as a default for an unexplained exit. An unexplained exit stays `FAIL`;
   that distinction is the whole safety property.
2. Make the running path in `scripts/pregate.mjs` recover as the queued path
   already does. Today a wrapper killed while queued writes `status: "queued"`
   and preserves the lease; killed while running it writes a terminal
   `status: "failed"`. Same cause, opposite outcome.
3. Propagate the runner's existing classification. `resolveChildExit` already
   returns `EXIT_CHILD_SIGNAL_DEATH` and prints that this is infrastructure
   evidence. Carry that into the gate state instead of discarding it.
4. Add the invariant guard: no code path may write a terminal
   `gatePassed: false` for a condition already classified as infrastructure.

Verification: a test that kills the wrapper on the running path and asserts the
SHA remains re-runnable. The queued-path equivalent already exists — mirror it.

## Phase 2 — declare what each guard reads

Umbrella: BI-8CDA7F95. Independently shippable. Prerequisite for Phase 3.

1. Each `scripts/check-*.mjs` exports an `inputs` glob list naming what it
   reads. The 37 `check-no-*` ratchets already scan fixed directories, so most
   declarations are mechanical.
2. `buildPreflightPlan()` takes the changed-file set and intersects it against
   those declarations, using `scripts/ci-change-scope.mjs` —
   already written, already trusted by the cloud, currently never called from
   this stage.
3. A guard with no `inputs` declaration runs unconditionally. Absence of a
   declaration must never be read as absence of relevance.
4. Add a reachability guard: every `scripts/check-*.mjs` is reachable from at
   least one declared stage. This is what would have caught Phase 6's finding.

Verification: run the preflight against a docs-only, a source and a schema diff
and assert the entry counts differ. Today all three run 52 of 52.

## Phase 3 — stop proving the same thing three times

Umbrella: BI-282AE0BC. Depends on Phase 2.

1. **Classify the self-tests first.** Each `.test.mjs` in the policy profiles
   declares whether it is a unit test of guard logic (runs when the guard
   changes) or a conformance assertion reading live repository state (runs
   always). BI-7B249AFE records that stripping them wholesale produced a false
   green on a tree CI failed deterministically. This is classification, never
   deletion.
2. Key each guard result on a hash of the guard file plus the content of its
   declared inputs. An unchanged pair is a cache hit; the three-times-per-push
   duplication collapses to once-per-distinct-tree-content.
3. The cache is local. No remote execution — verification must not acquire a
   dependency on an external service.

Verification: perturbing a declared input must produce a cache miss. Perturbing
an undeclared file must too, until its guard declares it — fail safe.

## Phase 4 — one precheck plane, four surfaces

Umbrella: BI-C09ECA63. Independently shippable. No dependencies.

Claude gets 22 hook scripts, Grok 13, Codex 10, from three hand-maintained
registries with no shared source. The twelve Codex lacks are all prechecks that
predict a gate refusal before a commit exists — so the surface with the fewest
warnings pays the full gate latency to learn what Claude is told for free.

1. One declared precheck registry as the single source.
2. Four thin adapters emit each surface's native format: the plugin
   `hooks.json`, `~/.grok/hooks/dpf-guards.json`, `~/.codex/hooks.json`, and
   the Antigravity manifest. Keep surface-specific code at the adapter edge.
3. A parity guard that fails when a precheck reaches one surface and not
   another without a recorded exemption. `update_agent_toolchain.py` already
   carries a comment recording that this was learned once before
   (BI-0B292D84): a guard absent from a tuple never reaches that surface at all.
4. Make the Codex hook-trust state legible, so an unestablished handshake
   reports itself rather than silently running nothing.

Verification: the parity guard is its own proof. Assert it fails on a
deliberately undeclared drift.

## Phase 5 — make the coverage gate ask the substrate

Umbrella: BI-397EBDD6. Independently shippable. Pairs with BI-310EC5AF.

`check-plan-backlog-coverage.mjs` decides whether it applies by string-matching
`**Backlog item:**` in the plan's prose, so a plan naming its item any other way
is exempt from the whole gate. Proven against this plan: committed with
`Receipt: pending` and no `## Backlog coverage` section, the gate passed it.

1. Resolve the plan's umbrella item from `BacklogItem`, not from Markdown. A
   plan under `docs/superpowers/plans/` is in scope unless the substrate says
   otherwise.
2. Validate the Receipt against the substrate rather than a regex (BI-310EC5AF).
3. Remove the two-commit ordering constraint, or make it explicit: a receipt
   cannot exist before the plan blob is pushed, so either the gate tolerates a
   first-push plan or the receipt binds to something that exists earlier.

## Phase 6 — guard-surface hygiene

Umbrella: BI-6332DD3D. Independently shippable. No dependencies.

Resolve `check-obligation-cadence-coverage.mjs`, which is registered in no
profile, is not `check-no-*` so the loop never discovers it, and appears in no
workflow. Either register it, or rename it to the measurement tool it is. Do not
delete it without naming the defect class it was written for.

## Sequencing

Phase 0 and Phase 1 are independent of everything and deliver most of the
wall-clock. Phase 2 gates Phase 3. Phases 4 and 5 are independent throughout.

Nothing in this plan removes a check. The cloud tier stays complete and
unsampled: every guard still runs on every change before it merges, which is
what preserves the guarantees. What changes is that the local tiers stop
re-proving what the cloud will prove anyway, on the one machine where proving it
costs a queue position.

## Out of scope

- Retiring any guard. The inventory recommends keeping 81 of 95 exactly as-is.
- Commandment-tier checks: auth, DCO, secret scanning, migration safety.
- Pool capacity above 2. `LOCAL_CI_MAX_CAPACITY` is 2, and the replay shows 2
  captures 91% of the available benefit.
- Readiness governance in the merge path. Named in the spec, left to
  EP-129D11FD and its own ratification.

## Target service level

- A docs-only change merges in under 20 minutes.
- A source change merges in under 40 minutes.
- No change is ever blocked by an infrastructure verdict.
- Process overhead falls below 10% of commits, from 32.5%.
- Every precheck reaches all four surfaces, or its absence is declared.
