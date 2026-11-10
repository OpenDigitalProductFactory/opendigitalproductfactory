---
status: active
---

# PR-submit awaiting-acceptance (BI-7161625D)

**Backlog item:** `BI-7161625D`
**Epic:** `EP-WORKROOM-CLOSEOUT`
**Design:** [delivery closeout and cost efficiency](../specs/2026-09-04-delivery-closeout-cost-efficiency-design.md) addendum "PR-submit coding close and awaiting-acceptance"
**Workroom:** `WC-C75F5F57`

**For agentic workers:** execute this plan as one independently reviewable backlog item — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus this completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Design grounding

Operator-locked 2026-09-07: coding closes when the merge-ready PR is submitted;
acceptance is a new `BacklogItem.status` batched in independent verification
loops. Extends OBJ-DC-2/3/4/8 on the 2026-09-04 close-out spec. Substrate:
`BacklogItemStatus` in `packages/db/prisma/schema/shared.prisma` (String column +
`BacklogItem_status_closed_set` CHECK), `apps/web/lib/backlog/transitions.ts`,
`apps/web/lib/explore/backlog.ts`, `apps/web/lib/backlog-visibility.ts`,
`apps/web/lib/backlog/recommend.ts` (`isPickable` is already `open`/`triaging`
only), `apps/web/app/api/platform/git/updates/route.ts` →
`handleGitHubWebhook` (push sandbox; non-push events already recorded as ignored
candidates), `Workroom.pullRequestNumber`,
`pullRequestNumbersFromActivities` in `backlog-terminal-transition.ts`.

## Backlog coverage

- Decision: atomic
- Parent: BI-7161625D
- Rationale: the enum, CHECK, transition table, webhook actuator, already-PRed sweep, next-work exclusion, and verification `done` path are one revert. An enum without the actuator leaves a status nothing writes; an actuator without the enum fails the CHECK; a sweep without the status cannot clear the coding pool. None of those slices is independently shippable.
- Dependencies: none
- Receipt: blocked-by: record_plan_backlog_coverage needs a provider-verified GitHub blob at this branch head after push; the writer is not callable until origin has that blob.

## Phases (sequencing, not separate BIs)

1. **Closed enum.** Prisma `awaiting_acceptance @map("awaiting-acceptance")`,
   `ALTER TYPE` + drop/recreate `BacklogItem_status_closed_set` keeping legacy
   `blocked`. Mirror `BACKLOG_STATUSES` and `BACKLOG_STATUS_VALUES`, MCP enums,
   recovery bundle, visibility fourth bucket, workbook/status colours, WorkItem
   bridge. Data-impact manifest in the same change.
2. **PR-submit actuator.** Parse GitHub `pull_request` on the existing webhook.
   Non-draft opened/ready/reopened/synchronize stamps Workroom PR identity and
   moves linked items `triaging`/`open`/`in-progress` → `awaiting-acceptance`,
   releasing the work claim. Closed-without-merge returns `awaiting-acceptance`
   → `open`. Idempotent. Must not 500 the webhook.
3. **Sweep.** Bounded reconcile of Workrooms with `pullRequestNumber` and items
   whose evidence URLs contain `/pull/N`. SQL backfill in the same migration so
   already-PRed rows leave the coding pool on upgrade. Cron backstop.
4. **Verification path.** `awaiting-acceptance` → `done` only through
   `completeBacklogItemTransition`. Fail files one corrective BI and leaves the
   original in `awaiting-acceptance`. Next-work stays exclusive of this status.

Verify AC-DC-8 with unit tests: draft ignored, withdrawn PR reopens, pickable
exclusion, visibility exhaustive split, webhook parse, sweep idempotence,
corrective-on-fail. Do not mark the five 2026-09-07 stranded items `done` in
this PR.

## Risks and rollback

Blast radius: every status switch, MCP schema, federation allow-list, and the
active-work lens. Rollback is reverting the PR: the CHECK again excludes the
value, so rows must be moved back to `open` before migrate-down — there is no
down migration; a forward repair would set `awaiting-acceptance` back to `open`.
Webhook errors must not block git-promotion sandbox intake.

## Completion gate

- Source-local: affected Vitest files + this migration SQL test.
- `pnpm --filter web` typecheck/lint of touched packages as the fast local gate.
- Production build and live UX of the Operations backlog lens run in cloud CI /
  post-deploy verification, not by rebuilding the live portal from this worktree.
