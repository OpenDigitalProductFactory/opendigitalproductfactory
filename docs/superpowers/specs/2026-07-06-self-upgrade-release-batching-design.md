# Self-Upgrade Release Batching Design

Date: 2026-07-06
Status: Approved for implementation
Backlog: BI-6D4B324C
Epic: EP-3516E23D (Reusable queueing substrate)

## Problem

The governed self-upgrade cron fires hourly and starts an upgrade whenever the
upstream branch has **any** new commit (`self-upgrade.ts`: it resolves the
upstream HEAD, and if the running build does not already contain it, it drains
the portal via quiescence, rebuilds, and swaps). With an active merge queue,
every merged PR produces a new upstream SHA, so **every single PR triggers its
own portal drain**. During a drain the portal refuses new MCP/portal actions
(`portal_quiescing`), so concurrent Claude/Codex/coworker work is blocked once
per merged PR — a large, avoidable disruption when many PRs land in a day.

Agents also have no signal that an upgrade is imminent: an external session that
just merged a PR cannot tell whether more PRs are still to be tallied before the
next batch deploys, so it cannot sensibly decide whether to wait and validate
live after the batch or proceed now.

## Goal

Routine upgrades accumulate merged PRs and trigger only once a batch is worth
the disruption, and the pending-PR tally is visible to every surface so agents
can defer live validation until the batch deploys. Operator manual and force
triggers remain ungated.

## Kernel decision

`principle_decide` (calling population `external_coding_agent`) scored three
approaches:

| Option | Composite | Notes |
| --- | --- | --- |
| **count-threshold-plus-max-wait** (chosen) | **8.68** | count gate + bounded-staleness valve |
| count-threshold-only | 8.05 | one knob; a low-traffic install can sit on stale code indefinitely |
| cwq-queueing-substrate | 6.00 | activates a dormant substrate for a gate expressible as one git count |

Margin 0.628, confidence **high**, no commandment conflict. The valve is the
deciding factor: it bounds staleness (long-term maintainability + governance
compliance) without adding operator burden.

## Design

### Eligibility (pure)

`apps/web/lib/self-upgrade/release-batch.ts` holds the pure evaluator:

```
eligible ⇔ minPendingPrs <= 1                       (batching disabled)
         OR pendingCount === null                    (uncomputable → fail OPEN)
         OR pendingCount >= minPendingPrs            (threshold met)
         OR oldest pending commit age >= maxWaitHours (bounded-staleness valve)
```

Fail-open is load-bearing: batching is a **disruption optimization, never an
upgrade-liveness gate**. If the tally cannot be computed, the upgrade proceeds.

### The tally (IO)

`countPendingUpstreamCommits` runs
`git log --reverse --format=%ct <lineageSha>..<remote>/<branch>` — one
committer-epoch line per pending commit (≈ merged PR, since the queue
squash-merges). The `lineageSha` is the upstream SHA the running build absorbed
(the latest succeeded run's `targetSha`), the same marker the §5.0 up-to-date
gate uses. Line count = pending tally; the first (oldest) line = the valve age.

Install clones are routinely **shallow**, so the lineage commit may be behind
the clone boundary. On a failed range the counter attempts one bounded
`git fetch --deepen=200` and retries; if it still cannot resolve, it returns
`null` (fail open). Any git error or exception also returns `null`.

### Config

`SelfUpgradeConfig` gains two `PlatformConfig`-overridable knobs
(`apps/web/lib/self-upgrade/config.ts`):

- `batchMinPendingPrs` (default **10**) — `<= 1` disables batching.
- `batchMaxWaitHours` (default **168** = 7 days) — `0` disables the valve.

### Where the gate binds

Routine triggers only, and only after the existing up-to-date lineage gate:

- **Scheduled cron** (`params.scheduled`) and **agent-requested** runs
  (`params.routine`, set by `request_self_upgrade`) are batch-gated in
  `runSelfUpgrade`. A below-threshold result is a clean skip
  (`batch-below-threshold`) — **no drain, no cooldown, no run row churn** —
  so the next tick simply re-checks.
- **Operator manual** ("Upgrade now") and **force** and **dryRun** always
  bypass — the operator has chosen the moment.

The request layer (`request.ts`) applies the same gate before dispatch so an
agent gets the tally immediately instead of queueing a run that the runner would
skip. The runner re-checks authoritatively (defense in depth).

### Agent + operator surfaces

- `request_self_upgrade` returns a new `batch_below_threshold` status carrying
  `pendingPrCount`, `batchMinPendingPrs`, `batchMaxWaitHours`, `oldestPendingAt`
  and a message telling the agent to wait for the batch before validating live
  (or ask the operator to override).
- New read-only MCP tool `get_self_upgrade_queue_status` (grant
  `release_plan_read`) returns the full tally + eligibility so an agent can poll
  "is an upgrade imminent?" without side effects.
- The Upgrade Center panel shows "Batching updates: N of M merged updates
  accumulated" when a routine upgrade is waiting, and the skip-reason explainer
  maps `batch-below-threshold` to an operator-facing "Batching updates" note.
- One IO resolver, `resolveReleaseBatchStatus` (`release-batch-status.ts`),
  backs all three surfaces so they never disagree.

## Research & Benchmarking

- **Debian/Ubuntu `unattended-upgrades`** and **Renovate/Dependabot grouping**
  both batch changes rather than acting per-change; Renovate's
  `prConcurrentLimit` / schedule windows are the direct analog to a count +
  time valve. Pattern adopted: threshold + bounded wait. Anti-pattern rejected:
  per-change auto-apply (exactly today's behavior).
- **Kubernetes rollout `minReadySeconds` / batched surge** informed keeping the
  gate a soft admission optimization above the existing quiescence drain (the
  real safety backstop), not a replacement for it.

## Tests

- `release-batch.test.ts` — pure evaluator truth table (threshold, valve,
  fail-open, disabled), `parsePendingLog`, command builders, and
  `countPendingUpstreamCommits` (clean / deepen-retry / fail-open / throw).
- `release-batch-status.test.ts` — resolver applicability, fresh-fetch,
  no-lineage fail-open.
- `request.test.ts` — agent request returns `batch_below_threshold` with the
  tally; human/manual request is not batch-gated; routine flag on dispatch.
- `self-upgrade.test.ts` — scheduled and routine runs skip below threshold
  without draining; proceed at threshold; manual/force bypass; fail-open
  proceeds; `routine` payload field.
- `tool-registry.test.ts` — pack exposes both tools; grants mirror
  `TOOL_TO_GRANTS`.

## Non-Goals

- No change to the quiescence drain, recovery-point, or promoter/swap path.
- No CWQ WorkItem modeling (rejected by the kernel for this gate).
- No agent-controlled `force`.
