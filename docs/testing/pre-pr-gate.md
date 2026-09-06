# Pre-PR test gate

Every pull request against `main` runs the full DPF unit-test suite as a binding
merge gate. **Tests run before merge — if they fail, fix in place, don't
push-and-pray.**

This doc is the detailed reference for the **test** portion of the build gate.
It does not redefine doctrine: [AGENTS.md §5 (Build Gate)](../../AGENTS.md) and
[§6 (canonical-runtime evidence)](../../AGENTS.md) own *what* must pass and
*where* it must run. When this doc and AGENTS.md appear to disagree, AGENTS.md
wins and this doc is the bug — fix it.

---

## The contract (read this first)

Cross-session drift happens when each session reconstructs the workflow from
prose. Don't. Before you open a PR, in order:

1. **Branch guard.** You are on a topic branch in a worktree, not on `main` and
   not in detached HEAD. (AGENTS.md §4.)
2. **Pre-commit gates fire on every commit** — staged secret scan + affected-package
   typecheck. They are auto-wired; do not bypass them (see [§ Pre-commit gate](#the-pre-commit-typecheck-gate)).
3. **Run the gates your change requires, on the right substrate** — see
   [§ Which gate runs where](#which-gate-runs-where). Source-local checks
   (targeted `vitest`, `typecheck`) can run in a `compile-ready` worktree;
   runtime-bound checks route through the canonical install or the shared
   local-CI convergence sandbox lease.
4. **Push the branch.** Local commits are invisible to CI. (AGENTS.md §4.)
5. **CI is the binding gate, not your local run.** Your local pass is evidence
   the PR will go green, not a substitute for it. The PR cannot merge until the
   **Unit Tests** check passes.

If a gate did not execute because the worktree could not host its runtime, that
is an **unrun gate, not a passed gate and not a red gate**. Re-run it via the
sandbox lease and record that evidence. Never report "tests passed" without
naming the substrate it ran on (AGENTS.md §15).

---

## Which gate runs where

This is the single biggest source of drift, so it gets the decision table. A
worktree is **source-control isolation, not a second DPF install**
([kernel principle](../founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md)).
Per-worktree runnable runtimes deliberately do **not** scale to the 1k–10k
concurrent worktrees DPF expects — runtime-bound gates lease one shared runtime
instead.

| Gate | What it proves | Where it runs |
| --- | --- | --- |
| Targeted `vitest` / `pnpm --filter <pkg> typecheck` | Source-local correctness of files you touched | **Worktree** if `.dpf-worktree-readiness.json` says `compile-ready`; otherwise route through the sandbox |
| Full root `pnpm test` (the CI-equivalent aggregate) | The whole suite is green | **Canonical local install** (root clone Docker stack) or the **shared local-CI convergence sandbox** lease |
| `next build`, UX verification, migration apply | Runtime-bound behaviour | **Canonical install** or **sandbox lease** — never a worktree `next dev`/`next build` |
| The **Unit Tests** CI job | The binding pre-merge gate | **GitHub Actions** (authoritative) |

**Harness friction inside a worktree** — missing pnpm/corepack on PATH,
workspace symlinks pointing outside the worktree, missing generated Prisma
client, Next/Turbopack rejecting cross-workspace symlinks — is a **harness
limitation, not a product defect**. Do not file it as a bug, and do not let it
become an excuse to skip the gate. Route the gate through the convergence-sandbox
lease (`claim_nonprod_environment_lease(environmentKey="local-integration-ci")`)
and capture that as the evidence. See AGENTS.md §5 "Where each gate runs".

---

## What runs in CI

The root `pnpm test` script is:

```jsonc
"test": "pnpm -r --if-present --workspace-concurrency=1 --no-bail test"
```

It runs the `test` script in **every** workspace that defines one, one workspace
at a time (`--workspace-concurrency=1`), and `--no-bail` means it keeps going
after a failure so you see every failing package in one run, not just the first.
Today that resolves to:

- `apps/web` — vitest
- `packages/db` — vitest (needs a real Postgres)
- `apps/mobile` — jest (Expo + React Native)

All must pass. The suite is in the thousands of tests and must sit at **0
failures on `main`**; the live count is whatever the **Unit Tests** job reports
on the latest `main` run — don't hard-code a number here, it goes stale.

### Policy guard profiles

Fast deterministic checks are registered in
[`scripts/lib/ci-policy-guards.mjs`](../../scripts/lib/ci-policy-guards.mjs).
The registry preserves the former job name, display name, command sequence, and
profile for every migrated guard. The runner executes every named entry even
when an earlier entry fails, then writes a per-guard pass/fail/duration table to
the GitHub job summary and a machine-readable artifact.

The profiles reflect execution substrate, not separate policy inventories:

- `source` uses Node plus the isolated guard-AST runtime;
- `workspace` uses the pinned full workspace graph for checks such as prose
  lint and the executable FPAW standard/inventory conformance guard; and
- `pull-request` uses PR event context and trailers.

#### Re-evaluating a trailer or label without pushing

Several `pull-request` guards — Seed Contribution Fit, UX Fit, Design Grounding,
Docs Impact — tell you to add a trailer such as `Seed-Fit-Decision:` to the PR
body, or to apply a label. **Editing the body alone used to do nothing.**
`ci.yml` declares `pull_request:` with no `types:`, so it fires only on
opened / synchronize / reopened; `edited` and `labeled` never reached it. The
only way to re-evaluate was to push, which also re-STALEs a `pregate` record
keyed to the previous SHA.

[`.github/workflows/policy-guards-recheck.yml`](../../.github/workflows/policy-guards-recheck.yml)
closes that (BI-6868891B). It runs the same `pull-request` profile on
`edited` / `labeled` / `unlabeled` only, and posts **`Policy Guards (recheck)`** —
a separate, advisory check. Add your trailer, wait for the recheck, and you know
whether the fix is accepted before spending a push.

It is deliberately **not** the binding check, and `ci.yml` is deliberately
unchanged. Check runs are keyed per commit SHA and the latest result for a name
wins, so re-running the pipeline on an edit while skipping the heavy jobs would
post `skipped` conclusions that branch protection treats as satisfied —
overwriting a real failure already recorded on that SHA. A PR whose Unit Tests
genuinely failed would go green because someone fixed a typo in the description.
The recheck workflow uses a distinct check name and its own concurrency group,
so it can neither overwrite `Policy Guards (PR)` nor cancel a running CI job.

`pregate:preflight` and `pr:ready` consume all locally honest checks from these
same profiles. In a source-only worktree, a missing workspace runtime is
reported as environment-skipped and remains CI-enforced; in a compile-ready
worktree, prose or FPAW semantic drift is therefore found before the sandbox
lease or PR. The FPAW guard reconciles canonical archetype/category ownership,
matrix and deviation structure, closed vocabularies, requirement/reference and
profile-dependency closure, worked profiles, and source-governance records.

Consolidation follows a fail-safe promotion sequence:

1. run the profile as a non-blocking shadow beside every legacy job;
2. compare the named results on the same PR tree;
3. remove `continue-on-error` and disable legacy runner allocation only after
   parity;
4. prove the blocking profiles on GitHub, then remove the disabled definitions.

`scripts/ci-policy-guards.test.mjs` freezes the complete legacy-job inventory:
a removed or duplicated registry entry fails CI, and a migrated legacy job
cannot silently regain a standalone runner or merge-readiness dependency.
Exact-tree parity on PR #3675 run `30309641352` matched all 34 named guards.
Blocking proof on PR #3678 run `30313483522` then passed with every legacy job
skipped before the definitions were removed. This reduces repeated runner,
checkout, and Node setup without collapsing guard identity or weakening
`Merge Readiness`.

## Where CI runs it

Wired up in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) as the
`test` job (display name **Unit Tests**). The job:

1. Provisions a Postgres 16-alpine service for tests that need a real DB (the
   `@dpf/db` suite primarily).
2. Installs deps with the frozen lockfile.
3. Generates the Prisma client and applies migrations.
4. Runs `pnpm test`.

CI fails the PR check if any test fails. Branch protection requires the check to
pass before merge.

## Run locally before pushing

In a `compile-ready` worktree, run the source-local slice that covers what you
touched:

```bash
pnpm --filter web test        # touched apps/web?
pnpm --filter @dpf/db test    # touched packages/db?  (needs Postgres)
pnpm --filter mobile test     # touched apps/mobile?
```

To reproduce the full CI aggregate, run `pnpm test` against the **canonical
install or the sandbox lease**, not a bare worktree (`@dpf/db` needs a live
Postgres and the mobile suite needs the RN toolchain — both are runtime, not
source-control, concerns).

Rough timing on a modern laptop: the `apps/web` suite alone is ~2–4 minutes; the
full root `pnpm test` adds ~1–2 minutes for `@dpf/db` and the mobile jest suite.

## The pre-push gate (`pregate`) — default-on

BI-166C59F3 Phase 1 added the shared local-CI convergence sandbox workflow;
BI-C74F4DE9 made it mechanically enforced (the gate used to be dormant — the
`pre-push` hook only ran Git LFS and never chained the gate). The sandbox
runtime is declared in `docker-compose.local-ci.yml` behind the `local-ci`
profile. A versioned slot manifest owns every mutable identity: scratch
checkout, process fence, Compose project, portal and PostgreSQL ports,
container/database/volume, dependency convergence state, output, and evidence.
Every entry point derives that manifest from the same canonical Git common-dir
identity. In a conventional clone, `<clone>/.git` resolves to `<clone>`; in the
centrally managed worktree fleet, the bare `.opendigitalproductfactory.git`
directory is already the root identity. The scratch checkout is then created
as a sibling under `<root>-worktrees` (slot 0 uses `.local-ci-runner`), and
cleanup is fenced to that exact manifest-owned scratch boundary. Gate, runner,
status, and cleanup code must not independently derive the root from the topic
worktree path: doing so can point cleanup at a different sibling and is rejected
before host state is mutated.
Slot 0 preserves the singleton portal on `http://localhost:3010` and uses its
dedicated PostgreSQL endpoint on port `15432`; it may still consume shared,
read-only or concurrency-safe development services such as Qdrant and Neo4j.
Slot 1 is declared and testable, but automatic admission remains fixed at one
until BI-A4427AB8 runs the separately governed capacity pilot.

From a worktree, the gate is:

```bash
pnpm run pregate            # → node scripts/pregate.mjs
```

**Guard parity preflight (BI-D35433FB).** Before the gate claims a
`local-integration-ci` lease, `pregate.mjs` runs the deterministic CI policy
guards host-natively — the same check commands CI's Policy Guards jobs run
(module size, style drift, derived-artifact staleness, doc links, SBOM, plus
the workspace-dependent prose ratchet, and the commit-range-driven UX-Fit and
Design Grounding trailer gates), with guard self-tests stripped and
PR-body-dependent gates (Seed-Fit, Decision Baseline) left to CI.

**Not every `node --test` is a self-test (BI-7B249AFE).** Some files in the
guard profiles assert **live repository state** rather than guard logic, so
stripping one removes the only check on the tree being pushed and the preflight
reports clean where CI fails deterministically — measured on #4737, where the
preflight said "52 guards clean" and CI then failed on
`check-instruction-plane-rule-coverage.test.mjs`. Those commands are marked
`conformanceTest(...)` in `scripts/lib/ci-policy-guards.mjs` and run host-side.
The mark is not discretionary: `scripts/check-guard-conformance-marks.mjs`
detects the shape (a repo root bound from `import.meta.url`, read through) and
fails when a detected file is unmarked, so a new repository-reading self-test
cannot quietly rejoin the stripped set. 15 files carry the mark today, costing
about 11s. Genuine guard unit tests stay stripped — over-marking would turn the
preflight into the full CI suite. A violation
aborts in well under a minute **before any lease is claimed**, so a doomed run
never occupies the contended sandbox slot. A guard this host cannot execute
(missing isolated or workspace runtime) is reported as
`environment-skipped` with its remedy — a warning, never a false red; CI
remains the enforcer. A guard the host *killed or refused to spawn* — an
OS-refused launch, or a signal/`taskkill /T` during a local-CI eviction, which
leaves `spawnSync` `status: null` — is reported as a **runner failure**, not a
guard violation (BI-AA2EE621): a transient host-pressure condition, retried
before it is believed, warned rather than mislabelled "deterministic", and left
to CI/the sandbox to enforce. The Repo Guard Loop runner
(`scripts/check-guards.mjs`) applies the same distinction to its own child
guards and exits with a dedicated runner-failure code so a killed spawn never
prints `N/24 guard(s) FAILED` naming an innocent guard that had, in fact, run.
Run it standalone with `pnpm run pregate:preflight`
(`--plan` prints the guard plan without running it, scoped to the diff;
`--scope` prints the classified change scope and the guards it left out). **The preflight honours the change
scope (BI-8CDA7F95).** It classifies the diff against `origin/main` with the
same `scripts/ci-change-scope.mjs` classifier `ci.yml` branches on, and on a
docs-only diff it leaves out only the guards that **declare** `inputs: ["code"]`
in `scripts/lib/ci-policy-guards.mjs` — guards that read only source, schema,
compose or package manifests and so cannot be violated by prose. A guard with
no declaration always runs; an unknown scope (no merge base) runs everything; a
static test fails any declared guard whose import closure reads docs. CI still
runs every guard. Emergency skip:
`DPF_SKIP_PREGATE_PREFLIGHT_REASON="<why>"` — printed on the gate run, and CI
still enforces every guard. Routing probes (`--dry-run`) and evidence replays
(`--finalize-evidence`) skip the preflight automatically.

**Documentation evidence lane.** After preflight and before any
`local-integration-ci` lease claim, the Node gate checks whether the committed
candidate is an exact documentation-only tree. This lane is deliberately
fail-closed: `HEAD` must equal the requested SHA, the worktree must be clean,
the candidate must contain the current `origin/main`, and the authoritative CI
evidence planner must select `executionLane: documentation` with no full suite.
Two architecture documents that need the workspace runtime remain excluded.
If any check is missing, stale, or ambiguous, the gate falls through to the
normal exhaustive sandbox path.

An eligible documentation tree runs doc-index freshness, link integrity, and
the complete repository guard loop in the worktree. It records the planner
digest, candidate tree, commands, output, and result through
`record_local_integration_result`, then writes the same SHA-bound local gate
state used by `pregate:status`. Its evidence carries no lease id because it
never enters the scarce sandbox. A failed documentation check is a failed gate;
it does not retry by consuming the heavyweight lane.

**Host-native/Node-first entry point (BI-2272D840, BI-52500C0D, BI-4BE30454).** `pregate.mjs`
routes to `scripts/gate-worktree.mjs` by default on every host. The Node-native
gate owns the lease-claim / heartbeat / fenced-run / descendant-quiescence /
evidence-record / lease-release flow, so lease/fence safety has one canonical
implementation. `scripts/gate-worktree.sh` remains a compatibility entry point
and delegates to the Node gate; set `DPF_PREGATE_FORCE_SH=1` only for focused
shell-adapter debugging. Missing native `sh` is therefore classified as
**sandbox-routable, never a build blocker**.

The exhaustive Node and compatibility-shell paths produce the same sandbox
evidence shape (manifest version and slot, branch/SHA, integration tree,
database and Compose identity, production artifact, lease id, freshness
verdict, toolchain fingerprint, expiry). The documentation lane produces a
smaller planner-bound evidence record. All three write the same
`.git/dpf-local-ci-gate.json` state file, so the pre-push gate accepts a fresh
pass without caring which eligible lane produced it. `DPF_PREGATE_FORCE_NODE=1`
preserves the default. `DPF_PREGATE_FORCE_SH=1` is explicit legacy-shell
debugging and still requires a working shell.

The gate claims a `local-integration-ci` lease (waiting if the sandbox is
already leased). A canonical waiter refreshes its idempotent claim well inside
its liveness window, while an admitted owner receives a two-minute authority
window and heartbeats at no more than one third of that effective TTL. This
bounds recovery when the supervisor disappears without shortening the maximum
queue wait. The gate runs the command, releases the runtime slot, records a
local-integration evidence record with the lease id and `gatePassed`, and
writes the latest gate result to Git-local state
(`.git/dpf-local-ci-gate.json`, with a slot suffix for non-default slots). A
pass on one slot retires any non-passing sibling-slot record for the same
branch and SHA as `superseded`, and every reader of that state (`pregate:status`,
the pre-push hook, `pr:health`, the PreToolUse publish guard) consults all
slots, so an earlier attempt on another slot cannot shadow a real pass. It
overwrites stale state with `admitted` and then `running` as soon as it owns the
sandbox, before the expensive command mutates the runtime. If the child wrapper
exits before a terminal record is written, `pregate` reads that running state,
best-effort releases the recorded lease, and rewrites the local gate record as
failed so pre-push cannot trust a stale pass. Renewal loss is
fail-closed: before further sandbox mutation the gate terminates its complete
child process tree, records a fenced outcome, and releases idempotently.
Transport failure is uncertainty rather than proof of ownership loss: the gate
records the failure and retries only inside its last known authority window. A
separate deadline terminates the child tree before that window expires if no
successful renewal advances it. MCP requests have their own bounded transport
deadline, so a hung heartbeat cannot outlive the lease silently.

**Equivalent gate requests are single-flight.** Before admission, the gate
builds the exact merge-tree evidence plan and fingerprints the host toolchain.
The server derives one immutable key from repository, integration tree, plan
digest, toolchain fingerprint, and gate kind; caller session identity is only
attribution and never part of that key. The first caller owns the queued or
admitted lease. A later equivalent caller receives `subscribed` and observes
the canonical execution without renewing, releasing, recording evidence, or
starting the command. Once the owner links a fresh terminal pass or fail
receipt, later callers receive `reused` and stop without recomputation.
Mismatched, inconclusive, or expired evidence remains fail-closed: evidence
exists and does not fit, which is a real conclusion.

**A run that DIED is not a verdict.** A terminal lease carrying no
evidence record describes an execution that never reported — the executor was
killed, or the portal rejected its status write. Since the immutable key hashes
the integration *tree* rather than the commit, refusing such a claim used to
brick that tree permanently: a fresh commit of identical content reproduces the
key and the refusal, and `claimKey` is unique, so the dead row is the tree's only
route back to the gate. The claim now revives that row and runs again. Nothing is
reused, so nothing is weakened. Two rules keep it honest: the gate records
*something* even when the portal rejects its status — an unknown status is
recorded as `failed` with the real class in the summary — and a parity test
asserts every status `classifyGateOutcome` can emit is one
`record_local_integration_result` accepts, from the single closed set in
`scripts/lib/local-integration-status.mjs`.

The same identity rule coordinates assembled semantic review through the
existing `TaskRun` carrier: one caller dispatches, concurrent callers subscribe,
and fresh pass/fail receipts are reused. Durable suspension and notification
after the current bounded observation window are a separate workflow concern;
single-flight does not invent a second queue, waiter table, or process authority.

Admission also takes an atomic slot-local owner fence in the shared Git
directory. A competing claimant for that slot waits while the fence's PID is alive even if
an older database TTL has elapsed; a dead PID is reaped as an orphan. The
admitted waiter renews its database authority while it waits for that host
fence and refuses to acquire the fence near its last known expiry. The database
lease remains the governed cross-process record, while this local
fence closes the host process-liveness gap the database cannot observe.
The requested expiry is calculated for each claim observation after queue
admission, and the service grants a fresh admitted-owner window at promotion,
so time spent waiting never consumes the acquired owner's TTL.
The canonical gate samples the local-CI command process tree while the command
runs, remembers observed descendants, and before releasing the lease/fence waits
briefly for remembered descendants to exit or terminates them. This keeps a
later claimant from entering the sandbox while an earlier gate still has live
child, grandchild, or tool-spawned build/test processes. The shell adapter
execs the Node gate immediately, so POSIX hosts use the same long-lived
fence-owner process as every other host. Windows process-tree snapshots are
intentionally sampled more slowly because each WMI/CIM process-table read is
itself a heavyweight host operation; `DPF_GATE_PROCESS_SCAN_MS` and
`DPF_GATE_DESCENDANT_POLL_MS` remain explicit debugging overrides.

While a `local-integration-ci` lease is active, the portal reserves the shared
host against new local inference dispatch. The common completion adapter and
embedding choke point consult the same lease registry immediately before local
provider contact; a local-only request receives a typed capacity deferral,
while an eligible cloud fallback remains available. Registry uncertainty fails
closed for local inference only. This exclusion addresses the observed temporal
overlap between post-admission local-provider/model residency and the Windows
host free-memory metric crossing the CI fence; it does not claim that Docker's
displayed model size is ordinary RAM, conflate GPU VRAM with physical memory,
or infer the Docker/WSL/shared-memory mechanism. It also does not terminate a
model that was already resident before admission.

**The fence measures available memory, not free memory (BI-EB6DBAF0).** The
execution-pressure fence revokes an admitted lease when the host observation
reports less than 4 GiB. That observation is reclaimable-inclusive: `vm_stat`
free + inactive + speculative + purgeable on Darwin, `/proc/meminfo`
`MemAvailable` on Linux, with `os.freemem()` kept only as a last resort so a
wedged probe cannot wedge the gate. `os.freemem()` alone reports the free page
pool, which excludes memory the kernel returns on demand — on a 128 GiB macOS
host it read 17.5 GiB against 47.5 GiB genuinely available. Measuring the free
pool made the gate fence its own work: `next build`, running under the 16 GiB
heap the gate had just granted, drove the free pool under the floor while tens
of GiB stayed reclaimable, and the run was killed as `host-memory-low` after
its tests had already passed. A reading that matched only the free bucket is
refused rather than reported as available.

**Fail-fast command order (BI-7BCCDE3D).** Inside an admitted runtime-code
gate, freshness, Prisma generation, migrations, and the cheap doc/repository
guards run first. Web typecheck then runs before exhaustive Vitest, followed by
the production build. This preserves every successful-candidate proof while
returning a definitive compile/type-generation failure before the shared slot
spends several minutes on tests that cannot make that candidate buildable. The
executor contract uses the real Windows plan with an injected typecheck exit 2
and proves that neither Vitest nor the Docker production build is launched
afterward. Against the motivating failure, this avoids at least the observed
221.10 seconds of exhaustive test work; green candidates still execute the
unchanged exhaustive suite and production build.

**Production-build control-plane boundary (BI-CE6E2882).** On Windows, the
production build runs in a resource-bounded BuildKit container while the gate
independently probes the portal, MCP, Docker Engine, and live PostgreSQL. The
live database is intentionally not required to publish port 5432 to the host:
the default probe executes `SELECT 1` through `psql` inside the configured
PostgreSQL container, using its own `POSTGRES_USER` / `POSTGRES_DB` identity.
An explicit `DPF_CONTROL_PLANE_DATABASE_URL` remains the portable override for
non-container deployments. Never infer the host endpoint as
`127.0.0.1:5432`; Compose may keep PostgreSQL internal-only or publish it on a
different host port.

Claim, heartbeat, signal/fence, and release timestamps are included in the
evidence and Git-local state. An expired TTL is never permission for the old
owner to continue working. The gate does
**not** publish the branch by default (BI-76551B2D); push/publication is a
separate step after local evidence exists. The legacy push-before-lease behavior
is available only as an explicit `scripts/gate-worktree.sh --push` (or
`scripts/gate-worktree.mjs --push`) operation for recovery/transition cases
that intentionally need it.

### Reading the result — ask the record, not the run

```bash
pnpm run pregate:status
```

That is the whole answer, and it is the only signal you should act on. It reads
the SHA-bound gate record plus the schema-versioned metadata record, and prints
one verdict — `PASS`, `FAIL`, `STALE`, `PENDING`, or `NO-RECORD` — with the
bound SHA, how it compares to current HEAD, and how old it is. **It exits 0 only
for a `PASS` bound to the current HEAD**, so `pnpm run pregate:status && git
push` is a correct composition. Add `--json` for machine use. It never claims a
lease and never runs a gate, so it is safe to call at any time, including while
someone else's gate is mid-run.

Everything else about a pregate run lies in a documented direction, which is why
the reader exists (BI-B1065D41):

| Signal | How it lies |
| --- | --- |
| The **exit code** | `pregate …; echo $?; tail …` reports *tail's* status. A run that gives up while queued, or reports 0 with no PASS record at HEAD, now exits **7** instead of 0 (the historical exit-0 lie was BI-2C7F51BA) — but a chained/piped reading still surfaces someone else's status, so the record remains the verdict. |
| The **log tail** | A *tolerated* `GuardRuntimeEnvironmentError` prints `Error:` and a red ✖ ~28,000 lines before a **passing** verdict. A watcher grepping `Error:` fabricates a failure. |
| **`gate passed`** | True about the run you watched; silent about whether HEAD has moved since. `pregate:status` compares. |

`gate passed` remains the last line of a passing run and is still a valid
anchor *for that run* — it is what the closing summary block ends with. It is
just not the thing to build automation on.

**How to invoke it.** Run `pregate` in the **foreground**, unpiped, as the sole
command. On timeout the harness migrates a foreground run to the background and
it **continues** — that is the working path, and it is the opposite of the
intuitive choice. Do not background it (`&` or `run_in_background`: the harness
caps and kills it mid-install), do not chain another command after it with `;`
or `||` (you get that command's exit code), and never wrap it in `timeout`
(cutting it off mid-queue manufactures a false green and leaves a stale lease
pinned to the **old** SHA). `pregate-invocation-guard.mjs` denies all four
shapes at the tool edge on Claude, Codex, and Grok.

Queue contention is not a reason to reach for `DPF_SKIP_PREPUSH_GATE` — with a
valid record for the head SHA the push is admitted normally.

**Output.** A run prints roughly 30 lines: admission, the full-log path, a
periodic progress heartbeat, and a bounded closing summary. The complete
~28,000-line transcript goes to the log file whose path is printed before the
long stage begins. `DPF_PREGATE_VERBOSE=1` restores the full mirror for
debugging the gate itself.

**The gate command has a checked-in default (BI-157DC9B2, BI-4BE30454):**
[`scripts/local-ci-runner.mjs`](../../scripts/local-ci-runner.mjs) runs the
canonical merged-code plan (`scripts/lib/local-integration-ci.mjs`: checkout
the admission-resolved accepted-base ref, `origin/main` by default → merge
candidate → sandbox-freshness converge → typecheck → exhaustive Vitest → production build)
in a dedicated **non-mutating scratch worktree** (`~/dpf-worktrees/.local-ci-runner`
for slot 0 and a manifest-owned sibling for slot 1) — never in your topic
worktree.

**BuildKit session cool-down (BI-C85D1B0A).** The production-build stage uses a
managed builder (`dpf-local-ci-buildkit-vN-S`) with resource ceilings and an
in-daemon GC budget (`scripts/config/local-ci-buildkitd.toml`). When the build
ends, the gate **stops** that builder (`docker buildx stop`) so multi-GiB idle
RAM is not held between pregates; disk layer cache is retained under GC. Set
`DPF_LOCAL_CI_BUILDER_KEEP_WARM=1` only for debugging. Obsolete policy-version
builders are removed on the next ensure. See
[`docs/superpowers/specs/2026-08-10-buildkit-session-lifecycle-design.md`](../superpowers/specs/2026-08-10-buildkit-session-lifecycle-design.md). It records content-addressed
metadata to `.git/dpf-local-ci-metadata.json` and into MCP evidence: candidate
ref/SHA, base ref/SHA, integration commit SHA, synthesized tree SHA, command
list, timestamps, slot key, Compose/PostgreSQL identities, the exact production
artifact identity, whether the accepted base was proven `remote-current`,
explicitly `offline-accepted`, or stopped as `fetch-failed`, toolchain
fingerprint, and gate-evidence expiry. The evidence
also carries a `resilience` envelope: `publicationMode` (`deferred` by default
or explicit `push-before-lease`), `acceptedBaseMode` (the same authoritative
freshness status), and `networkTolerance` (`explicit-offline` only when the
operator selected offline accepted-base mode).

Online refresh is the default. After the lease admits the run, the runner uses
the shared-safe fetch helper to refresh `origin/main`, resolves one immutable
base SHA, and passes that SHA to the child plan without fetching again. A
failed fetch records `fetch-failed` and exits before integration synthesis or
expensive gates. This admission boundary avoids repeated rebase/rerun churn
while queued; later movement on `main` is reconciled by the merge queue.

Offline operation must be explicit:
`--offline-accepted-base` or
`DPF_LOCAL_CI_OFFLINE_ACCEPTED_BASE=1`. In that mode,
`DPF_LOCAL_CI_BASE_REF` may point at another locally available accepted-base
ref and evidence is labeled `offline-accepted`. `--fetch-base` and
`DPF_LOCAL_CI_FETCH_BASE=1` remain compatibility aliases for the default
required online refresh. `DPF_LOCAL_CI_COMMAND` remains an explicit override. The
old Phase 1 stub is only reachable via `DPF_ALLOW_LOCAL_CI_STUB=1` for contract
tests and must never be used as release evidence.

The command plan carries required process environment as `env NAME=value ...`
prefixes, and the Node runner interprets those prefixes directly instead of
depending on a host `env` executable. This keeps the 16 GiB `NODE_OPTIONS`
headroom required by the current route graph on both POSIX and Windows
typecheck paths; the production build may
still use the host-specific strategy selected by the plan. Vitest runs with
Node's experimental host web-storage disabled so Node 26 cannot shadow the
`localStorage` and `sessionStorage` implementations owned by jsdom. This is a
test-runner compatibility setting, not a change to application runtime policy.

Web typecheck and exhaustive Vitest are supervised rather than invoked as
opaque child processes (BI-872CB1BF). Vitest first runs the unchanged full suite with four
workers and streams verbose progress while retaining a bounded output tail,
the last completed test, host-memory samples, and the Vitest descendant process
tree. A genuine failed-test summary is terminal product evidence and is never
retried. A missing/sentinel exit status, signal/spawn error, or summary-free
nonzero exit is runner evidence; the supervisor retries the same full suite
exactly once with two workers. If that differentiated attempt also terminates,
the gate exits 86, records both attempts in
`dpf-local-ci-metadata.json.vitest.json`, and classifies the result as runner
evidence rather than a product test failure. Local-CI writes its main metadata
on failure as well as success so this diagnostic survives lease release.
If the supervisor host itself disappears, the next exact-tree run recognizes
the stale running receipt and starts directly at the two-worker differentiated
profile; it does not repeat the already disproven four-worker profile. The
selected execution profile is persisted before the child launches. If a later
host also disappears during that same differentiated profile, the receipt is
terminal retry-exhaustion evidence: the wrapper exits 86 without spawning an
unchanged third attempt. Another run requires a materially changed runner or
integration identity.

With a valid sandbox-pool policy, admission is capacity zero whenever current
memory, CPU, disk, Docker, dependency-convergence, slot-fence, or evidence-
isolation input is unsafe or unmeasurable. The lease supervisor continues
sampling after admission and fences the active stage child for hard memory,
disk, Docker, slot-fence, or evidence-integrity loss. CPU pressure blocks new
admission but does not kill an active stage, and dependency convergence keeps
its separate quiescence fence. A release or expiry preserves the queue without
blind promotion; the FIFO head is admitted only after its next poll supplies
fresh safe host evidence.

A live queued `local-integration-ci` claim also reserves the next safe host
window against **new** local-provider dispatch. Active local inference is never
terminated: it finishes normally, while completions, embeddings, semantic
review, background triage, and future local routes receive the same typed
queued-capacity deferral until the FIFO head can admit. The reservation is
bounded by the queue claim's existing heartbeat and expiry, so an abandoned
waiter cannot suppress local inference indefinitely. Cloud providers do not
consume this host reservation.

Every queued observation persists its queue position, wait age, resolved pool
policy (including `rollbackReason` and effective slot capacity), and paired
host-pressure sample in the candidate's SHA-bound gate state. Later recovery or
terminal writes retain the latest admission record. Diagnose a timeout from
that durable record; do not infer the refusal from process residency, cancel
and recreate a healthy FIFO claim, or conflate Docker model residency and GPU
VRAM with Windows physical-memory telemetry.

**A queue and a closed pool are two different waits, and the gate says which.**
When the host rollback contracts the pool to `effectiveCapacity: 0`
(`host-stage-headroom-low`, `host-memory-low`, `host-observation-stale`, ...),
no slot can admit anyone, yet the claim is still parked with
`admission.status: "queued"`. The waiting line then reads
`local-CI pool is CLOSED (<rollbackReason>)` instead of `queued at position N`,
the queued lease event and the durable-wait record carry `poolClosedReason`,
and `pnpm run pregate:status` names host pressure rather than "the gate did not
run". Behind a queue you wait; behind a closed pool you free host memory (on a
Windows host, usually the WSL page cache held by `vmmemWSL`) or wait for the
pressure to pass. Waiting in line does nothing for a closed pool
(BI-D908DA0A). A fenced run likewise records *which* fence fired
(`fence reason: lease-authority-deadline`, ...) in its gate record, so a
self-fence never reads as a reasonless failure of the diff (BI-ECAE03F7).

Typecheck writes a separate `web-typecheck` receipt before `next typegen &&
tsc --noEmit` starts, heartbeats the compiler descendant tree, memory, and a
bounded output tail, and records real compiler exits separately from opaque
runner termination. A passed typecheck receipt is reusable only for the exact
synthesized integration tree, command, and heap contract. This closes the same
stage-boundary loss observed when a gate wrapper exited `0xFFFFFFFF` after route
type generation while the compiler had emitted no diagnostic.

Long-running production builds use the same durable stage contract. Before the
Docker child starts, local-CI writes an exact-tree `running` receipt beside its
metadata and refreshes it on every control-plane watchdog sample with the child
PID and a bounded output tail. A normal exit writes the terminal build status.
If the host disappears, the stale running receipt identifies the interrupted
stage and last observation without inventing a terminating actor. A later run
may reuse a passed typecheck, Vitest, or build receipt only when the synthesized integration
tree and command/artifact identity match exactly; build reuse additionally
requires the current image ID to match the passed receipt, not merely for its
mutable tag to remain present. Setup, migrations, and guards still execute, and
every reused heavy stage remains bound to the exact merged tree, so recovery
does not weaken the merged-code gate.
The reused receipt is atomically updated with `lastReusedAt` and `reuseCount`,
so final metadata distinguishes an intentional exact-evidence reuse from a
stage that simply did not execute. Receipt replacement retries bounded
transient Windows `EPERM`/`EACCES`/`EBUSY` locks before failing, so a diagnostic
reader or endpoint scanner cannot turn a successful heavy stage into a false
gate failure.

The candidate wrapper owns the slot-scoped freshness-evidence handoff path. Before each
run it removes any prior report from the candidate gitdir and passes
`DPF_LOCAL_CI_FRESHNESS_REPORT_FILE` through the runner to the freshness
preflight in the scratch integration worktree. The preflight writes there and
the wrapper reads that exact path. This prevents the two linked worktrees'
different gitdirs from turning a green preflight into `freshness: unknown`, and
prevents a stale prior report from classifying a new run.

The sandbox-freshness step checks the load-bearing runtime and gate packages,
including the Vitest runner used by the next step. Vitest is checked for both
locked version and runnable entrypoint imports, so an incomplete package cannot
be recorded as a product test failure. If a stale top-level package link
survives in the scratch worktree, the preflight removes only the stale package
link inside the sandbox's own `node_modules` before its single governed
`pnpm install --frozen-lockfile` convergence pass. If the re-check still sees
dependency drift, it runs one bounded `pnpm install --force --frozen-lockfile`
retry to refresh the sandbox store/link graph; a second red verdict remains
`blocked_sandbox_drift`, never product evidence. The dedicated
slot scratch checkout has one final native recovery path: reset that exact
checkout's own `node_modules` and reinstall from the lockfile. The convergence
lock and scratch pnpm store are derived from the same manifest, so convergence
or cleanup in one slot cannot erase the peer's duplicate-install guard or
dependency graph.

The explicit-offline network-disconnect proof is encoded in
`tests/release/local-ci-gate-contract.test.mjs`: the contract denies network
Git verbs during `gate-worktree.sh`, selects offline accepted-base mode,
records local-only evidence with `networkTolerance=explicit-offline`, then
runs `.githooks/pre-push-gate` through
the same no-network Git wrapper and proves the same unexpired SHA-bound record
is sufficient for later publication.

**Quiescence-aware evidence recovery.** `pnpm run pregate` now preflights
`get_quiescence_status` once before the expensive gate. If the portal is actively
draining or swapping, the gate records `blocked_quiescence`, emits
`local_ci_quiescence_wait`, and parks with exit 75 before claiming the lease or
running the full local-CI command. It does not poll: rerun pregate after the
server-owned quiescence coordinator completes. If the expensive gate already passed but
`record_local_integration_result` is refused with `portal_quiescing`, the gate
writes `.git/dpf-local-ci-pending-evidence.json`, attempts
`release_nonprod_environment_lease`, and records
`evidencePending=true` in `.git/dpf-local-ci-gate.json`. After quiescence clears,
publish that saved evidence without rerunning local-CI:

```bash
pnpm run pregate -- --finalize-evidence --branch <branch> --sha <sha>
```

A successfully published PASS receives a bounded 24-hour evidence-validity
window anchored to the original gate result. That window is intentionally
independent of the short active-lease heartbeat: `expiresAt` authorizes
publication of the exact branch/SHA, while `leaseExpiresAt` preserves the
runtime lease boundary for audit. Finalization is idempotent and never extends
the original window. It can also attest a legacy already-published PASS when
the state branch, SHA, metadata candidate SHA, and evidence record ID all agree;
an expired 24-hour window still requires a new pregate.

The pre-push gate blocks `evidencePending=true` records until finalization
succeeds. Failure evidence also carries `failureSummary`, a bounded list of
failed tests/checks and omitted counts, plus an explicit pointer to
BI-A4EC0EA6 for code-graph impacted-test recommendations. The complete output
from the most recent run is retained outside the working tree at the git-private
path reported as `fullLogFile` in dry-run and evidence output; the bounded tail
and summary remain the default diagnostic surface.

**The pre-push hook chain is active by default.** The local `pre-push` file is
gitignored (git-lfs generates it), so the enforced logic ships as the tracked
[`.githooks/lib/pre-push-chained.sh`](../../.githooks/lib/pre-push-chained.sh)
— Git LFS first, then [`.githooks/pre-push-gate`](../../.githooks/pre-push-gate)
— and convergence rewrites the local shim to delegate to it. Convergence runs
in two places, both through the same sequencer
([`scripts/lib/converge-hooks-dir.mjs`](../../scripts/lib/converge-hooks-dir.mjs)):
`postinstall` (`scripts/set-hooks-path.mjs`) and **every session start**
([`scripts/hooks/converge-git-hooks.mjs`](../../scripts/hooks/converge-git-hooks.mjs)),
which also sweeps sibling worktrees. A hand-rolled custom hook is never
clobbered — convergence reports it and leaves it alone — and a tree missing
`.githooks/lib/pre-push-chained.sh` is skipped rather than given a shim that
would exec a missing script and fail every push. The gate refuses a push when the latest local-CI gate record is
missing, belongs to a different branch/SHA, has `gatePassed=false`, has no
`expiresAt`, or is past `expiresAt`. Not everything needs a record: docs-only
diffs vs the configured comparison base, delete/tag-only pushes, detached HEAD,
and `main` (merge-queue-governed) pass through. For offline/forge-neutral
installs, `DPF_PREPUSH_BASE_REF=<ref>`
changes the docs-only comparison base to a local accepted-base ref (default:
`origin/main`); if that configured ref is missing, the hook requires the normal
SHA-bound gate record instead of silently falling back.

**Convergence failures are reported, not swallowed.** Until
2026-08-27 this chain was never active on Windows. `set-hooks-path.mjs`
resolved its hooks directory with `new URL('../.githooks/', import.meta.url)
.pathname`, which returns `/D:/repo/.githooks/` on Windows; `path.join` turned
that into an unopenable `\D:\repo\.githooks\`, every `fs` call threw `ENOENT`,
and a bare `catch {}` discarded it. `postinstall` exited 0, `.githooks/pre-push`
stayed the stock git-lfs shim, and **a clean `git push` on Windows meant the
gate never ran — not that it passed.** The post-checkout uncommitted-work guard
was dead by the same path. Resolution now goes through `fileURLToPath`
([`scripts/lib/hooks-dir.mjs`](../../scripts/lib/hooks-dir.mjs)), and a
convergence that cannot complete prints a warning naming the consequence rather
than failing silently. If `postinstall` reports `could not converge
.githooks/pre-push`, the gate is not protecting your pushes — repair it before
relying on a green push.

**Verify by sweeping, never by spot-checking.** `head -4
.githooks/pre-push` answers for one tree, and one tree is not the estate: when
this was measured on 2026-08-26, **68 of 85 worktrees** on a single install
carried the stock shim and pushed with no gate. Two things made that possible.
Convergence ran only at `pnpm install`, so any tree not reinstalled since a fix
kept the dead shim; and it ran the tree's *own* copy of the converger, so a tree
sitting on a base that predated the fix could never repair itself — the fix
reached only trees that already had it. Session-start convergence closes both:
the session that just started is by construction running current code, and it
repairs its siblings. To check the whole estate at once:

```bash
for wt in $(git worktree list --porcelain | awk '/^worktree /{print substr($0,10)}'); do grep -q pre-push-chained.sh "$wt/.githooks/pre-push" 2>/dev/null || echo "UNGATED $wt"; done
```

Treat an ungated tree as a gate that has not run, not as a gate that passed: a
clean push from an ungated tree is byte-identical to a clean push from a gated
one, which is why the outage stayed invisible for a week.

The bypass is **recorded, never silent** — the reason is persisted into the
gate state file and surfaced by `pnpm pr:health` at PR time:

```bash
DPF_SKIP_PREPUSH_GATE=1 DPF_SKIP_PREPUSH_GATE_REASON="operator-emergency: WIP handoff, gate before PR" git push
```

**PR-time guard.** `pnpm pr:health` treats a runtime-code PR without local-CI
evidence as NOT READY: it needs a passing gate record for the PR head SHA, a
recorded push-time override with an **allowlisted reason code**, or a PR-body
trailer. Docs-only PRs are exempt automatically.

**`Local-CI-Override` is a closed code (BI-563F6AB6 P1), not free prose.** Agents
cannot green-wash a runtime PR with `Local-CI-Override: unit tests only` (or any
unstructured reason). Format:

```text
Local-CI-Override: <code>
Local-CI-Override: <code>: <optional audit detail>
```

Allowlisted codes (see `LOCAL_CI_OVERRIDE_REASON_CODES` in
[`scripts/pr-health.mjs`](../../scripts/pr-health.mjs)):

| Code | When it is legitimate |
| --- | --- |
| `docs-adjacent` | Prose/config that `isDocsOnlyFileSet` missed |
| `delete-or-tag-only` | Delete/tag publication (also hook-exempt) |
| `operator-emergency` | Named human consciously waived the gate |
| `external-contribution-no-install` | No local DPF install / cannot run pregate |
| `install-bootstrap-recovery` | Sandbox/install is the patient under repair |

Push-time `DPF_SKIP_PREPUSH_GATE_REASON` must use the same code format or
`pr:health` treats the recorded skip as a **blocker**, not a pass. The normal
path remains `pnpm run pregate` with **no** body trailer.

### Agent PreToolUse refuse (BI-563F6AB6 P2)

Claude / Codex / Grok PreToolUse runs
`packages/dpf-skill-pack/hooks/pregate-evidence-guard.mjs` on shell tools. It
**denies** `git push` and `gh pr create` when the worktree has no unexpired
SHA-bound `dpf-local-ci-gate.json` for HEAD (or an allowlisted skip). This is
the mechanical stop that prevents a surface from “finishing too fast” with only
worktree vitest. Emergency: `DPF_ALLOW_UNGATED_PUSH=1` (still subject to
`pr:health` / merge-readiness).

### Keep internal identifiers out of the PR body

The trailers above are a **fallback**, not the normal path: a branch gated
through `pnpm run pregate` satisfies the guard from its own push-time record, so
a normally-gated PR needs **nothing** in the body. Do not paste lease ids,
evidence record ids, candidate/base SHAs, session ids, or worktree paths into a
PR — a PR is public, and none of it is contract. One line is enough:

> Verified via the governed local-CI gate (exact-tree, merged against main).

The detail stays queryable on the install, keyed off the number a human actually
uses:

```bash
pnpm pr:origin 3748
```

That resolves the PR to its head plus every commit SHA and matches those
against this install's own gate records, reporting which client and which
client thread produced the change (and the parent thread, for a sub-thread).
Matching is by **SHA, not branch**: branch names get reused across threads and
deleted on merge, while commits are permanent. A PR with no local gate record —
an outside contribution — correctly reports no origin rather than a guess.

### Identify your client and thread

The gate records **who** ran it. It no longer defaults the provider (it used to
default to `codex`, so every client of every kind was recorded as Codex), and it
no longer derives the session from a pid (`gate-<pid>` changed on every re-gate,
so one thread looked like many contributors).

Identity is detected from the calling client's environment where possible.
When it cannot be, pass it:

```bash
node scripts/gate-worktree.mjs --owner-provider claude --owner-session-id "$CLAUDE_CODE_SESSION_ID"
```

or set `DPF_GATE_OWNER_PROVIDER` / `DPF_GATE_OWNER_SESSION_ID`. An unresolvable
**provider** stops the gate with a message naming the flag — the provider
vocabulary is a closed enum (`build-studio | claude | codex | grok | antigravity
| coworker`), so there is no honest value to fall back to. An unresolvable
**thread** does not stop the gate; it records `unattributed-<pid>` so the run is
visibly unattributed rather than falsely attributed.

**Pre-PR vs post-merge (do not confuse the runtimes).** "Pre-PR test" means
this sandbox lane — the lease + the runner above. "Test on :3000" (the
canonical install) is only meaningful **after** PR/merge/self-upgrade, because
:3000 serves merged, self-upgrade-deployed bytes; use `pnpm verify:preflight`
and the `dpf-verify-on-live-install` skill for that, never as a pre-PR branch
runtime.

For long or costly PR iterations, close the loop with the
[PR delivery post-mortem routine](../runbooks/pr-delivery-postmortem.md) so the
next waste pattern becomes backlog/docs/commons work rather than private memory.

## The pre-commit typecheck gate

A separate guard at [`.githooks/pre-commit`](../../.githooks/pre-commit) runs, in
order, on every commit:

1. A staged **Gitleaks** secret scan before bytes enter Git history.
2. `pnpm --filter <affected> typecheck` on `.ts`/`.tsx`/`.mts`/`.cts` commits,
   rejecting the commit on failure.

It does **not** run vitest/jest — that's CI's job. The hook path is auto-wired by
`postinstall` (`scripts/set-hooks-path.mjs` sets `core.hooksPath`). Emergency
bypasses exist for verified false positives only: `DPF_SKIP_SECRET_SCAN=1` and
`DPF_SKIP_TYPECHECK=1`. CI still gates the PR regardless of local bypass.

The local feedback loop is therefore:

1. **Pre-commit hook** catches secrets + type errors before they leave your machine.
2. **CI Unit Tests** catches behavioural regressions before merge.
3. **CI Production Build** (`next build`) catches Next.js build-time errors — a
   superset of typecheck, since some errors only surface at build.

## Test runner pins (must hold)

Two test-runner pins are load-bearing and enforced in CI.

### `apps/mobile` jest must stay on `^29.x`

Enforced by [`scripts/check-mobile-jest-pin.mjs`](../../scripts/check-mobile-jest-pin.mjs)
via the **Mobile Jest Pin Guard** job in `ci.yml`.

**History.** Dependabot bumped jest to v30 in PR #1037. The bump silently broke
every mobile test simultaneously and blocked every open PR for hours. PR #1053
reverted to jest `~29.7.0`. The current jest-expo (~56) does not yet support jest
30. Without this guard, the next Dependabot pass would re-introduce the break.

**If you need jest 30+.** Confirm jest-expo compatibility upstream first, then
remove this guard in the same PR that bumps the version, and add a note here
describing the compatibility evidence.

### `apps/web` and `packages/db` vitest

Previously pinned to `^4.1.5` because vitest 4.1.6+ broke
`@testing-library/jest-dom`'s vitest type augmentation. As of 2026-05-22 the pin
was lifted via a `packageExtensions` workaround in `pnpm-workspace.yaml` (see PR
#1055); both packages now track `^4.1.7`. No CI guard is needed — the workaround
restores the dropped `vitest` peer dependency that `jest-dom`'s `src/vitest.js`
imports at runtime. If `toBeInTheDocument`-style assertions regress on a future
bump, restore the pin or extend the workaround. Upstream:
[testing-library/jest-dom#662](https://github.com/testing-library/jest-dom/issues/662).

## Degenerate-environment fixtures

Modules that probe their environment (does `.git` exist? is `package.json`
readable? did the remote answer?) must be unit-tested against the world
production actually is — **partial, stale, absent, empty, plural** — not only
the healthy fixture. The dominant late-defect escape class is a probe whose
every test fixture modelled the healthy world: an image-synced partial tree
passed the availability probe and true citations were "refuted"; a federation
guard only passed because unit tests reused one link-id fixture; a large diff
exhausted the default exec buffer; and a transient failure was collapsed to a
terminal state.

Use the shared, dependency-free fixture kit
[`apps/web/lib/testing/degenerate-env/`](../../apps/web/lib/testing/degenerate-env/index.ts)
(importable as `@/lib/testing/degenerate-env`): `partialSourceTree()`,
`twoInstallIdentities()`, `oversizedPayload(bytes)`,
`flakySucceedsOnAttempt(n)`, `emptyAndNullRows(shape)` — each named after the
incident it models. An injected degraded resolver/stub that produces the same
shapes counts as equivalent.

The conformance registry
[`probe-conformance.test.ts`](../../apps/web/lib/testing/degenerate-env/probe-conformance.test.ts)
enumerates the known availability-probe modules and walks `apps/web/lib/**`
for the probe signature: a new probe module fails the suite until it is either
mapped to a test file carrying degenerate coverage or given an explicit
reasoned waiver there.

## Common drift, and how to stay on-script

These are the failure modes that recur across sessions, clients, and machines.
Name them so you catch yourself.

| Drift | Why it's wrong | Do instead |
| --- | --- | --- |
| Push with red/unrun tests, "CI will sort it" | Push-and-pray burns shared CI and blocks every open PR | Fix in place; only push when your substrate run is green |
| Worktree `pnpm test` fails on harness, so "it's broken" | Harness friction ≠ product defect | Route runtime-bound gates through the sandbox lease |
| "Tests passed" with no substrate named | An unnamed pass is unverifiable; hides worktree-only greens | State the substrate every time (AGENTS.md §15) |
| Reaching for `DPF_SKIP_*` to get past a hook | Bypasses are for verified false positives only | Fix the underlying error; CI gates it anyway |
| Verifying UX against worktree `next dev` | Not the production-bundled runtime | Use the canonical install or sandbox lease (AGENTS.md §13) |
| Treating a local green as the merge gate | The binding gate is the CI **Unit Tests** check | Local pass = evidence; CI pass = the gate |
| Reading a `pregate` exit code as the verdict | A pipeline surfaces the last command's status, not pregate's (an abandoned or uncorroborated run itself now exits 7, not 0) | `pnpm run pregate:status` — it reads the SHA-bound record and exits 0 only for a PASS at HEAD |
| Piping `pregate` to `head`/`grep` | The verdict is the LAST line, so a truncating reader removes exactly what you wanted (and it used to SIGPIPE-kill the run mid-install) | Let it print its ~30 lines; open the log path it prints for detail |
| Backgrounding `pregate` (`&` / `run_in_background`) | The harness caps and kills a backgrounded run mid-install | Run it in the FOREGROUND — on timeout the harness migrates it and it continues |
| Wrapping `pregate` in `timeout` | Cuts it off mid-queue and manufactures a false green | Run it unbounded in the foreground |
| Trusting a worktree's typecheck/test failures | An unprovisioned worktree fails as `'next' is not recognized` / `Cannot find package 'react'`, which look like real breakage | `node scripts/lib/bootstrap-worktree-deps.mjs . --classify-only` before blaming your change |
| Editing the PR body to satisfy a trailer gate, then re-running the job | `PR_BODY` / `PR_LABELS_JSON` come from `github.event.pull_request.*` — the **frozen webhook payload**. A rerun replays that same payload, so the edited body (or a new label) is invisible and the gate fails identically. `ci.yml` is triggered by bare `pull_request`, whose default types exclude `edited`. | Add the trailer, then **push a commit** — only a new `synchronize` event refreshes the payload. Budget for a re-gate: the new SHA makes your local-CI record `STALE`. |
| Trusting a green test run without naming the tree | Sibling worktrees hold identical paths; shell cwd persists between calls | Check the runner's root banner; reconcile the test count against your file |
| Adding a `<label>` next to its input and checking it in the browser | It renders, screenshots and inspects correctly while a screen reader announces an *unlabelled* field — every human check passes, so the Label Association Guard is the only thing that sees it | Bind it: `htmlFor={id}` with a matching `id`, or wrap the control inside the label |

### Live Blocker References Guard

`scripts/check-live-blocker-references.mjs` fails a PR whose **changed source**
cites a **closed** `BI-`/`EP-` id from user-facing text — a message that tells
the reader a fixed defect is their live blocker.

It is the missing half of Doc Anchor Existence. That guard proves a cited id
EXISTS; nothing proved it was still OPEN. A coverage tool once spent two days
instructing every caller to cite an already-shipped blocker, so contributors
recorded the wrong cause and auditors correctly concluded the block was stale.
Remediation text is written inline as a literal and then easily missed when the
referenced work closes.

The scope is deliberately narrow, because a guard that invents a defect is worse
than one that hides a defect:

- only string literals that also carry citation language (`cite`, `blocked by`,
  `tracked in`, `see`, `filed as`) — a bare mention is not an instruction;
- **never a comment.** A closed id recorded as provenance above the code it
  explains is exactly what you want; flagging it would be noise;
- never a test file; only changed files under `apps/` and `packages/`;
- existing pairs are grandfathered in `scripts/live-blocker-baseline.txt`;
- no token, unreachable endpoint, or ambiguous response ⇒ WARN and pass, naming
  what was skipped. A runner with no live install can neither fail nor invent.

```bash
node scripts/check-live-blocker-references.mjs            # check (what CI runs)
pnpm check:live-blockers                                  # same
node scripts/check-live-blocker-references.mjs --update   # regenerate the grandfather baseline
```

Prefer naming the **condition** the reader is hitting over any id: a condition
does not go stale when the work behind it ships. If an id genuinely belongs in
the text, repoint it at the live item.

### Agent Principal Convergence Guard

`scripts/check-agent-principal-convergence-wired.mjs` fails a PR that stops the
seed converging a `Principal` for every agent, or that hoists the convergence
above an agent seeder.

Every agent needs a Principal, because governed receipts are attributed to one
and the independence rules are expressed entirely in terms of principals.
Convergence was applied to `User` rows and not to `Agent` rows, so on a seeded
install 71 of 76 `AGT-*` agents had no identity — `AGT-WS-REVIEW`, the
designated independent Change Reviewer, among them.

`resolveReviewerIdentity` falls back to the authenticated human when an agent
alias misses, which is right on its own terms: an external CLI session label
carries an agent id and is genuinely a human acting. With no alias it always
missed, so a coworker that was summoned and did call the writer had its receipt
attributed to the delegating human — the artifact's author, the one identity
independence forbids. Every `independent: true` lane was unsatisfiable and the
refusal advised summoning a coworker, which is what the operator had just done.

No source check can prove the DATA converged; that is the seed's job at run
time. This guard proves the seed still runs the convergence, still runs it after
**both** agent seeders — either can introduce an agent with no identity — and
that the convergence module still writes the `aliasType: "agent"` alias the
reviewer lookup reads.

```bash
node scripts/check-agent-principal-convergence-wired.mjs
node --test scripts/check-agent-principal-convergence-wired.test.mjs
```

If a summoned reviewer's receipt is refused as non-independent, check whether
its agent id has a Principal before re-summoning: summoning again cannot fix a
coworker that has no identity to be attributed to.

### Label Association Guard (ratchet)

`scripts/check-label-association.mjs` fails a PR that adds a **net-new** form
label bound to no control. A `<label>` reaches assistive tech only when it is
tied to its input explicitly (`htmlFor` + matching `id`) or implicitly (the
control nested inside the label). A label that merely sits *beside* its input is
invisible in the accessibility tree.

It is a ratchet, not a mass-rewrite: the portal carries a baselined backlog of
pre-existing orphans (`scripts/label-association-baseline.json`), and the guard
blocks growth rather than demanding a blind sweep of surfaces nobody is
exercising. Implicit association already passes and is not counted as debt.

```bash
node scripts/check-label-association.mjs            # check (what CI runs)
node scripts/check-label-association.mjs --report   # per-file table
node scripts/check-label-association.mjs --update   # retighten after fixing a surface
```

Fix a surface's labels, then `--update` to retighten — the guard prints a
`shrank in N file(s)` line to prompt you. For the rare label that names a
composite widget rather than one control (a radio-group heading), add a
`label-association-allow` comment on the same line stating why. Tracked debt
is the checked-in baseline itself; file a live BI before proposing a separate
paydown campaign.

## What this gate is NOT

- **Not an e2e gate.** The Playwright suite under `tests/e2e/` runs separately on
  demand and is not blocking. See
  [`tests/e2e/platform-qa-plan.md`](../../tests/e2e/platform-qa-plan.md).
- **Not a security gate.** That's [gitleaks](../security/secrets-scan.md) (pre-PR
  secrets), CodeQL (pre-PR code patterns, via
  [`.github/workflows/codeql.yml`](../../.github/workflows/codeql.yml)), and the
  CodeQL [inflow gate](../security/README.md) (post-PR diff).
- **Not a UX gate.** UX verification is part of the manual build gate — see §5 of
  [`AGENTS.md`](../../AGENTS.md). Tests passing does not mean the feature works in
  the running app ([structural verification is not functional](../founder-kernel/wiki/principles/structural-verification-is-not-functional.md)).
