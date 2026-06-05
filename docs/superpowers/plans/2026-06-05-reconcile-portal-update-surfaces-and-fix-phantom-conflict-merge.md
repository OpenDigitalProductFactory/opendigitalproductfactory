---
title: Reconcile portal self-upgrade surfaces + fix phantom-conflict merge
date: 2026-06-05
backlog_items:
  - BI-D43EB266   # IA: two portal-update surfaces confuse operators; banner mis-routes
  - BI-4112378F   # phantom 802-conflict same-version merge (CRLF↔LF)
epic: EP-INSTALL-HARDENING-2026-05-23
status: implemented
---

# Reconcile portal update surfaces + fix phantom-conflict merge

## Problem

Two separate "update the portal" surfaces confused operators, and one was
broken:

1. **`/ops/self-upgrade`** (Ops tab) — governed-upgrade orchestrator that
   deploys a prebuilt portal image/SHA (`deployedSha → targetSha`),
   maintenance windows, run history, recovery points + rollback. The
   operator's primary path; works.
2. **`/admin/platform-development`** (Admin tab) — `applyPlatformUpdate`
   merges upstream source into the install's `my-changes` branch in the
   `/workspace` git repo. The "update available" banner deep-linked *here*,
   not to the Ops surface the operator uses.

**Problem A (BI-D43EB266) — IA fragmentation.** Both surfaces independently
advertised "update available" with their own apply controls in different nav
areas; the shell banner routed to the Admin source-merge surface.

**Problem B (BI-4112378F) — phantom 802-conflict merge.** `applyPlatformUpdate`
merged local branch `dpf-upstream` into `my-changes`. The two branches carried
the same version label (`v9c92036a`) but diverged by 4,186 files / ~687k lines;
~99.96% of that collapsed when CR-at-EOL was ignored — a CRLF↔LF normalization
mismatch between the image-sync snapshot path (`my-changes`) and the source-copy
path (`dpf-upstream`). A redundant same-version apply phantom-conflicted, and a
real future bundle would too.

## Substrate verified

- `apps/web/lib/actions/platform-dev-config.ts` — `applyPlatformUpdate`; the
  merge at the work-branch step used a plain `git merge … --no-commit --no-ff`
  with no EOL tolerance and no same-version guard. The clean-check guards
  already used `--ignore-cr-at-eol` (precedent).
- `apps/web/lib/mcp-tools.ts` `apply_platform_update` case **delegates** to the
  same server action — single source of truth, so one fix covers UI + coworker.
- `apps/web/components/shell/UpdatePendingBanner{,Client}.tsx` — banner derived
  from `platformDevConfig.updatePending/pendingVersion`, linked to
  `/admin/platform-development`.
- `apps/web/components/admin/PlatformUpdateApplyPanel.tsx` — self-hides when
  `!updatePending` (so gating on `updatePending` == "install customizes source
  and has a pending merge").
- `/ops/self-upgrade` page fetched only promotions status; `/admin/platform-
  development` hosted the apply panel + contribution policy.

## Changes

### Part B — merge bug (BI-4112378F), `platform-dev-config.ts`

1. **Same-version short-circuit.** Before any merge work (and only when no
   merge is mid-flight), read the `.dpf-version` sentinel via a new
   `readInstalledVersion`. If it equals `pendingVersion`, clear the pending
   flag and return a clean no-op (`filesUpdated: 0`) — **zero conflicts**,
   no `git merge` invoked. This is the acceptance test.
2. **EOL-tolerant merge.** The work-branch merge now runs hookless with
   `-X ignore-cr-at-eol`, matching the verified root cause (the diff collapses
   when CR-at-EOL is ignored). Prevents phantom conflicts on genuine
   cross-version applies too.
3. **Durable normalization policy.** `ensureLineEndingPolicy` writes/stages
   `.gitattributes` (`* text=auto eol=lf`) on the `dpf-upstream` refresh, so it
   lands on both managed branches once merged and future snapshots converge on
   LF (BI fix direction #1).

> No-remote note (BI fix direction #2): `dpf-upstream` is a local branch with
> no remote. The action already tolerates a missing `origin/main`
> (`assertBranchRepairCanUseCurrentHead` returns early). Giving `dpf-upstream`
> a real upstream base is a larger change deferred as follow-up; the
> short-circuit + EOL tolerance fully resolve the phantom-conflict acceptance
> criterion without it.

### Part A — IA reconciliation (BI-D43EB266)

1. **Banner re-point.** `UpdatePendingBannerClient` now links to
   `/ops/self-upgrade` ("Review in Self-Upgrade").
2. **Fold source-merge into Self-Upgrade.** `/ops/self-upgrade` now also
   fetches `getPlatformDevConfig()` and renders `PlatformUpdateApplyPanel`
   beneath the image/SHA deploy controls — surfaced only when the install
   customizes source (`updatePending`).
3. **Remove the duplicate Admin destination.** The apply panel is removed from
   `/admin/platform-development` (which keeps contribution policy + identity).
   "Update available" is now asserted on one operator surface.

## Tests

- `platform-dev-config.apply.test.ts` (node env, ran locally — 19/19 pass):
  - new: same-version apply short-circuits with **zero conflicts**, no merge,
    pending flag cleared.
  - new: merge runs `-X ignore-cr-at-eol` hookless and stages the
    `.gitattributes` policy; asserts the plain conflict-prone merge is gone.
- `ops/self-upgrade/page.test.tsx` (ran locally — pass): panel receives the
  install's pending state; dormant when source isn't customized.
- `UpdatePendingBannerClient.test.tsx`: asserts the `/ops/self-upgrade`
  deep-link. (Local run blocked only by a duplicate-React artifact from the
  worktree's incomplete `node_modules`; validated in CI.)

## Acceptance

- [x] One operator "update the portal" surface; banner deep-links to it.
- [x] Same-version apply produces 0 conflicts — covered by a test.
- [x] Genuine source conflicts reviewable inside the self-upgrade flow, not a
      separate Admin destination.
- [x] Recovery-point/rollback behavior preserved (promotions path untouched).
