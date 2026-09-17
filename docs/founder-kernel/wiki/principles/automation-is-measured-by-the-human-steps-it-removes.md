---
title: Automation Is Measured by the Human Steps It Removes
pageKind: principle
status: published
abstract: Count the manual steps a human must take; software and automation investment is judged by how many it removes, weighted 100x when the step demands a file edit or a terminal command.
principleTier: commandment
principleDirection: Count the manual steps a human must take; software and automation investment is judged by how many it removes, weighted 100x when the step demands a file edit or a terminal command.
principleWeight: 0.3
principleWeightRationale: A measurement lens, not a tie-breaker. At tier default it eroded the canonical quick-vs-proper baseline below its margin floor — stated strongly, "remove human steps" reads as an argument for shortcuts and can outrank architecture-over-shortcuts and fix-the-seed-not-the-runtime. Low weight keeps it deciding how to compare two otherwise-sound options, never whether to do the sound thing.
principleDimensionVector: {"human_cognitive_load": -0.9, "operator_effort": -0.9, "operational_independence": 0.6, "legibility_of_consequence": 0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: States what the platform is FOR, so adopters can judge whether a feature earns its cost and contributors know which direction counts as improvement.
sources:
  - founder-direction/2026-09-17
---

## Rule

Every manual step a human must take to make the platform work is a cost, it is countable, and it counts against the platform's value.

- An in-product step — a button click, a phrase typed into a chat, a field that must be filled — costs **1**.
- A step that requires a **non-technical** user to edit a file or run a terminal command costs **100**.

**The measure is the change, and it is kept on two ledgers.** An absolute count answers little; what is scoreable is the **delta** a change makes to the human steps required — steps added, steps removed — recorded both for **the effort we go through** to build and run the platform, and for **what we build for others to use**. Every change can therefore state a number on each side, and a change that removes steps from our own delivery while adding them for the customer is not an improvement, it is a transfer.

An investment in software or automation is judged by the intervention cost it removes. This is the standard that **all planning and investment** is held to, not a UX nicety applied after a feature is designed.

Proactivity and AI coworkers exist for this reason. They were introduced into an otherwise non-AI platform to do what a human would otherwise have to do by hand. An automation that does not lower intervention cost has not earned its cost, however sophisticated it is.

## Why

The platform's promise is that work gets done without the customer having to do it. Founder direction, 2026-09-17: this is why proactivity and AI coworkers were introduced into an otherwise non-AI platform — not to make the product AI-shaped, but to be the hand that does the work the customer would otherwise do by hand. The originating organization's own naming carries the same theme; that rationale is install-specific and is recorded privately rather than in public doctrine, because the thesis is universal while the anecdote is not.

The 100x weight is not arithmetic, it is a statement about who the platform is for. A technical step does not merely take longer for a non-technical user; it can stop them entirely, and then the capability behind it may as well not exist. A feature reachable only by editing a config file is a feature most customers do not have.

**This delta is one of the platform's differentiators, so it is a positioning claim as well as an internal measure.** What makes the platform more useful than an alternative is not a longer feature list but a lower intervention cost for the same outcome — a capability a customer can actually reach without a technician is worth more than a richer one they cannot. A comparison against an alternative should therefore be argued on steps required for a given outcome, and that argument is only available if the number is kept (see the two ledgers above).

**A delta needs a baseline, and the baseline is research.** The number is only real if the current way the work is done has been observed and counted first — the as-is. This is what research is for here, and it is the lineage this principle comes from: **value stream mapping**, where the current-state map is what makes waste visible and improvement arguable. Without a measured as-is, a claimed reduction is an assertion about a process nobody counted. See [[principles/design-research-required]].

The baseline has two modes, and they are not interchangeable. Where the platform **already does something referenceable**, the as-is is that behaviour, observed and counted — a real measurement. Where the work is **net-new**, there is no as-is to count, and the baseline comes from **pure research**: how the work is done today outside the platform, by whatever means people currently use. Both give a number to improve against; only the first is a measurement of this platform.

Counting matters because judgement alone does not hold. `human_cognitive_load` and `operator_effort` are already decision axes, but a score is supplied by whoever authors the option, so a proposal can assert it is low-effort and nothing can contradict it. Steps enumerated from a flow can be checked against the claim, which makes the claim falsifiable and makes a reduction reportable as value.

## How to apply

Enumerate the human steps a flow actually requires, from the flow itself rather than from its author's description, and weight them. State the intervention cost a proposal adds or removes. A proposal that lowers it may claim the reduction as measured value; a proposal that raises it must say so, and say why the step must exist.

Three distinctions decide whether a count is honest:

- **A step that exists to be seen is not friction.** An explicit authorization before a consequential or irreversible action is the value, not a cost to optimize away — see [[principles/human-in-the-loop-at-phase-boundaries]] and [[principles/show-the-consequence-before-the-confirm]]. Separate steps that exist *because a human must decide* from steps that exist *because the platform could not do the work itself*. Only the second kind is waste. A metric that conflates them creates pressure to hide the gates that protect the operator.
- **Relocated cost is not removed cost.** Moving a step from a human to an agent that then asks a clarifying question has moved the cost, not deleted it. Count the question.
- **The weight is a declared policy, not a measurement.** 100 is a deliberate choice about who the platform serves; it may be revisited with evidence and must not be cited as an empirically derived constant.

## Decision dimensions

The vector is deliberately narrow: strong reductions in `human_cognitive_load` (-0.9) and `operator_effort` (-0.9) — cost axes, where lower is better — plus `operational_independence` (0.6), the customer operating without reaching for a technician. `legibility_of_consequence` stays mildly positive (0.4) rather than neutral: removing steps must not remove the operator's sight of what an action will do, which is this principle's most likely misapplication.

`speed_to_value` and `product_fit` were removed on purpose. With them the principle read as an argument for whatever ships soonest and drove the canonical `quick-vs-proper-normal` decision below its margin floor — the quick fix gaining on the proper seed fix. That is the inverse of the intent: a shortcut usually *raises* lifetime intervention cost by leaving a defect for a human to work around. `principleWeight` is 0.3 for the same reason (AUTHORING.md: vector magnitude is scale-invariant, weight is the only real knob). This principle compares two sound options; it never argues against doing the sound thing.

## Value is the net, and that is what makes it a proof

The proof of value is **not** that a new capability or interface exists — building one is, by itself, more work and more steps. The proof is the **net**: cost removed minus cost added.

An interface that introduces five in-product steps costs 5. If it retires a step where a human was editing a file or running a command by hand — the 100x class — the change is worth **95**, and that subtraction is the claim. Stated the other way: a feature is not justified by existing, it is justified by what it stops a human from having to do.

This is also why a gross count misleads in both directions. A change can add steps and still be strongly positive; a change can add no steps and be worth nothing.

## Where work should move: human, then AI, then code

The ledger has three tiers, and improvement means moving work **down** it:

| Tier | Cost unit | Character |
|---|---|---|
| **Human** | steps, weighted 1 / 100 | attention and judgement; the scarcest and most expensive |
| **AI coworker** | tokens, plus interpretive burden | absorbs manual work, but non-deterministic and interpretive |
| **Code** | negligible per execution, paid once in maintenance | deterministic, repeatable, composable |

**Human to AI coworker** removes human steps. This is what proactivity and coworkers are for.

**AI coworker to code** removes *AI* cognitive load, and it is a real improvement for the same reason the first move is: work that a coworker currently reasons through step by step becomes something it no longer has to hold. AI is interpretive and non-deterministic; code is neither. So this move buys determinism as well as cost — which is the same argument the platform already makes for enforcing non-negotiables in a gate rather than a prompt. Code here is not a replacement for the coworker: it is the substrate that supports and optimises what the coworker does, and lets it reach outcomes with less carried burden, while remaining able to interpret, judge, and work with other agents and tools where that is what the task needs.

This is why human-resource and AI-resource management sit side by side in the platform rather than in separate worlds: the transition between tiers is the thing being managed, and it can only be measured if both sides are on one ledger. **Every tier has a cost of use — cost of human, cost of AI tokens, cost of maintaining code** — so a move down the ladder must show the cost it removes exceeds the cost it takes on. Pushing everything into code is not free; it trades token spend and interpretive reach for maintenance and rigidity, and a task that genuinely needs judgement should stay where judgement lives.

*Resolver note: the AI side of this ledger needs per-thread and per-run token and cost attribution to be real. That machinery exists and is currently inert — see BI-CCF1ACBB, where the per-thread cost ledger joins on columns nothing populates, so it has never reported a number. This measure is unavailable on the AI tier until it does.*

## `human_cognitive_load` is a required measure, not an optional axis

Any decision that descends from this principle **must score `human_cognitive_load`**. Not "may", and not "where relevant": a decision taken under this doctrine that does not state its effect on human attention has not been evaluated against the doctrine, and its result is not a valid answer under it.

This closes the gap that makes the principle otherwise unfalsifiable. The kernel's closed key set already rejects an *unknown* axis, but nothing today requires a *known* one — so an option can simply omit the axis this principle is about and score well on speed and fit alone. Omission is the failure mode, not mis-scoring: a wrong score is visible and arguable, an absent one is silent.

Scoring it is also not satisfied by asserting zero. A decision that genuinely does not touch human attention says so with a rationale; `0` supplied to clear a field is the same omission wearing a number.

⟦situational: no guard enforces this yet — the requirement is prose, and prose is exactly what this platform has repeatedly found does not hold. Until a deterministic check refuses an unscored decision descending from this principle, treat every such decision as unverified against it. Review at BI-AB039FA5.⟧

## Scope and propagation

This is authored as platform-development doctrine (**WWMD**), because the first thing it governs is how DPF builds, deploys and evolves itself: the workrooms that own the platform's own delivery are where an intervention cost is either designed out or shipped to every install. A manual step in DPF's own build or upgrade path becomes a manual step for every operator who runs it.

But the philosophy does not stop at the platform boundary — it is the same claim one scope down. A customer organization's operating doctrine (**WWWD**) inherits the standard: work the business would otherwise do by hand is what its coworkers exist to absorb, and its value streams are judged the same way. An individual's professional judgement (**WSID**) inherits it again, at the altitude of a single task.

The cascade is **inheritance of the standard, not of the decision**. Each scope still owns its own answers — see [[principles/decisions-belong-to-their-scope]]: a customer's business question is not settled by platform judgement, and a counted intervention cost in DPF's delivery path says nothing about which steps that customer's business should keep. What propagates is the obligation to count, to weight a technical step at 100, to score `human_cognitive_load` on every descending decision, and to be able to show what an automation removed.

## Examples

- A platform capability requires each operator to place a credential in an environment variable and restart the client. The step is a file edit by a non-technical user, repeated per machine and per rotation — the 100x class — and a standards-based flow that authorizes once in a browser and refreshes invisibly removes it entirely.
- A coworker completes an authorized repair and delivers it without asking permission at each phase. Intervention cost falls and no judgement is lost, because the authorization already covered the work.
- A coworker is given an approval button for a step whose outcome it can already determine. The click costs 1 and decides nothing: remove it.
- A destructive migration is surfaced for explicit consent before it runs. That step costs 1 and stays, because it exists to be seen.

## Related principles

- [[principles/human-in-the-loop-at-phase-boundaries]] — where a human step genuinely belongs.
- [[principles/show-the-consequence-before-the-confirm]] — a step that must be seen must also be legible.
- [[principles/never-ask-user-to-run-commands]] — the operational form of the 100x weight for agents.
