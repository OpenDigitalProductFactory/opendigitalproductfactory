# Plan — Proactivity plan enforcement (BI-754C9E82, EP-B9DD37C7)

Successor to [2026-07-11-proactivity-truth-labels.md](2026-07-11-proactivity-truth-labels.md): that pass suppressed the advertised-but-unenforced fields from the UI; this pass makes four of them real so the honest-effects list can say more. Kernel sequencing decision (principle_decide 2026-07-12, external_coding_agent, high confidence): enforcement-first over self-task extension (BI-E962B9CD) and selectable actions (BI-867263F4).

## Enforced in this PR

1. **actionBoundary gates tools on scheduled runs** — `agent-task-scheduler.ts` derives the tool-resolution mode from the resolved plan: `advise` (quiet level, regulated contexts) strips side-effecting tools via `getAvailableTools`' existing advise filter; `propose` keeps act tools because registry self-tasks (`COWORKER_SELF_TASKS`) are curated, idempotent, pre-authorized writes. **Deferred remainder:** true propose-interception (diverting side-effects to `AgentActionProposal`) — the largest change, explicitly out of scope here.
2. **followUpCadenceMinutes / maxAttempts are the retry policy** — new `ScheduledAgentTask.attempts` column (additive migration, data-safe DEFAULT 0). Attempt N failing schedules a retry at `cadence[N-1]` minutes while `attempts < maxAttempts`; exhausting the budget re-arms the normal cron and resets the budget (fresh per cron cycle); success resets it. Assertive = retries at +30m/+60m, balanced = one retry at +2h, quiet = none.
3. **escalationTarget routes attention** — the failed-task attention item's `audience` now maps from the plan: personal targets (owner / attention-surface / role) keep the owner assignee; operator-level targets (platform-operator / dispatcher) drop the personal assignee. `operator: true` is kept for every target so escalation widens visibility but never hides a failure.
4. **delegatedPosture is live** — the scheduler calls `resolveDelegatedPosture` (previously dead code) and threads the result through `createTaskRunForScheduledTask` → `a2aMetadata.delegatedPosture`, so every scheduled run carries an auditable effective level + boundary.

## Copy follow-through

`describeProactivityEffects` "If its task fails" now states the enforced retry behavior per level; a drift test derives the expected retry counts from `DEFAULTS_BY_LEVEL` so copy and enforcement cannot silently diverge.

## Tests

Scheduler: advise gating via quiet override, act for propose, delegated-posture on `taskRun.create`, retry at +30m with attempts=1, budget exhaustion → cron + reset, success reset. Attention: escalationTarget→audience mapping. Effects: resolver-aligned drift test.
