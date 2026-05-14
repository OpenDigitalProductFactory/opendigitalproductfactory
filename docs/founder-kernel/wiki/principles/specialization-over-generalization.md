---
title: Specialization Over Generalization
pageKind: principle
status: published
abstract: A specialist with 5 focused tools outperforms a generalist with 40.
principleTier: core
principleDirection: Prefer specialists with focused tool sets over generalists with broad surfaces.
principleDimensionVector: {"blast_radius": 0.7, "human_cognitive_load": -0.5, "reusability": 0.5}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principlePublic: true
principlePublicRationale: Documents DPF's agentic architecture posture for adopters and contributors building specialist coworkers.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

Each AI coworker agent should have access to no more than 10 tools relevant to its current task. When tool count exceeds 15, tool selection accuracy degrades significantly regardless of model capability — typically dropping into repetition loops as the model can no longer reliably pick the right tool.

## Why

Smaller models (Haiku-tier) lean heavily on the tool schema to decide what to call; a crowded tool list overwhelms that selection mechanism. The industry consensus across Azure, Redis, and major frameworks converges on 3–5 tools per specialist. DPF's evidence is consistent: Haiku with 40+ tools entered repetition loops calling the wrong tools; Haiku with 5–9 phase-filtered tools correctly generated code and called sandbox tools. Specialist coworkers also have smaller blast radius when something goes wrong and are easier to reuse as hive-mind components.

## Applies To

In-platform coworkers and external coding agents. Each role in the Build Studio pipeline (Product Designer, Architect, Software Engineer, QA / Scrum Master, Operations Engineer) is a specialist with a phase-filtered tool set. Does NOT apply to orchestrator-level dispatchers, which legitimately need broader visibility to route work.

## How To Apply

Tag every tool with the phases and contexts where it is relevant. The platform filters the tool list per agent invocation, exposing only the tools that role needs in that phase. When adding capability to an agent, ask: "can a different specialist own this instead?" Generalist coworkers are a code smell.

## Decision Dimensions

- `blast_radius: 0.7` — focused tool sets contain failure to a narrow surface; a specialist with a bad tool can damage less than a generalist with the same tool.
- `human_cognitive_load: -0.5` — operators and reviewers can reason about a specialist coworker faster than a kitchen-sink coworker.
- `reusability: 0.5` — specialists compose into other workflows; generalists rarely do.

## Examples

- **Positive:** Build Studio's Architect agent sees only the planning + spec tools during the `plan` phase; once the build phase starts, those are unscoped and the Software Engineer's sandbox tools become available.
- **Counterexample:** A coworker that sees every tool in `PLATFORM_TOOLS` regardless of context. Even with a frontier model it spends tokens on routing instead of work.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
