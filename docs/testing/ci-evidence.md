# CI evidence efficiency — observation phase

**Status:** observation (non-blocking)  
**Spec:** [`docs/superpowers/specs/2026-07-26-ci-evidence-efficiency-design.md`](../superpowers/specs/2026-07-26-ci-evidence-efficiency-design.md)  
**Plan:** [`docs/superpowers/plans/2026-07-26-ci-evidence-efficiency.md`](../superpowers/plans/2026-07-26-ci-evidence-efficiency.md)  
**Backlog:** BI-2F60FDCE (baselines), parent BI-E5A0C9A7

## What this phase does

Publishes **measurement only** so later PR-skipping and evidence reuse can be evidence-based:

| Signal | Purpose |
|--------|---------|
| Timing (p50/p90 by phase) | Critical-path and runner economics |
| V8 coverage (statements, branches, functions, lines) | Quantify owned production coverage, including **unloaded** files |
| Selection recall (shadow) | Prove affected-test selection never misses a full-suite failure before activation |
| Flake history | Suspect flaky tests without converting red → silent green |
| Cache economics | Hit rate, bytes, restore/save cost, net time saved |

It does **not**:

- skip tests on pull requests;
- change required checks (`Merge Readiness`, DCO, UX sweep, merge_group);
- invent coverage percentage gates (thresholds stay off until calibrated).

## Local library and CLI

```bash
# Unit tests for pure observation aggregators + config contracts
node --test \
  scripts/lib/ci-observation.test.mjs \
  scripts/ci-coverage-config.test.mjs \
  scripts/ci-observation.test.mjs \
  scripts/ci-shadow-selection.test.mjs

# Build an observation document (identity required)
node scripts/ci-observation.mjs \
  --tree-sha "$(git rev-parse HEAD)" \
  --event local \
  --run-id "manual-1" \
  --coverage web=apps/web/coverage/coverage-summary.json \
  --owned-root web=apps/web/lib \
  --output artifacts/ci-observation.json
```

Optional inputs:

- `--coverage <pkg>=path` — Vitest `coverage-summary.json` (repeatable)
- `--owned-root <pkg>=dir` — production source roots for unload inventory (repeatable)
- `--vitest <pkg>=path` — Vitest JSON reporter output (repeatable)
- `--shadow-selection path` — shadow selection JSON from `scripts/ci-shadow-selection.mjs`
- `--cache-samples path` — cache economics sample array
- `--previous-observation path` — prior observation for flake history continuity
- `--timing-samples path` — phase timing samples

## Coverage commands (observation)

```bash
pnpm --filter web run test:coverage
pnpm --filter @dpf/db run test:coverage
```

Configs set `coverage.provider = "v8"`, explicit `coverage.include` patterns,
and `reportOnFailure: true` so owned files with zero tests still appear and
feed `unloadedOwnedFiles` in the observation schema. Vitest 4 removed the
older `coverage.all` option. Web includes `proxy.ts` and
`instrumentation.ts` as first-class production surfaces.

Coverage runs use the direct `@vitest/coverage-v8` development dependency in
both measured workspaces. The workflow lets a failed coverage or build step
continue only long enough to upload its diagnostic evidence; the final
completeness step still fails the calibration run when any required input is
unsuccessful.

## Standards grounding

- [Vitest coverage configuration](https://vitest.dev/config/coverage.html)
  defines `coverage.include` as the Vitest 4 mechanism for including
  unimported source files; `coverage.all` was removed.
- [Vitest reporters](https://vitest.dev/guide/reporters) define the JSON
  reporter used for per-file and per-test timing/outcome evidence.
- [Vitest CLI](https://v4.vitest.dev/guide/cli) defines `vitest related` as
  static-import-based test discovery. Dynamic or otherwise unmapped changes
  therefore fail safe to exhaustive execution in shadow evidence.
- [GitHub Actions cache](https://github.com/actions/cache) defines the granular
  `restore@v6` and `save@v6` actions used to measure transfer cost separately
  from downstream install/build duration.

## Scheduled calibration

Workflow: `.github/workflows/ci-calibration.yml` (`CI Calibration`)

- Runs on a schedule (Mon/Thu 06:00 UTC) and `workflow_dispatch`
- Never runs on `pull_request` and is never a required merge check
- Executes observation unit tests, web + database coverage, shadow related-test comparison
- Measures exact-key cache economics for `pnpm-store` and `turbopack-build`
  (`actions/cache/restore@v6` + `actions/cache/save@v6`, no prefix
  `restore-keys` on Turbopack). The Turbopack key hashes the lockfile plus
  explicit `ts`, `tsx`, `js`, and `jsx` source globs; GitHub `hashFiles` does
  not expand brace globs.
- Publishes a versioned observation artifact bound to the immutable tree SHA (`ci-observation`, 30-day retention)

## Activation gate (later waves)

Before any PR suite-skipping activates (BI-4527C1DA and dependents):

1. At least **two representative weeks** of calibration observation artifacts.
2. Selection shadow mode reports **100% observed failure recall** when failures exist (or only full-suite escalations).
3. Flake reporting does not hide red outcomes.

Until then, exhaustive PR and merge-group execution remains the default.

## Local-CI admission and fairness

`pnpm pregate` requests one durable admission row before touching the shared
local-integration sandbox. The request identity is the owner session plus exact
candidate SHA, so retries observe the same row rather than creating another
waiter. The MCP claim result is explicit:

- `queued` includes stable FIFO position and accumulated wait age;
- `admitted` includes the assigned slot and wait age; and
- a terminal result requires a new claim identity.

Phase 1 retains one slot (`slot-0`) and therefore does not claim parallel
capacity. It removes the polling race that let later one-second waiters overtake
earlier work, and it prevents queue time from consuming the TTL granted to the
actual run. The gate observes its durable row with bounded exponential backoff
and jitter. Transient portal quiescence and connection resets retry within the
admission deadline instead of turning into failed full-run attempts. The
default deadline is two hours because a complete gate can legitimately exceed
the old five-minute queue deadline; callers may set a smaller explicit bound.

Only an admitted owner acquires the host process fence, clears shared freshness
evidence, and starts the expensive command. Releasing an admitted row promotes
the oldest live waiter; releasing a queued row cancels it. Interrupt and
termination handling release or cancel the same lease exactly once. Queue
arrival, start, cancellation/expiry, completion, depth, wait, and service
timings use the shared queue-telemetry substrate under the stable
`compute:nonprod-<environment>` key.

The POSIX script is intentionally only a launcher for the Node gate. Admission,
heartbeat, process fencing, evidence, and cancellation therefore have one
cross-platform implementation.

## Impact planner (shadow mode)

### Work-start impact contract

Before implementation, every `claim_capsule_scope` call containing edit-path
claims now runs the prospective gate-context generator against the capsule's
complete edit-path set. The response and
`WorkCapsule.verificationState.changeImpactContract` name:

- production files whose graph-linked and colocated tests must be resolved
  before Red;
- prose/style guards that scan planned files even when those files have no
  existing baseline entry; and
- the existing attestations, ratchets, derived artifacts, routes, migrations,
  and always-on verification path.

Repeated edit claims refresh the contract. Read-only claims do not. A missing
generator or invalid output is persisted as `status: unresolved` with an
exhaustive-verification instruction; it is never interpreted as an empty
impact set. This contract is advisory prevention evidence. The exhaustive CI
and merge-group gates below remain authoritative.

`scripts/ci-evidence-plan.mjs` is the shared planner for GitHub CI and the
governed local-integration runner. It emits a canonical schema-versioned JSON
document and SHA-256 digest for the base/head commits and trees, changed files,
policy, and supplied advice. GitHub uploads the document as
`ci-evidence-plan-<run>-<attempt>`; local-CI writes
`dpf-ci-evidence-plan.json` beside its run metadata and records the digest in
that metadata.

The planner recommends:

- affected workspace packages, including transitive reverse dependencies;
- changed, colocated, supplied Vitest-related, and trusted graph-recommended
  tests;
- Next.js routes, route families, UX mode, and global repository guards;
- an explicit disposition for every changed file and visible missing-test
  observations.

The digest covers semantic data and exact base/head tree identities. Commit
SHAs remain in the document as provenance but are excluded from the digest
because local-CI synthesizes a new merge commit on every retry even when its
tree is byte-identical. Generation time, runner path, logs, and other
host-specific diagnostics are also excluded so the same immutable content
produces the same digest on GitHub and local-CI.

Code-graph advice is optional and is never a hidden live dependency. Advice is
trusted only when its schema matches policy, the index is `ready`, the
workspace is clean, the indexed tree matches the candidate exactly, and
the required `DEFINES`, `IMPORTS`, `IMPLEMENTS_ROUTE`, `EXPOSES_TOOL`, and
`TESTED_BY` relationships are populated. Missing, stale, dirty, structurally
incomplete, or malformed advice expands runtime-source evidence to exhaustive.
Supplied Vitest static relationships and co-located tests remain independent
recommendation inputs.

Other exhaustive reasons include workflow, lockfile, migration, test-config,
authentication, routing-shell, install/seed, generated-contract, or shared
setup changes; unmapped source; planner input errors; empty diffs; selections
above the policy threshold; and every `merge_group`, `push`,
`workflow_dispatch`, or scheduled event. The docs-only compatibility exemption
remains unchanged because it does not narrow runtime evidence.

Affected-test and affected-route selection remain observation only. The planner
continues to emit the existing `heavy` and `mobile` compatibility outputs.
`heavy` is true when either the file scope intrinsically requires the full
workspace gates or the semantic plan has expanded to `fullSuite`. Therefore an
ordinary docs-only or `apps/mobile`-only pull request can remain light, while
`merge_group`, push, workflow dispatch, schedule, local-CI, and fail-safe
escalations execute Typecheck, Vitest, and Production Build regardless of file
scope.
The planner also emits a dedicated `portal_ux_required` workflow output. It is
`false` only for docs-only and `apps/mobile`-only pull requests, the two audited
scopes that cannot alter the rendered web portal. Those changes short-circuit
the reusable UX sweep before runner and Postgres allocation. This output is
deliberately separate from `heavy` so future build/test scope changes cannot
silently weaken portal evidence. Activation of broader source selection is
owned by `BI-4527C1DA` and still requires the calibration and 100% observed-
failure recall conditions above.

## Exact-tree production-build reuse

For pull-request, merge-group, push, and CI workflow-dispatch events, the
`Production Build` job packages the deploy-equivalent standalone runtime plus
static assets after a successful `pnpm --filter web build`. The CI workflow
starts the reusable UX runtime from the same change-classification edge so its
fixture and browser setup overlap the build. After setup, the runtime waits
only for the exact artifact name in its own Actions run and passes that build to
the stable `UX Route Budget Sweep` check. The one-day artifact contains a
versioned receipt and a compressed payload.

The job has a 20-minute upper bound. A 2026-08-01 sample of 13 successful jobs
measured a 511-second p90 and a 553-second maximum, so the bound is more than
twice the observed p90 while remaining finite. Before compilation starts, the
job logs its Actions run, attempt, immutable tree SHA, timeout, and canonical
build command. A timeout remains red and does not retry or weaken the required
check; it prevents a silent hosted-runner stall from holding the merge queue.

The receipt binds the payload to:

- repository, commit SHA, and immutable Git tree SHA;
- GitHub event, source run/attempt, and CI evidence-planner digest;
- Node, pnpm, Next.js, operating-system, architecture, lockfile identity, and
  a non-secret fingerprint of build-relevant fixture environment values;
- payload byte count and SHA-256 checksum; and
- the successful production-build command plus creation/expiry times.

The UX runtime downloads only the artifact named for its current Actions run
and attempt. It does not search workflow runs by event or SHA and does not
discover a source-run identifier. Its bounded one-second rendezvous polls only
the current run's artifact inventory while the known `Production Build` job is
active; once that producer is terminal without an artifact, UX falls back after
a short indexing grace period. The receipt separately binds the synthetic merge
checkout and its immutable tree. After download,
`scripts/ci-build-artifact.mjs consume` independently recomputes
the current tree, toolchain, payload checksum, byte count, archive inventory,
and expiry before replacing `apps/web/.next`. The archive must contain only the
`.next` root and must include the standalone runtime's `BUILD_ID` and canonical
`version.json`. The consumer adds the checked-out `public` directory and static
assets to the standalone layout, then starts the same `apps/web/server.js`
entry point used by the production container. Development-only server output
and source maps are not transported.

This follows GitHub's same-run artifact contract: the producer uploads a named
workflow artifact and the consumer downloads it from that same run. Fixture
setup remains parallel because a job-level `needs: build` was measured to add
about one minute to PR feedback by serializing setup behind the build. The
workflow retains only `actions: read` plus `contents: read`. See
[Store and share data with workflow artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data).

Reuse is an optimization, never an exemption. On an explicitly classified
non-portal pull request (`portal_ux_required=false`), CI skips the reusable
sweep job before runner and Postgres allocation; the stable `UX Route Budget
Sweep` aggregate accepts that skip only for the exact planner signal.
`merge_group`, push, workflow dispatch, missing/malformed scope, and all portal
changes remain exhaustive. Their full-suite `heavy=true` output also ensures
the same-run Production Build artifact exists for UX, avoiding a serial
fallback build after fixture setup. When packaging/upload does not produce a usable
artifact, the reusable runtime starts the normal local production build
immediately. Missing, expired, incomplete, corrupt, or identity-mismatched
evidence removes any partial `.next` output and runs the normal local production
build. Packaging or upload failure is also non-authoritative: `Production Build`
retains its successful result and UX rebuilds locally. Manual baseline
calibration invokes the reusable workflow directly and always builds locally.
The retained cross-run locator is not used by the blocking PR, merge-group, or
push path; cross-lifecycle merge-group-to-push reuse remains owned by
`BI-9585E580`.

**Non-portal skip acceptance measurement.**

Measure the optimization on a real docs-only or `apps/mobile`-only pull request
whose base contains #3782. Record all four signals together:

1. the planner output is exactly `portal_ux_required=false`;
2. `UX Route Sweep Runtime` concludes `skipped`, so no sweep runner or Postgres
   service is allocated;
3. the stable `UX Route Budget Sweep` aggregate succeeds; and
4. the merge-group run executes and passes the exhaustive route sweep.

PR #3735 is the before baseline: its one-file docs-only change allocated the
portal UX runtime for 585 seconds. The first post-policy attestation should
therefore avoid roughly 9.75 runner-minutes on the pull-request head without
changing merge-group route coverage. Do not infer savings from a skipped
required context alone; retain the planner, runtime, aggregate, and
merge-group evidence as one receipt.

The CI and UX job summaries report payload bytes and packaging or
download/validation/extraction duration. Compare those transfer measurements
with the avoided UX build duration before retaining or tuning the artifact.

## Exact-tree cross-lifecycle receipt reuse

`BI-9585E580` adds the GitHub-native evidence contract needed to avoid a second
exhaustive run after an identical merge-group tree reaches `main`:

- a successful merge-group `Merge Readiness` job writes
  `ci-evidence.json` plus `ci-evidence.sha256` after it has accepted every
  dependency;
- the artifact name includes the immutable Git tree, not only the commit SHA;
- a push job discovers, downloads, and validates the candidate receipt; and
- only an exact `reusable=true` verdict suppresses duplicate Typecheck,
  workspace policy, routing-contract, unit/integration-test, Production Build,
  and UX runner allocations on that `main` push.

Pull-request and merge-group runs remain exhaustive. The stable `Unit Tests`,
`UX Route Budget Sweep`, and `Merge Readiness` checks remain present on a
reused push and explicitly attest that their heavy dependencies were skipped
because exact-tree evidence was accepted.

The receipt binds repository, commit and tree identity, source event/run,
workflow fingerprint, producer plan digest, planner implementation fingerprint,
merge-policy manifest, declared and observed runner/toolchain identity, every
aggregate gate result, related artifact digests and byte counts, and a 24-hour
lifetime. It also declares the stable required contexts from the merge-policy
manifest. The companion checksum detects receipt tampering. Validation re-reads
the source run, its artifact inventory, and the latest CheckRuns for every
required context—including the independently executed DCO check—from GitHub.

Only a completed, successful `merge_group` producer is eligible. Every heavy
gate reused by the push must be recorded as `success`; a merely `skipped` heavy
gate is not reusable evidence. A different tree, changed
workflow/planner/policy/toolchain, missing, skipped, or failed required gate,
different artifact digest, malformed receipt, expiry, API failure, or missing
evidence produces the explicit verdict `exhaustive`. Unknown never means reuse.

This policy does not change branch protection or mint a DPF
`ToolExecutionReceipt`; GitHub CheckRun/CheckSuite state and workflow artifacts
remain the evidence authority. The affected-test calibration window is
unchanged and remains shadow-only.

GitHub documents that merge-queue checks run against the merge-group head SHA
and that artifacts from another workflow run require an explicit run identifier
and token. The implementation follows those contracts while comparing the Git
tree inside the receipt, because commit identity alone is not sufficient:

- [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#merge_group)
- [Store and share data with workflow artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data)
- [REST API endpoints for workflow artifacts](https://docs.github.com/en/rest/actions/artifacts)

## UX route-sweep stability

Workflow: `.github/workflows/ux-route-sweep.yml` (`UX Route Budget Sweep`)

The sweep keeps the canonical 308-route inventory and gives every route one
generated disposition in
`apps/web/lib/ux-budget/route-shells.generated.json`:

- **201 eligible routes** must each produce exactly one measurement;
- **81 dynamic routes** remain visible as `dynamic-fixture-required`;
- **26 contextual routes** carry an explicit customer-session, storefront,
  setup-phase, fixture-capability, or dynamic-redirect exclusion.

There is no percentage-based capability threshold. A missing, duplicate,
unexpected, or failed eligible route makes the check red after the remaining
inventory finishes. The always-uploaded
`route-sweep-execution.json` records the source SHA, worker count, duration,
full eligibility accounting, route outcomes, and navigation/visible-DOM/
semantic-structure/accessibility/budget phase timings in deterministic
inventory order. Up to 12 failure screenshots are uploaded only when eligible
routes fail; the execution record still reports every failure.

Hierarchy capture reads the browser-resolved semantic DOM and projects it
directly to implicit/explicit role, nesting, heading level, and structural
control state. Accessible names are never serialised into the comparison: the
ratchet does not consume them, and doing so made large data-owner routes spend
tens of seconds producing values that were immediately discarded.

The runner waits for every opt-in client surface marked
`data-dpf-ux-settle="pending"` to resolve and then for 300 ms of DOM mutation
quiet, capped at 10 seconds, before capture. This is the deterministic hydration
boundary: `networkidle` is not valid for a portal with long-lived streams, while
measuring immediately after `load` races client-populated rows and status labels.
The marker is an explicit component-owned readiness contract, not a route-name
exception in the test harness. The authenticated shell owns the initial React
hydration marker for every route. Components that start additional first-load
work own narrower markers; the business calendar, for example, remains pending
until FullCalendar's visible-range event refresh completes, and Operations
Changes remains pending until its initial RFC list request settles.

The sweep also supplies `/build/work` with a deterministic one-branch Git
repository through `DPF_WORK_CONTROL_REPO_ROOT`. GitHub's named
`workflow_dispatch` checkout and detached `pull_request` checkout otherwise
produce different "Adoptable work" structures for identical source. Production
continues to resolve the real host clone from `DPF_REPO_ROOT`; the narrow
override exists only for the route-sweep fixture.

The authenticated database fixture converges setup state before the production
portal starts, then runs an idempotent second pass after the portal is serving
to refresh the seeded running root-portal heartbeat. The ordering is part of the
fixture contract: startup must not observe an incomplete first-run install, and
artifact discovery or a fallback build can legitimately take longer than the
change-lanes projection's ten-minute stale-heartbeat threshold. Retaining only
the earlier seed timestamp would make the same source alternate between a
healthy lane and a five-word stale-heartbeat blocker.

The portal itself boots in **measurement runtime** (`DPF_MEASUREMENT_RUNTIME=1`,
BI-232BA634). A production boot fires instrumentation reconcilers and watchdog
intervals that keep writing operational state — self-upgrade/quiescence/backup
stuck-run reconciles, build resume, model-context re-assertion, org backfills —
while the crawl is measuring the routes that render that state; merge-group runs
30434754297 and 30438124151 measured the identical git tree (`79055b61`) and
flipped fail/pass on `/workspace` because of exactly such a write. Under
measurement runtime, render-relevant idempotent boot syncs (platform version,
OVSM and org-WWWD backfills) are awaited inside `register()` so every request
observes the same post-sync state, and operational self-heal maintenance is
skipped — an ephemeral sweep portal has nothing to heal, and its background
writes are the nondeterminism. Production and dev boots (flag unset) are
unchanged; the classification lives in `apps/web/lib/runtime/measurement-runtime.ts`
and the gating in `apps/web/instrumentation.ts`.

Fixture-facing health copy must also be semantically stable. The Communications
speech-to-text card classifies transport failures as `endpoint unavailable`
instead of rendering Node/undici's platform-specific DNS or socket error text.
The operator still sees the affected provider URL and actionable recovery path,
while identical source no longer gains or loses words with runner networking.

Manual workflow dispatch accepts a bounded worker count of `1`, `2`, or `4`;
the measured default is **2**. Before `BI-CC7CA516`, all three settings
completed 201/201 routes with zero failures, but `/admin/reference-data`
dominated every run at roughly 11-13 minutes. PR #3690 bounded that route:
worker 2 then completed the full inventory in 193,207 ms and worker 4 in
182,988 ms, both with zero failures. Four workers saved only about ten seconds
while doubling browser concurrency and slowing the corrected route from
2,188 ms to 4,266 ms, so two remains the lower-load reliable default.
Each worker owns an authenticated browser context and each route owns a fresh
page, so route teardown cannot interrupt the next navigation.

The accessibility phase evaluates the same WCAG-tagged axe rules against the
same complete served DOM, but requests only the `violations` result group that
the gate consumes. Per the
[axe-core performance guidance](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md#use-resulttypes),
the other result groups add selector/detail processing, not rule coverage;
limiting their detail avoids work for thousands of passing/inapplicable nodes
on large pages while preserving the serious/critical violation count.

The checked-in route-budget ratchet may move from `bootstrapped:false` to
`bootstrapped:true` only after:

1. two baseline artifacts from consecutive runs on the same SHA are mechanically
   reproducible: route sets and semantic structure are exact, count axes are
   exact, and word axes differ by no more than the ratchet's measured two-word
   noise floor;
2. both runs measure all 201 eligible routes with zero failures;
3. `pnpm --filter web ux:sweep-merge-baselines -- --first <run-one.json>
   --second <run-two.json> --output <accepted.json>` produces the conservative
   envelope, and an enforcing run against it reports zero regressions;
4. the 1/2/4-worker experiment records completion, variance, failures, and
   sweep duration.

Functional UX journeys remain separate evidence. This sweep measures structural
and cognitive-load budgets; it does not prove login, persistence, or workflow
outcomes.

## Baseline snapshot

Checked-in seed report (structure only; metrics fill from calibration runs):

- [`docs/testing/ci-observation-baseline.json`](./ci-observation-baseline.json)

Update that file from calibration outputs when publishing a measured baseline (not invented percentages).
