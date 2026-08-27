---
name: dpf-brainstorming
description: "Use when an open DPF problem needs candidate approaches before a decision — authoring a spec, scoping a feature, choosing a design."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Grep Glob mcp__dpf__search_code_graph mcp__dpf__wiki_query mcp__dpf__query_backlog

# DPF coworker fields (Surface B — in-portal seed loader)
category: design
assignTo: ["build-specialist", "platform-engineer", "external-coding-agent", "software-engineer"]
capability: null
taskType: deliberation
triggerPattern: "brainstorm|explore options|candidate approaches|how might we|design options|ideate|what are the ways|possible approaches"
userInvocable: true
agentInvocable: true
allowedTools: ["Grep", "Glob", "mcp__dpf__search_code_graph", "mcp__dpf__wiki_query", "mcp__dpf__query_backlog"]
composesFrom: []
contextRequirements: []
riskBand: low

# Kernel principle enforcement
enforces:
  - kernel/principles/design-research-required
  - kernel/principles/research-before-implementing
  - kernel/principles/consult-specs-first
  - kernel/principles/diversity-of-thought
---

# DPF Brainstorming

Generating options is assumed. The DPF layer is that an option must be **grounded in existing substrate** before it counts as a candidate, and that the kernel — not taste — picks the winner.

Predecessor to [`dpf-decision-via-kernel`](../dpf-decision-via-kernel/SKILL.md): this produces the options, the kernel weighs them.

## When to use

- Authoring a spec under `docs/superpowers/specs/` with the approach unsettled.
- A design fork mid-implementation: schema shape A vs B, eager vs lazy, refactor vs special-case.
- The operator asks "how could we do X?" and there is real solution-space.

## When NOT to use

- One obvious approach and no real alternative — proceed; do not manufacture options to look thorough.
- The decision is empirical (benchmark, security test) — gather evidence instead.
- Options are already enumerated — go straight to `dpf-decision-via-kernel`.

## Ground before inventing

This is the step that makes the difference. The DPF architecture is denser than first reads suggest, and most "we'll need a new X" reflexes are wrong because X already exists. Before listing approaches:

- `search_code_graph({ query: "<topic>", limit: 10 })` for a curated subgraph.
- `wiki_query` for kernel principles that already constrain this decision class.
- Existing `docs/superpowers/specs/` and `docs/superpowers/plans/` — an approved design may already exist.
- [`dpf-verify-substrate-first`](../dpf-verify-substrate-first/SKILL.md) when an option would introduce a new substrate concept.

## Then

Produce 2-4 architecturally distinct options — the minimal fix, the durable rebuild, the reuse-existing path — each with a stable `id` and the axis it wins and loses on. Those tensions are the raw material the kernel scores.

Hand off to [`dpf-decision-via-kernel`](../dpf-decision-via-kernel/SKILL.md) rather than picking by gut. If one option is clearly correct after grounding, say so and proceed. Save the design doc to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.

## Guardrails

- **No vacuum options.** An option you cannot tie to existing substrate or a concrete mechanism is a guess. Ground it or drop it.
- **Do not pre-decide and then rationalize.** If you already favor an option, list its strongest competitor honestly — the kernel exists to catch the case where your default is wrong.

## See also

- Successor: [`dpf-decision-via-kernel`](../dpf-decision-via-kernel/SKILL.md) (WWMD scoring).
- Composes with: [`dpf-verify-substrate-first`](../dpf-verify-substrate-first/SKILL.md).
- Spec/plan locations and conventions: [AGENTS.md §5](../../../../AGENTS.md).
