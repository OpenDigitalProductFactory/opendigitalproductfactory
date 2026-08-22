---
name: dpf-brainstorming
description: "Use when an open problem needs candidate approaches before a decision — authoring a spec, scoping a feature, choosing a design. Generate 2-4 architecturally-distinct options grounded in the existing substrate (grep + code graph + specs) rather than invented in a vacuum, then hand off to dpf-decision-via-kernel when the options are distinct enough to weigh. The DPF-native ideation step; design docs land in docs/superpowers/specs/."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Grep Glob mcp__dpf__search_code_graph mcp__dpf__wiki_query mcp__dpf__query_backlog

# DPF coworker fields (Surface B — in-portal seed loader)
category: design
assignTo: ["*"]
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

When you face an open problem with no obvious single answer — a spec to author, a feature to scope, a design fork — **do not jump to the first approach that occurs to you, and do not invent options in a vacuum.** Generate a small set of genuinely distinct candidates, each grounded in what the DPF substrate already provides, then converge with the kernel.

This is the DPF-native ideation step. It is the predecessor to [`dpf-decision-via-kernel`](../dpf-decision-via-kernel/SKILL.md): brainstorming produces the options; the kernel weighs them. It replaces the retired upstream `brainstorming` skill so the composition resolves from one DPF source on every surface.

## When to use

- Authoring a spec under `docs/superpowers/specs/` and the approach is not yet settled.
- A design fork mid-implementation: schema shape A vs B, eager vs lazy, refactor vs special-case.
- The operator asks "how could we do X?" and there is real solution-space to explore.

## When NOT to use

- There is one obvious approach and no real alternative — proceed; don't manufacture options to look thorough.
- The decision is purely empirical (benchmark, security test) — gather evidence, don't brainstorm.
- The options are already enumerated and you only need to choose — go straight to `dpf-decision-via-kernel`.

## Steps

1. **Frame the problem in one sentence.** Name the decision and what makes it open. If you cannot state it crisply, you are not ready to generate options.

2. **Ground before inventing.** The DPF architecture is denser than first reads suggest — most "we'll need a new X" reflexes are wrong because X already exists. Before listing approaches, sweep the substrate so the options are real:
   - `mcp__dpf__search_code_graph({ query: "<topic>", limit: 10 })` for a curated subgraph.
   - `mcp__dpf__wiki_query` for kernel principles that already constrain this decision class.
   - Existing specs/plans under `docs/superpowers/specs/` and `docs/superpowers/plans/` — an approved design may already exist.
   - This composes with [`dpf-verify-substrate-first`](../dpf-verify-substrate-first/SKILL.md) when an option would introduce a new substrate concept.

3. **Generate 2-4 architecturally-distinct options.** Each gets a short `id` and a one-line description naming what makes it *distinct* — not three flavors of the same idea. Aim for real diversity of approach (the `diversity-of-thought` principle): the minimal fix, the durable rebuild, the reuse-existing path.

4. **Surface the tensions, not just the options.** For each, name the axis it wins on and the axis it loses on (speed vs maintainability, blast radius vs reuse). This is the raw material the kernel scores.

5. **Hand off.** If the options are architecturally distinct and weighable → invoke [`dpf-decision-via-kernel`](../dpf-decision-via-kernel/SKILL.md) (do not pick by gut). If one option is clearly correct after grounding → say so and proceed. Save the resulting design doc to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.

## Guardrails

- **No vacuum options.** An option you cannot tie to existing substrate or a concrete mechanism is a guess, not a candidate. Ground it or drop it.
- **Don't pre-decide and then rationalize.** If you already favor an option, list its strongest competitor honestly — the kernel exists to catch the case where your default is wrong.
- **2-4 is the sweet spot.** One option is not a brainstorm; more than four dilutes the weighing.

## See also

- Successor: [`dpf-decision-via-kernel`](../dpf-decision-via-kernel/SKILL.md) — scores the options against the kernel (WWMD).
- Composes with: [`dpf-verify-substrate-first`](../dpf-verify-substrate-first/SKILL.md) — when an option proposes a new substrate concept.
- Spec/plan locations and conventions: AGENTS.md §16.
