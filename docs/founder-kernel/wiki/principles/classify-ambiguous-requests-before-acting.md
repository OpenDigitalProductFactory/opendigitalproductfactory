---
title: Classify ambiguous requests before acting
pageKind: principle
status: published
abstract: When a request could reasonably mean more than one work type, classify the request before acting so fixes, governance, backlog, documentation, and self-improvement loops are not silently collapsed into one narrower task.
principleTier: commandment
principleDirection: Stop before code or runtime edits when a request is work-type ambiguous; classify it from observable context, consult the owning governed scope, and ask only for unresolved human intent.
principleDimensionVector: {"governance_compliance": 1.0, "long_term_maintainability": 0.9, "reusability": 0.8, "schema_grounding": 0.7, "evidence_density": 0.6, "speed_to_value": -0.2, "human_cognitive_load": -0.2}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
  - external-coordination
  - ring-1-coworker
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Operators and adopters need confidence that AI coworkers and external agents will not silently reinterpret governance or self-improvement requests as narrow code fixes.
authoredAt: 2026-07-24
authoredBy: mark-bodman
---

## Rule

When an operator request could reasonably mean more than one work type, classify the request before acting. Common ambiguous classes include:

- immediate product fix
- runtime investigation
- specification or documentation update
- backlog, Workroom, or decision-record coordination
- governance or WWMD decision
- autonomous self-improvement loop

The agent should inspect relevant governed context first - current files, specs, backlog, Workrooms, live DB state, and available MCP tools - then consult the decision scope that owns any remaining platform, business, or craft choice. A high-confidence, conflict-free result resolves the classification and the agent proceeds. Ask one targeted question only for human intent, consent, or decision residue the governed scope cannot resolve. Do not start code edits, runtime state changes, or hidden direct fixes until the work type is clear enough to route.

If the request mentions AI coworkers, proactivity, autonomy, backlog, WWMD, process gaps, self-improvement, or the platform improving itself, prefer the highest-governance interpretation unless the operator explicitly asks for an immediate narrow repair. That means using the relevant DPF MCP, Workroom, backlog, and decision tools before implementation.

## Why

Ambiguous work can look deceptively simple. A user may point at a broken product symptom, but the real request may be "why did the system not notice and improve itself?" Treating that as only a code defect fixes the visible row while leaving the platform unable to learn.

DPF depends on compounding operational learning. A missed routing decision should become a durable rule, a backlog signal, a spec update, or a coworker improvement, not a private correction inside one thread. Classifying the work type up front keeps the agent from collapsing governance, documentation, and self-improvement into the easiest local edit.

## Applies To

This principle applies to in-platform coworkers, external coding agents, and humans acting on DPF work. It is especially important at the start of direct-agent threads, Build Studio ideation/planning, support investigations, incident follow-ups, and any request that mixes a symptom with questions about process, autonomy, or coworker responsibility.

It does not require asking the operator for every task. Obvious one-class requests can proceed after normal environment verification. The classification question is required only when the operator's intent remains ambiguous after checking governed context.

## How To Apply

1. **Detect work-type ambiguity.** Ask whether the request could be a fix, investigation, doc/spec change, governance decision, backlog item, or self-improvement loop.
2. **Check governed context first.** Inspect the relevant specs, backlog, Workrooms, live state, and available tools. Do not ask the operator to answer facts the platform can inspect.
3. **Consult before asking.** Route a platform/build choice through WWMD, an organization business choice through WWWD, and a consequential craft choice through WSID. Act on a high-confidence, conflict-free result and record its ledger.
4. **Ask only for unresolved residue.** One targeted question may carry a legitimate escalation, owner-consent request, or factual clarification after the owning scope has been checked. Never ask the operator to classify a choice WWMD/WWWD/WSID can resolve.
5. **Route by selected class.** Use backlog or Workrooms for coordinated work, specs/docs for durable contracts, and code only after the governance path is clear.
6. **Preserve documentation continuity.** A fix-first sequence may be appropriate for an incident or an explicit urgent repair, but it never waives the later spec, docs, backlog, decision, or evidence record. Do not claim done until that continuity exists or a concrete no-docs-needed reason is recorded.

## Decision Dimensions

- `governance_compliance: 1.0` - the rule exists to keep work on the governed path.
- `long_term_maintainability: 0.9` - future agents need to know why the work was done, not just what changed.
- `reusability: 0.8` - a classified request becomes a reusable process signal across clients and coworkers.
- `schema_grounding: 0.7` - backlog, Workroom, decision, and spec records are the platform's structured memory.
- `evidence_density: 0.6` - classification creates an auditable trail that can be reviewed later.
- `speed_to_value: -0.2` - classification can add a small pause, accepted to avoid the larger cost of the wrong work.
- `human_cognitive_load: -0.2` - one targeted question is acceptable; broad interrogation is not.

## Examples

- **Positive:** The operator says a discovered printer was not identified and asks why the assertive AI coworker did not resolve the gap. The agent classifies the request as a self-improvement loop, opens or updates a Workroom, runs WWMD, updates the spec, creates any needed backlog follow-up, and then implements the code fix.
- **Counterexample:** The agent directly patches the printer row or adds a one-off heuristic, then reports success. The visible symptom improves, but the coworker process remains unable to detect and close similar gaps.
- **Positive:** The operator says "this button is broken; fix it now." The agent treats it as an immediate product fix, but still records documentation impact and evidence before claiming done.

## See also

- `[[principles/no-assumptions]]`
- `[[principles/consult-specs-first]]`
- `[[principles/learnings-belong-in-the-shared-commons]]`
- `[[principles/architecture-over-shortcuts]]`
- `[[principles/build-gate-mandatory]]`
