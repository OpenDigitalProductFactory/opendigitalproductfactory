---
title: Propose, Acknowledge, Reassign (PAR)
slug: propose-acknowledge-reassign
pageKind: principle
status: published
abstract: Concurrent work — operator↔agent, agent↔agent, session↔session — collides when state mutates from more than one pen without an acknowledged handoff token. Either side proposes; the named owner explicitly acknowledges; reassignment back is also explicit.
principleTier: commandment
principleDirection: Before mutating any artifact, propose ownership to the named owner and wait for explicit acknowledgement recorded as state; never assume implicit consent from silence; reassignment back is also explicit.
principleDimensionVector: {"governance_compliance": 0.9, "evidence_density": 0.7, "long_term_maintainability": 0.6, "human_cognitive_load": -0.3, "speed_to_value": -0.2, "legibility_of_consequence": 0.6}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: false
authoredAt: 2026-05-22
authoredBy: mark-bodman
principleOverlapScan:
  highestAlignment: 0.60
  highestAlignmentSlug: never-fabricate
  scanRunAt: 2026-05-26
  rationale: |
    Below the §4.3 ship-freely threshold of 0.70 — no body-paragraph additivity argument
    required. Mechanical scan via principle_decide ran with ringScope=universal-ring and
    returned 10 commandment-tier principles (retrieval cap reached). Highest dimension-vector
    alignment was 0.60 against Never Fabricate; All Changes Land via PR Against Main and
    Build Gate Mandatory tied at the same level. These are dimension-vector alignments
    (do the candidate's features point the same way as the existing principle's vector?),
    not semantic-redundancy scores — PAR binds a different decision moment from any of
    those commandments (ack-before-mutate vs PR-lands-on-main / build-gate / don't-invent).
    Core-tier principles like worktree-per-session and human-in-the-loop-at-phase-boundaries
    were not returned in the retrieval set (the cap was reached on commandments); the
    qualitative argument that PAR is upstream of worktree-per-session and adjacent to HITL
    still holds and is captured in the body's Related-Principles section.
---

# Propose, Acknowledge, Reassign (PAR)

**Concurrent work collides when state mutates from more than one pen without an acknowledged handoff token.** PAR is the upstream protocol that prevents this — it does not depend on whether the actors are operator + agent, two coworker agents, two Claude sessions in different worktrees, or one session running alongside a chief-architect review pass on the same artifact. The shape is identical in every case.

## The three steps

1. **Propose.** Either side names a piece of work, a decision, or an action and assigns a candidate owner.
2. **Acknowledge.** The named owner explicitly accepts, modifies, or declines. **No mutation begins without this token.** The token is recorded as **state, not chat text** — a capsule lease, a `ToolExecution` row, a `DecisionInteraction` outcome, an operator click on a card.
3. **Reassign.** Completion *or* mid-stream hand-back is also explicit: `session_detach(disposition)`, `release_capsule_scope`, a WWMD `escalate` / `defer`, a PR opened against the owner's branch. Silent abandonment is not a valid reassignment.

The cycle then repeats. Either side can initiate the next Propose.

## Why this exists

Triggering incident 2026-05-22: a session was asking sequential clarification questions on a spec while a chief-architect pass was mid-edit on the same artifact. Two pens, no handoff token, collision. The clarification-question loop felt fuzzy because ownership was fuzzy.

Four prior concurrency-collision rules are downstream symptoms of the same missing principle:

- [`worktree-per-session`](worktree-per-session.md) — each concurrent session in its own worktree (collision prevention by physical isolation).
- `feedback_git_commit_only_for_concurrent_sessions` (memory) — `git commit --only <paths>` to scope the commit (collision prevention at the commit layer).
- `feedback_pr_overlap_check_before_pushing` (memory) — sweep main + open PRs before pushing (collision detection before merge).
- `feedback_continuous_overlap_check` (memory) — re-sweep before every push in long autonomous runs (collision detection during long-lived ownership).

All four work. PAR is what makes them composable instead of an enumerated list of cases.

## Operating rules

- **No actor mutates an artifact that is currently in an acknowledged-by-another-actor state** without first proposing reassignment and receiving acknowledgement.
- **Sequential clarification questions to an operator who is mid-edit on the artifact are a PAR violation.** The propose step must hold for explicit acknowledgement first.
- **Idle acknowledgements expire on a heartbeat budget.** Expired ownership is *not* silently reassigned — it surfaces as `stale` for explicit adopt-orphan. Per [`idle-is-not-abandoned`](../../../../) (memory `feedback_idle_is_not_abandoned`), staleness thresholds must absorb operator travel + weekly rate-limit resets (default 7d minimum).
- **WWMD `escalate` and `defer` are reassignments to the operator UI**, not chat pings.
- **End every turn with a concrete proposed next step + named owner** (a reassign-back), never "Done." / "Investigating." / "Your call." This is the per-turn shape of PAR's reassign step.

## The acknowledgement-as-state requirement

The acknowledgement token must be queryable later. Chat text is not queryable — it lives in a transcript that decays. Acceptable acknowledgement surfaces:

- `WorkCapsule.claimedByActor` + `lastHeartbeatAt` (soft lease, with expiry)
- `FeatureBuild.phase` advancement + `phaseRuns` row (hard state transition, with audit trail)
- `DecisionInteraction.humanOutcome` (WWMD-mediated decision, with rationale)
- `ToolExecution` row for a proposal-mode tool that the operator approved (explicit click, with payload)
- A PR opened against a specific base branch (git is the audit trail)

Unacceptable acknowledgement surfaces:

- "I'll take it" in chat (no row written)
- A coworker assuming silence == consent
- An operator's last message being interpreted as a blanket approval for everything subsequent

## Anti-pattern

- Two Claude sessions in the same worktree, both staging files, one sweeping the other's stage into its commit via `git add -A`.
- An autonomous agent that sees a stale capsule and silently picks up the work without filing an adopt-orphan proposal first.
- A spec-review thread that opens PRs against the spec author's working branch while the author is still editing the spec.
- A coworker that asks "want me to continue?" three times in a row — that is a missing acknowledgement from the *prior* turn surfacing as repeated proposals instead of an actual ack.

## Penalty

This is a **commandment-tier** principle. The collisions PAR prevents are not bugs — they are protocol violations. The recovery cost of a single collision (lost staged work, overlapping PRs needing surgical revert, two sessions debugging the same bug from different worktree states) typically exceeds the entire savings of every "I'll just take it without asking" shortcut combined.

## Related principles

- [`worktree-per-session`](worktree-per-session.md) — physical isolation at the filesystem layer; PAR is the protocol on top.
- [`worktree-base-origin-main`](worktree-base-origin-main.md) — every new ownership cycle starts from a clean base.
- [`structured-handoffs-not-conversation-history`](structured-handoffs-not-conversation-history.md) — the durable artifact PAR's reassign step produces.
- [`human-in-the-loop-at-phase-boundaries`](human-in-the-loop-at-phase-boundaries.md) — phase-boundary approval is the canonical operator-acknowledgement surface.
- [`do-the-work-dont-task-the-operator`](do-the-work-dont-task-the-operator.md) — when reassigning back to the operator, propose a concrete next step, not a generic "your call."
- [`mention-uncommitted-changes`](mention-uncommitted-changes.md) — surfaces the working-tree state PAR needs to compute "who owns this right now."
