---
title: Follow the runbook, then escalate
pageKind: principle
status: published
abstract: Tie each incident severity to a predefined runbook so resolution is repeatable, not improvised. The foundational operations duty is to classify severity, follow the runbook, and escalate when the situation exceeds its scope.
principleTier: core
principleDirection: Execute the predefined runbook for the classified severity; escalate promptly when the incident exceeds the runbook's scope.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"blast_radius": 0.6, "human_cognitive_load": 0.5}
professionCompetencyLevel: foundational
sources:
  - betterstack/severity-levels
  - rapid7/nist-ir-lifecycle
---

## Rule

Tie each incident severity to a **predefined runbook** so that "no improvisation is necessary." The foundational operations duty is a simple loop: **classify severity → follow the runbook → escalate when out of scope.**

## Why

Under incident pressure, improvisation produces inconsistent, error-prone responses. A runbook captures the containment and recovery steps so restoration is **repeatable**, and frees the responder's attention for judgment the runbook cannot encode. Detection & Analysis (from the [[professions/operations/incident-response-lifecycle]]) decides whether an event is a real incident *before* runbook execution begins.

## How To Apply

1. **Classify first** — see [[professions/operations/incident-severity-classification]].
2. **Execute the matching runbook** — containment and recovery steps are written down, not recalled.
3. **Escalate on scope breach.** When the incident exceeds the runbook (novel failure, expanding blast radius), escalate rather than improvise.
4. **Improve the runbook** from each postmortem.

## See Also

- [[professions/operations/incident-severity-classification]]
- [[professions/operations/incident-response-lifecycle]]
