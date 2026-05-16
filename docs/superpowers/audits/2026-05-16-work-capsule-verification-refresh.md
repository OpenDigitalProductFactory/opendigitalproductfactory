# Work Capsule Verification Refresh

Date: 2026-05-16
Branch: `fix/work-capsule-verification-docs`
Scope: Work Capsule Phase 1 verification refresh plus CI unit-test root-cause repair.

## Findings

- The previously referenced worktree `D:\DPF\.worktrees\portal-work-capsule-control-harness` is no longer present. Phase 1 landed through PR #602 and is on `main`.
- The focused Work Capsule suite passes locally after installing workspace dependencies in a fresh worktree: 9 test files, 100 tests.
- Prisma schema validation passes locally.
- The Phase 2 implementation plan landed through PR #665, but Phase 2 code is not implemented on `main`.
- PR #665's GitHub Unit Tests failure was caused by CI runner setup, not Work Capsule code: `pnpm test` includes `@dpf/db` Prisma tests, but the Unit Tests job did not start Postgres or apply migrations, so database-backed tests failed with `ECONNREFUSED`.
- After reproducing the workflow shape locally with disposable Postgres, the repository test command surfaced two stale web-test contracts unrelated to Work Capsules: `wiki_query` now returns `retrievalMode` in empty results, and the external-access coworker unit test was allowing production fire-and-forget memory/reflection hooks to run after test teardown.

## Changes Made

- Updated `.github/workflows/ci.yml` so the Unit Tests job provisions `postgres:16-alpine`, sets `DATABASE_URL`, applies Prisma migrations, and then runs `pnpm test`.
- Updated the Work Capsule design status to reflect that Phase 1 merged via PR #602 and Phase 2 has a merged plan awaiting implementation.
- Updated the Phase 2 section to match the display-and-record/operator-paste narrowing from the merged Phase 2 plan.
- Added Phase 2 verification expectations to the design spec.
- Aligned the stale `wiki_query` assertion with the current retrieval-mode response contract.
- Isolated the external-access coworker test from semantic-memory, wiki-recall, user-fact, AI-doc, and reflection-trigger background hooks so full-suite runs do not leak production async work into Vitest teardown.

## Verification Evidence

```powershell
pnpm --filter web exec vitest run lib/work-capsules.test.ts lib/work-capsules/work-capsule-store.test.ts lib/work-capsules/git-scanner.test.ts lib/work-capsules/work-capsule-presenter.test.ts lib/actions/work-capsules.test.ts lib/mcp-tools-work-capsules.test.ts lib/tak/agent-grants.test.ts lib/work-capsules-enum-parity.test.ts components/build/work-control/WorkControlPanel.test.tsx
```

Result: PASS, 9 files, 100 tests.

```powershell
pnpm --filter @dpf/db exec prisma validate
```

Result: PASS, schema valid.

```powershell
# With disposable postgres:16-alpine, DATABASE_URL=postgresql://dpf:ci_test_password@localhost:<port>/dpf
pnpm --filter @dpf/db exec prisma migrate deploy
pnpm test
```

Result: PASS. Prisma applied 203 migrations. `pnpm test` passed `web` (722 files passed, 3 skipped; 5,825 tests passed, 14 skipped, 13 todo), `@dpf/db` (71 files, 504 tests), and `mobile` (24 suites, 149 tests).

```powershell
pnpm --filter web typecheck
```

Result: PASS. `next typegen` completed and `tsc --noEmit` exited 0.

```powershell
pnpm --filter web build
```

Result: PASS. Next.js production build compiled and generated 102 static pages. Turbopack still reports existing broad-trace warnings around `spec-plan-search.ts` / `next.config.mjs`; no build errors.

## Remaining Work

- Implement Phase 2 from `docs/superpowers/plans/2026-05-16-portal-work-capsule-control-harness-phase-2.md`.
- Watch the GitHub Unit Tests job after this CI workflow change lands to confirm the database-backed package tests no longer fail at runner setup.
- Complete Docker-served UX verification for `/build/work` when a runtime rebuild is in scope.
