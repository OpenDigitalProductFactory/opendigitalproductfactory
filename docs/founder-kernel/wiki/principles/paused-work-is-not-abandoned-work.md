---
title: Paused Work Is Not Abandoned Work
pageKind: principle
status: published
abstract: Staleness thresholds default generous. Work untouched for days is usually waiting for its operator, not abandoned, and the cost of destroying paused work far exceeds the cost of holding it.
principleDirection: Default a staleness threshold to seven days, prefer an explicit state signal over elapsed time, and never apply a hard idle timeout to an open session.
principleTier: core
principleDimensionVector: {"blast_radius": -0.6, "operator_effort": -0.4, "long_term_maintainability": 0.3}
principleWeight: 0.5
principleWeightRationale: A sizing default rather than a safety gate; weighted to inform threshold choices without competing with the destructive-action commandments.
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Operators need to know the platform will not reap their paused work while they are away; the threshold and its reasoning are part of the trust contract.
---

## Rule

When any automation decides that something is stale, abandoned, or safe to clean up — worktree reaping, session timeouts, queue time-to-live, job expiry — **default high enough that paused work survives**.

- **Seven days** is the default for a staleness decision, unless there is a specific reason to be more aggressive.
- **Never apply a hard idle timeout while a session is open.** Long pauses are part of the workflow, not a failure signal.
- **Prefer an explicit state signal over elapsed time.** Merge state, branch state, an explicit release. Time is a backstop, not the primary signal.
- **State what the threshold absorbs** when choosing one, so a later reader knows which constraint sized it.

## Why

An operator travels. A rate-limit window stalls progress for days. A worktree, branch, queued task or session untouched for three days is often not abandoned — it is waiting for a person to come back.

Thresholds that feel reasonable for a nine-to-five desk worker steamroll that. Founder direction, 2026-05-16, sizing a worktree sweep window: *"I'll travel periodically and we hit limits that will delay progress, and don't want to prematurely remove worktrees that are just waiting for me, or the weekly limit to be restored."*

Seven days is not arbitrary. It survives a week of travel plus a weekly rate-limit reset. A bare number reads as arbitrary and invites someone to shave it to three to feel tidier; the rationale is what prevents that.

The asymmetry is the whole argument. Holding paused work costs a little disk and a little list noise. Destroying it costs work that may exist nowhere else.

## How to apply

- Size every staleness threshold against the seven-day default and record the reason if you deviate.
- Apply the same default to queue time-to-live and pending-work expiry — anything that could be waiting on a person.
- When a reaper does act, prefer a reversible disposition (archive, detach, mark stale for explicit adoption) over deletion.

## Related

`worktree-selection-and-reaping` · `prefer-reversible-containment` · `destructive-actions-require-explicit-go` · `propose-acknowledge-reassign`
