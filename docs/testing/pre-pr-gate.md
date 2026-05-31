# Pre-PR test gate

Every pull request against `main` runs the full DPF unit-test suite as a
binding merge gate. **Tests run before merge — if they fail, fix in place,
don't push-and-pray.**

## What runs

The root `pnpm test` script invokes:

```
pnpm --filter web test       # vitest — apps/web
pnpm --filter @dpf/db test   # vitest — packages/db
pnpm --filter mobile test    # jest   — apps/mobile (Expo + React Native)
```

All three must pass. As of 2026-05-17 the consolidated suite contains 5,980
tests at 0 failures on `main`.

## Where it runs

Wired up in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) under
the `Unit Tests` job. The job:

1. Provisions a Postgres 16-alpine service for tests that need a real DB
   (the `@dpf/db` suite primarily).
2. Installs deps with the frozen lockfile.
3. Generates the Prisma client and applies migrations.
4. Runs `pnpm test`.

CI fails the PR check if any test fails. Branch protection requires the
check to pass before merge.

## Run locally

Before pushing, run the suite that covers the files you touched:

```bash
# Touched apps/web?
pnpm --filter web test

# Touched packages/db?
pnpm --filter @dpf/db test

# Touched apps/mobile?
pnpm --filter mobile test

# All three (matches CI):
pnpm test
```

The `apps/web` suite alone runs in roughly 2–4 minutes on a modern laptop;
the full root `pnpm test` adds another 1–2 minutes for `@dpf/db` and the
mobile jest suite.

### Where "locally" means

"Locally" here means any host where the DPF runtime is wired up — your root install, a governed shared nonprod environment, or the CI job itself. A thread/worktree clone provides source-control isolation, NOT runtime isolation: pnpm/corepack on PATH, workspace symlinks, generated Prisma client, and Next/Turbopack workspace-root constraints are install concerns, not per-worktree concerns. If a worktree-side `pnpm test` is blocked by missing runtime harness (corepack, workspace links, Prisma client, etc.), run the same command from the canonical install or rely on the binding CI gate — that is the equivalent evidence, not a product defect. Reserve "make a worktree runnable" as a dedicated platform BI, not incidental scope on a feature/fix PR. See [AGENTS.md §5](../../AGENTS.md) and [`worktree-is-source-control-not-runtime`](../founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md).

## The pre-commit typecheck gate

A separate guard at `.githooks/pre-commit` runs `pnpm --filter <affected>
typecheck` on TypeScript commits and rejects the commit on failure. It does
**not** run vitest/jest — that's CI's job. The hook is auto-wired by
`postinstall` (`scripts/set-hooks-path.mjs` sets `core.hooksPath`). Emergency
bypass: `DPF_SKIP_TYPECHECK=1 git commit ...`.

This means the local feedback loop is:

1. Pre-commit hook catches type errors before they leave your machine.
2. CI's `Unit Tests` job catches behavioural regressions before merge.
3. CI's `Production Build` job catches Next.js build-time errors (a
   superset of typecheck — some errors only surface at build).

## Test runner pins (must hold)

Two test-runner pins are load-bearing and enforced in CI:

### `apps/mobile` jest must stay on `^29.x`

Enforced by [`scripts/check-mobile-jest-pin.mjs`](../../scripts/check-mobile-jest-pin.mjs)
via the `Mobile Jest Pin Guard` job in `ci.yml`.

**History.** Dependabot bumped jest to v30 in PR #1037. The bump silently
broke every mobile test simultaneously and blocked every open PR for hours.
PR #1053 reverted to jest `~29.7.0`. The current jest-expo (~56) does not
yet support jest 30. Without this guard, the next Dependabot pass would
re-introduce the same break.

**If you need to bump jest 30+.** Confirm jest-expo compatibility upstream
first, then remove this guard in the same PR that bumps the version and add
a note here describing the compatibility evidence.

### `apps/web` and `packages/db` vitest

Previously pinned to `^4.1.5` because vitest 4.1.6+ broke
`@testing-library/jest-dom`'s vitest type augmentation. As of 2026-05-22 the
pin was lifted via a `packageExtensions` workaround in `pnpm-workspace.yaml`
(see PR #1055). No CI guard is needed — the workaround makes future vitest
bumps safe. If `toBeInTheDocument`-style assertions regress on a future
bump, restore the pin or extend the workaround.

## What this gate is NOT

- **Not an e2e gate.** The Playwright suite under `tests/e2e/` runs
  separately on demand and is not blocking. See
  [`tests/e2e/platform-qa-plan.md`](../../tests/e2e/platform-qa-plan.md).
- **Not a security gate.** That's [gitleaks](../security/secrets-scan.md)
  (pre-PR secrets), CodeQL (pre-PR code patterns, via
  [`.github/workflows/codeql.yml`](../../.github/workflows/codeql.yml)),
  and the CodeQL [inflow gate](../security/README.md) (post-PR diff).
- **Not a UX gate.** UX verification is part of the manual build gate —
  see §5 of [`AGENTS.md`](../../AGENTS.md). Tests passing does not mean the
  feature works in the running app.
