---
title: Commons are curated, not just appended
slug: commons-are-curated-not-just-appended
pageKind: principle
status: published
abstract: A shared corpus that only accretes decays. Every commons — WWMD, WWWD, WSID, code+AGENTS.md — is reviewed on a cadence by its accountable human for altitude (is this rule an instance of one already present?), lapsed contingency (was it only ever true under conditions that have passed?), scope drift, and rules a machine now enforces. Guards nominate candidates; only the human consolidates or retires. This is the maintenance half of "learnings belong in the shared commons".
principleTier: core
principleDirection: Review each commons corpus on a cadence for altitude, lapsed contingency, scope drift and machine-enforced rules; let guards nominate candidates and reserve consolidation and retirement to the accountable human.
principleDimensionVector: {"long_term_maintainability": 1.0, "reusability": 0.7, "schema_grounding": 0.5, "governance_compliance": 0.5, "evidence_density": 0.4, "human_cognitive_load": -0.8, "speed_to_value": -0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Adopters inherit DPF's doctrine corpora and will add to them. They need to know that the platform treats a commons as something maintained on a cadence rather than an append-only log, and that the review is a human act a guard can only nominate for — otherwise an inherited corpus grows until agents stop reading it.
authoredAt: 2026-08-01
authoredBy: mark-bodman
---

# Commons are curated, not just appended

`[[principles/learnings-belong-in-the-shared-commons]]` establishes how knowledge gets **in**. This principle is its other half: what keeps the corpus worth reading once it is there.

A commons that only accretes decays in a specific, measurable way. Rules arrive one at a time, each written for the case in front of its author, so the corpus fills with **instances of rules it already contains** stated at a lower altitude. Nothing is wrong with any single entry. The failure is emergent: the reader — increasingly an agent with a finite attention budget — pays for every restatement, and the general rule that would have covered all of them is buried among its own special cases.

## Rule

Review each commons corpus on a cadence. For each rule ask four questions:

1. **Altitude** — is this an instance of a rule already present? If so, lift the general rule, fold the specific ones into it, and keep every anchor.
2. **Contingency** — was this only ever true under conditions that may have passed? Mark it, or retire it.
3. **Scope** — is the concern still on-task for this corpus, or has it been overtaken?
4. **Enforcement** — does a machine now refuse this? If so, the corpus should carry the *stance when the refusal fires*, not the prohibition.

Guards **nominate**; the accountable human **decides**. No automated process may consolidate or retire a rule.

## Why

- **Attention is the scarce resource, not storage.** Doctrine an agent must read before acting is paid for on every session. A corpus of 74 rules where 16 are restatements of 3 costs its readers the full 74.
- **A rule at the right altitude covers cases its instances miss.** "An enforcement refusal is a stop, not a workaround" governs guards that do not exist yet; an enumeration of today's four hooks does not. Consolidation is a **coverage gain**, not only a size cut — which is why it is not merely tidying.
- **Rules have validity envelopes and the corpus does not record them.** Some doctrine was true of an environment, a model generation, a team size, or a business phase. Left unmarked, a lapsed rule reads as current and is obeyed long past its moment.
- **Machine-enforced prohibitions teach nothing.** When a hook refuses an action, the agent cannot perform it. Carrying the prohibition in every session buys nothing; what the agent needs — and what is usually missing — is what to do when refused.
- **Only a human can judge "still on-task".** Whether a concern still matters is a question about the business, not about the text. A guard can measure restatement; it cannot know that a rule protecting a constraint the company no longer has should go.

## Applies To

All four commons, each with its own accountable human:

| Corpus | Holds | Reviewed by |
|---|---|---|
| **WWMD** — founder kernel | decision rules, durable judgment | founder / maintainer |
| **WWWD** — org platform knowledge | durable org and platform facts | the org's accountable owner |
| **WSID** — profession corpus | role techniques, skills | the profession owner |
| **code + `AGENTS.md`** | code contracts, the always-on plane | maintainer |

## How To Apply

Trigger a review at whichever comes first: a release boundary, growth past the corpus's ratchet threshold since the last review, or a calendar floor so a quiet corpus is still examined. Then:

- Run the corpus's guards to get the **nomination list** — restatement candidates, expired or undated contingency markers, rules whose enforcement moved into a hook.
- Work the four questions above over the nominations, not over the whole corpus. Reviewing everything every time is how reviews stop happening.
- **Preserve rule identity across consolidation.** In `AGENTS.md` a rule's identity is its kernel-principle anchor, not its prose, so a consolidated rule carries every anchor it absorbed and the coverage guard proves nothing was lost. Give the other corpora the same property before consolidating them.
- Record what was retired and why. A rule removed without a reason returns.

## Decision Dimensions

- `long_term_maintainability: 1.0` — the entire point. An append-only corpus degrades monotonically; curation is the only thing that reverses it.
- `reusability: 0.7` — a rule lifted to the right altitude applies to cases its instances never enumerated.
- `schema_grounding: 0.5` — curation depends on rules having stable identity (anchors) that survives rewording, so the change is verifiable rather than trusted.
- `governance_compliance: 0.5` — the review is a governed human act with a named owner per corpus, not an automated rewrite.
- `evidence_density: 0.4` — reviews work a guard-produced nomination list, so each change answers a measured signal.
- `human_cognitive_load: -0.8` — COST axis, negative because the principle pulls hard against it. Reducing what a reader must hold to act correctly is the reason to curate at all.
- `speed_to_value: -0.3` — the review costs time that could have gone to features. The principle accepts that, exactly as `[[principles/learnings-belong-in-the-shared-commons]]` accepts the cost of routing through a governed channel.

## Examples

- **Positive:** A rulebook carries "query epics before creating one", "audit the schema before a large feature", "compose from shared micro-primitives" and "no parallel utilities at spec time". Review recognises four instances of one rule — *extend what exists* — already stated generally at the top of the file. The general rule absorbs their anchors; the procedures move to runbooks. The corpus shrinks and now also covers domains none of the four named.
- **Positive:** A rule says "never bind `:3001` directly". A `PreToolUse` hook now refuses it outright. Review replaces the prohibition with the stance — an enforcement refusal is a stop, surface it and do not route around it — which also governs the next hook added.
- **Counterexample:** A corpus grows for two years with no review. Every entry was correct when written. Agents begin skimming it because reading it costs more than the marginal rule is worth, and the commandment-tier rules lose their force by dilution. Nothing was ever wrong; nobody ever curated.

## When this does not apply

- **Commandment-tier rules are not consolidation candidates.** They may be reworded for clarity but not folded into a more general rule — their separateness is the point.
- **Append-only records are not commons.** Execution evidence, audit logs, decision ledgers and backlog history are meant to accrete; curating them destroys the record.
- **Mid-incident.** Do not curate doctrine while relying on it to resolve a live incident; capture the finding and review afterwards.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)

## See also

- Routing half of the same loop: `[[principles/learnings-belong-in-the-shared-commons]]`
- Why one canonical home makes consolidation possible: `[[principles/single-source-of-truth]]`
- What legitimately stays out of the corpus: `[[principles/selective-memory-not-total-recall]]`
- Review approves on evidence, not on who authored the rule: `[[principles/governance-approves-evidence-not-provenance]]`
