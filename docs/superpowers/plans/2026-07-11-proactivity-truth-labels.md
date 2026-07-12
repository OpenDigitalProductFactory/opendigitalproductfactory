# Plan — Proactivity truth-in-labeling (BI-AB7CD55B, EP-B9DD37C7)

**Evidence (2026-07-11 sweep of main):** the claim "proactivity is prompt-only" is stale — the level drives real behavior: `saveCoworkerProactivityPreference` → `reconcileCoworkerSelfTask` creates/reschedules/cancels cron-backed self-tasks for coworkers registered in `COWORKER_SELF_TASKS` (quiet=off, balanced=weekly, assertive=daily/twice-weekly); the opening briefing is gated by level; failed-scheduled-task attention urgency scales with level; and `buildInitiativeBlock` sets in-chat effort for all coworkers. The real defect is a **copy-vs-wiring gap**: `CoworkerProfilePanel` rendered Monitoring/Approval/Escalates-to chips (from the resolver's `spendClass`/`actionBoundary`/`escalationTarget`) and the field-dispatch proposal card rendered `actionBoundary`, but **no runtime code enforces any of those fields** — `channelPolicy`/`followUpCadenceMinutes`/`maxAttempts` are parsed and never read, and `delegated-posture.ts` (the would-be authority enforcer) is dead code with zero production call sites.

**Kernel decision:** hybrid-label-now-file-enforcement (principle_decide 2026-07-11, external_coding_agent; low-confidence tie between the two label-now variants — the hybrid is a superset of the same action, adopted with ledger reported).

## Changes (this PR)

1. `apps/web/lib/proactivity/proactivity-effects.ts` (new, pure): `describeProactivityEffects(level, selfTaskInfo)` — one line per REAL consumer (in-chat effort, opening briefing, registered self-task cadence or an honest "not available for this coworker yet", failed-task urgency). Unit-tested that monitoring/approval/escalation never appear.
2. `coworker-self-tasks.ts`: `coworkerSelfTaskCadenceInfo(agentId)` — registration + friendly per-level cadence from the registry crons.
3. `lib/actions/proactivity.ts`: `getCoworkerSelfTaskCadenceInfo` server action (session-gated).
4. `CoworkerProfilePanel`: unenforced Monitoring/Approval/Escalates-to chips → the honest effects list.
5. `CoworkerProactivitySetting` (coworker record): same effects list under the dial — both altitudes tell the same true story.
6. `action-proposal-presentation.ts`: proposal "Approval" detail is now the static truth — "Requires your approval" (every proposal is human-gated regardless of `actionBoundary`).

## Deferred (filed on EP-B9DD37C7)

Enforcement BI: make `actionBoundary`/`escalationTarget`/`followUpCadenceMinutes`/`channelPolicy`/`maxAttempts` real (tool-filter gate, escalation routing, follow-up scheduler) and wire or delete dead `delegated-posture.ts`; until then those fields stay display-suppressed. Self-task coverage beyond the 3 registered coworkers is BI-E962B9CD.

## Gates

Worktree typecheck + scoped vitest; `pnpm run pregate`; UX check of the panel + record on the leased contributor preview if warranted (copy-level change); PR with `UX-Fit-Decision:` trailer citing the kernel ledger.
