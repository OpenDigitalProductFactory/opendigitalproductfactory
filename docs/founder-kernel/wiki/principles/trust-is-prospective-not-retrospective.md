---
title: Trust Is Prospective, Not Retrospective
pageKind: principle
status: published
abstract: The platform exists to anticipate and prevent the wrong action, not merely to record the actions already taken.
principleTier: commandment
principleDirection: Weigh a consequential action against broader context and its potential consequences before it executes; treat the record of past outcomes as the learning mechanism, not the goal.
principleDimensionVector: {"legibility_of_consequence": 1.0}
principleWeight: 0.3
principleWeightRationale: >-
  Focused vector + low weight, per AUTHORING.md's procedural-meta guidance. This principle
  governs WHEN a consequence must be surfaced, not which substantive option is better, so it
  has no business tilting trade-offs like shortcut-vs-proper-fix. A first cut carrying
  blast_radius / reversibility / governance_compliance dragged `quick-vs-proper-normal` to
  margin 0.213 (floor 0.3) — the same failure PR #2157 hit — because a small quick fix scores
  well on a negative blast_radius axis. Reversibility and blast radius remain central to the
  rule's PROSE (they set how hard the gate presses) without being vector axes that pull
  unrelated decisions.
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: This is the platform's central trust thesis and the clearest statement of what distinguishes governed agency from unsupervised autonomy — adopters need to see it plainly.
---

## Rule

Trust is earned by preventing the wrong action, not by documenting it afterwards. Before a consequential action executes, it is weighed and gated against broader context and its potential consequences. The accumulating record of past decisions and outcomes is the **learning mechanism** that makes that anticipation sharper — it is not the objective.

## Why

An LLM is trained to a point and thereafter lives inside its environment, memory, tools, and harness. Whatever wisdom it exhibits after that boundary comes from the harness, not from more training. Humans acquire the same capability by accumulating consequences until they can anticipate them — what we call becoming wise. This platform's purpose is to do that deliberately, and at a scale no individual can reach.

The failure this guards against is specific and irrecoverable: trusted autonomy proceeding unsupervised into harm — the class of incident where an agent wipes a production database *and its backups*. Evidence collected after that event is worthless to the party who lost the data. Trust does not survive it, and no audit trail restores it. An audit log is a retrospective artifact; it explains a loss it did not prevent.

This is why the platform invests in graphs, corpora, and decision gates. Their value is not that they remember — retrieval is solved. Their value is that they can **surface the consequence before the act**. A corpus that only records what happened is an archive. A corpus that carries the detail which highlights a potential consequence *shapes the action*, and that is the job.

## Applies To

Every actor taking consequential action — in-platform coworkers, external coding agents, and humans. Symmetric by design: the gate is on the consequence, not on who is acting. It does not apply to read-shaped, reversible, non-committing work, which must stay fast and ungated; over-gating trivial action trains people to bypass gates and destroys the control that matters.

## How To Apply

Before a consequential action, establish what could go wrong and whether the actor can see it — do not rely on the actor's confidence. Retrieve the context that bears on the *consequence*, not just the context that bears on the task. When a corpus, graph, or prior outcome indicates a risk, surface it in the decision path where it can change the action, not in a log read afterwards.

Design capture accordingly: when recording an outcome, write down what a future actor would need in order to anticipate this situation — the condition that made it go wrong, not merely that it went wrong. An entry that cannot shape a future action is an archive entry, and archives do not build trust.

Autonomy is granted against demonstrated ability to anticipate, and it is bounded by the reversibility and blast radius of the action — never by fluency or by accumulated volume of successful past runs alone.

## Decision Dimensions

- `legibility_of_consequence: 1.0` — the principle exists to make consequence visible at the moment of decision. This is its defining axis and deliberately its only one.

The vector is single-axis and the weight is low (0.3) by design. This rule governs *when a consequence must be surfaced*, not *which substantive option is better*, so it must not tilt trade-offs it has no bearing on. Blast radius and reversibility still determine how hard the gate presses — that is stated in **How To Apply** — but they are not vector axes here, because a small shortcut scores well on a negative `blast_radius` axis and would be wrongly endorsed by this principle.

## Examples

- **Positive:** An agent about to run a destructive migration retrieves prior incidents and the affected data state, surfaces "this pattern wedged an install with existing rows" *in the approval path*, and the action is amended before it runs. The corpus changed the act.
- **Counterexample:** The same agent runs the migration, wedges the install, and a complete, tamper-evident record of the decision is written to the audit ledger. Governance is satisfied on paper; the install is broken and trust is spent. Perfect retrospective evidence, zero prospective value.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
