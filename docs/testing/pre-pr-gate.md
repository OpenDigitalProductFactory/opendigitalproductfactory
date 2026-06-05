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

## The opt-in pre-push gate (`pregate`)

BI-166C59F3 Phase 1 adds the shared local-CI convergence sandbox workflow. The
sandbox runtime is declared in `docker-compose.local-ci.yml` behind the
`local-ci` profile, uses `COMPOSE_PROJECT_NAME=dpf-local-ci`, serves the portal
on `http://localhost:3010`, and connects to the existing dev data services on
host ports `5433`, `6334`, and `7475`/`7688`.

From a worktree, the opt-in gate is:

```bash
pnpm run pregate            # → sh scripts/gate-worktree.sh
```

The script pushes the current branch, claims a `local-integration-ci` lease
(waiting if the sandbox is already leased), runs the command supplied in
`DPF_LOCAL_CI_COMMAND`, records a local-integration evidence record with the
lease id and `gatePassed`, releases the lease, and writes the latest gate result
to Git-local state (`.git/dpf-local-ci-gate.json`).

**It refuses to record a passing stub by default.** With no
`DPF_LOCAL_CI_COMMAND` the command intentionally fails — an unimplemented
local-CI runner must not produce green evidence. The old Phase 1 stub is only
reachable via `DPF_ALLOW_LOCAL_CI_STUB=1` for contract tests and must never be
used as release evidence.

The opt-in pre-push hook is [`.githooks/pre-push-gate`](../../.githooks/pre-push-gate).
It refuses a push when the latest local-CI gate record is missing, belongs to a
different branch/SHA, or has `gatePassed=false`. Emergency bypass (verified
clean only):

```bash
DPF_SKIP_PREPUSH_GATE=1 git push
```

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
