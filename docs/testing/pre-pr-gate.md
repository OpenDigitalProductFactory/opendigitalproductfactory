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

Fast source and PR-policy checks are registered in
[`scripts/lib/ci-policy-guards.mjs`](../../scripts/lib/ci-policy-guards.mjs).
The registry preserves the former job name, display name, command sequence, and
profile for every migrated guard. The runner executes every named entry even
when an earlier entry fails, then writes a per-guard pass/fail/duration table to
the GitHub job summary and a machine-readable artifact.

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
Slot 0 preserves the singleton portal on `http://localhost:3010` and uses its
dedicated PostgreSQL endpoint on port `54329`; it may still consume shared,
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
the commit-range-driven UX-Fit and Design Grounding trailer gates), with guard
self-tests stripped and PR-body-dependent gates (Seed-Fit, Decision Baseline)
left to CI. A violation aborts in well under a minute **before any lease is
claimed**, so a doomed run never occupies the contended sandbox slot. A guard
this host cannot execute (missing isolated runtime) is reported as
`environment-skipped` with its remedy — a warning, never a false red; CI
remains the enforcer. Run it standalone with `pnpm run pregate:preflight`
(`--plan` prints the guard plan without running it). Emergency skip:
`DPF_SKIP_PREGATE_PREFLIGHT_REASON="<why>"` — printed on the gate run, and CI
still enforces every guard. Routing probes (`--dry-run`) and evidence replays
(`--finalize-evidence`) skip the preflight automatically.

**Host-native/Node-first entry point (BI-2272D840, BI-52500C0D, BI-4BE30454).** `pregate.mjs`
detects whether native `sh` actually works against *this* worktree — not just
"sh is on PATH", but that it can resolve the worktree's own git state
(`sh -c 'git rev-parse --show-toplevel'`) — and routes accordingly:

- Working native `sh` (Git-for-Windows shell, Linux/macOS): delegates to
  `scripts/gate-worktree.sh`, which is a compatibility adapter into the
  canonical Node gate.
- No working native `sh` (e.g. a Windows worktree with no Git Bash and a WSL
  install that cannot cleanly read the worktree's `.git` indirection — the
  exact failure BI-C22152E7 hit): routes to `scripts/gate-worktree.mjs`, a
  canonical lease-claim / heartbeat / fenced-run / evidence-record /
  lease-release flow. `scripts/local-ci-runner.sh` is likewise a compatibility
  adapter into `scripts/local-ci-runner.mjs`; both host surfaces therefore call
  the same `scripts/local-integration-ci.mjs` plan and slot manifest. Missing native `sh` is therefore
  classified as **sandbox-routable, never a build blocker** — the agent no
  longer needs to recognize that doctrine and hand-drive the lease steps.

Either path produces the same evidence shape (manifest version and slot,
branch/SHA, integration tree, database and Compose identity, production
artifact, lease id, freshness verdict, toolchain fingerprint, expiry) and
writes the same
`.git/dpf-local-ci-gate.json` state file, so the pre-push gate below accepts
either without caring which one ran. Force a specific path for
testing/debugging with `DPF_PREGATE_FORCE_SH=1` or `DPF_PREGATE_FORCE_NODE=1`.

The gate claims a `local-integration-ci` lease (waiting if the sandbox is
already leased). A canonical waiter refreshes its idempotent claim well inside
its liveness window, while an admitted owner receives a two-minute authority
window and heartbeats at no more than one third of that effective TTL. This
bounds recovery when the supervisor disappears without shortening the maximum
queue wait. The gate runs the command, releases the runtime slot, records a
local-integration evidence record with the lease id and `gatePassed`, and
writes the latest gate result to Git-local state
(`.git/dpf-local-ci-gate.json`). Renewal loss is
fail-closed: before further sandbox mutation the gate terminates its complete
child process tree, records a fenced outcome, and releases idempotently.
Transport failure is uncertainty rather than proof of ownership loss: the gate
records the failure and retries only inside its last known authority window. A
separate deadline terminates the child tree before that window expires if no
successful renewal advances it. MCP requests have their own bounded transport
deadline, so a hung heartbeat cannot outlive the lease silently.
Admission also takes an atomic slot-local owner fence in the shared Git
directory. A competing claimant for that slot waits while the fence's PID is alive even if
an older database TTL has elapsed; a dead PID is reaped as an orphan. The
admitted waiter renews its database authority while it waits for that host
fence and refuses to acquire the fence near its last known expiry. The database
lease remains the governed cross-process record, while this local
fence closes the host process-liveness gap the database cannot observe.
The requested expiry is calculated afresh for every claim observation, and the
service grants a fresh admitted-owner window at promotion, so time spent
waiting never consumes the acquired owner's TTL.
Claim, heartbeat, signal/fence, and release timestamps are included in the
evidence and Git-local state. An expired TTL is never permission for the old
owner to continue working. The gate does
**not** publish the branch by default (BI-76551B2D); push/publication is a
separate step after local evidence exists. The legacy push-before-lease behavior
is available only as an explicit `scripts/gate-worktree.sh --push` (or
`scripts/gate-worktree.mjs --push`) operation for recovery/transition cases
that intentionally need it.

**The gate command has a checked-in default (BI-157DC9B2, BI-4BE30454):**
[`scripts/local-ci-runner.mjs`](../../scripts/local-ci-runner.mjs) runs the
canonical merged-code plan (`scripts/lib/local-integration-ci.mjs`: checkout
the locally available accepted-base ref, `origin/main` by default → merge
candidate → sandbox-freshness converge → vitest → typecheck → production build)
in a dedicated **non-mutating scratch worktree** (`~/dpf-worktrees/.local-ci-runner`
for slot 0 and a manifest-owned sibling for slot 1) — never in your topic
worktree. It records content-addressed
metadata to `.git/dpf-local-ci-metadata.json` and into MCP evidence: candidate
ref/SHA, base ref/SHA, integration commit SHA, synthesized tree SHA, command
list, timestamps, slot key, Compose/PostgreSQL identities, the exact production
artifact identity, whether the accepted base came from a local ref or explicit
`--fetch-base`, toolchain fingerprint, and gate-evidence expiry. The evidence
also carries a `resilience` envelope: `publicationMode` (`deferred` by default
or explicit `push-before-lease`), `acceptedBaseMode` (`local-ref` or
`fetch-base`), and `networkTolerance` (`offline-capable` only when publication
is deferred and the accepted base was local).
`DPF_LOCAL_CI_BASE_REF` can point at another local accepted-base ref;
`DPF_LOCAL_CI_FETCH_BASE=1` / `--fetch-base` is the explicit network-refresh
mode. `DPF_LOCAL_CI_COMMAND` remains an explicit override. The
old Phase 1 stub is only reachable via `DPF_ALLOW_LOCAL_CI_STUB=1` for contract
tests and must never be used as release evidence.

The command plan carries required process environment as `env NAME=value ...`
prefixes, and the Node runner interprets those prefixes directly instead of
depending on a host `env` executable. This keeps the 8 GiB `NODE_OPTIONS`
headroom on both POSIX and Windows typecheck paths; the production build may
still use the host-specific strategy selected by the plan. Vitest runs with
Node's experimental host web-storage disabled so Node 26 cannot shadow the
`localStorage` and `sessionStorage` implementations owned by jsdom. This is a
test-runner compatibility setting, not a change to application runtime policy.

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

The network-disconnect proof is encoded in
`tests/release/local-ci-gate-contract.test.mjs`: the contract denies network
Git verbs during `gate-worktree.sh`, records local-only evidence with
`networkTolerance=offline-capable`, then runs `.githooks/pre-push-gate` through
the same no-network Git wrapper and proves the same unexpired SHA-bound record
is sufficient for later publication.

**Quiescence-aware evidence recovery.** `pnpm run pregate` now preflights
`get_quiescence_status` before the expensive gate. If the portal is actively
draining or swapping, the gate exits before claiming the lease or running the
full local-CI command. If the expensive gate already passed but
`record_local_integration_result` is refused with `portal_quiescing`, the gate
writes `.git/dpf-local-ci-pending-evidence.json`, attempts
`release_nonprod_environment_lease`, and records
`evidencePending=true` in `.git/dpf-local-ci-gate.json`. After quiescence clears,
publish that saved evidence without rerunning local-CI:

```bash
pnpm run pregate -- --finalize-evidence --branch <branch> --sha <sha>
```

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
— and `postinstall` (`scripts/set-hooks-path.mjs` →
`scripts/lib/ensure-pre-push-hook.mjs`) converges the local shim to delegate to
it (a hand-rolled custom hook is never clobbered; the install prints a warning
instead). The gate refuses a push when the latest local-CI gate record is
missing, belongs to a different branch/SHA, has `gatePassed=false`, has no
`expiresAt`, or is past `expiresAt`. Not everything needs a record: docs-only
diffs vs the configured comparison base, delete/tag-only pushes, detached HEAD,
and `main` (merge-queue-governed) pass through. For offline/forge-neutral
installs, `DPF_PREPUSH_BASE_REF=<ref>`
changes the docs-only comparison base to a local accepted-base ref (default:
`origin/main`); if that configured ref is missing, the hook requires the normal
SHA-bound gate record instead of silently falling back.

The bypass is **recorded, never silent** — the reason is persisted into the
gate state file and surfaced by `pnpm pr:health` at PR time:

```bash
DPF_SKIP_PREPUSH_GATE=1 DPF_SKIP_PREPUSH_GATE_REASON="WIP handoff, gate before PR" git push
```

**PR-time guard.** `pnpm pr:health` treats a runtime-code PR without local-CI
evidence as NOT READY: it needs a passing gate record for the PR head SHA, a
recorded push-time override, or an explicit `Local-CI-Override: <reason>` /
`Local-CI-Evidence: <record-id>` trailer in the PR body. Docs-only PRs are
exempt automatically.

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
