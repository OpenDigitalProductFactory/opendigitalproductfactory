# Mobile CI Lane

## Backlog Item

BI-MOBAPP-CI — Path-filtered mobile CI lane.

## Scope

Complete the path-aware mobile CI split across the existing GitHub Actions workflows. `.github/workflows/mobile-ci.yml` already runs mobile typecheck and Jest for `apps/mobile/**` plus shared mobile package changes; `.github/workflows/ci.yml` still treated mobile app-only PRs as heavyweight and made them wait on the web shard matrix. This slice makes `ci.yml` short-circuit heavyweight required checks for mobile app-only PRs while keeping full CI for shared packages.

## Plan

1. Extract CI change-scope classification into a small tested Node helper.
2. Extend `.github/workflows/ci.yml` to classify mobile app-only changes as non-heavy.
3. Preserve full CI for shared packages that can affect web/platform code.
4. Verify the existing standalone mobile workflow commands locally.

## Verification

- `node --test scripts/ci-change-scope.test.mjs`
- `pnpm --filter mobile typecheck`
- `pnpm --filter mobile test:ci`
