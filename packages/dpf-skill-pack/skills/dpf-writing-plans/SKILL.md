---
name: dpf-writing-plans
description: "Use when a filed DPF backlog item needs an implementation plan before code is written — a multi-step build, a migration, a refactor with ordering constraints. A plan is for a BI, not for floating intent: file the BI first (dpf-file-backlog-item), then write a phased plan grounded in the existing substrate and saved to docs/superpowers/plans/. The DPF-native planning step; replaces the retired upstream superpowers writing-plans dependency."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob mcp__dpf__search_specs_and_plans mcp__dpf__search_code_graph mcp__dpf__get_backlog_item

# DPF coworker fields (Surface B — in-portal seed loader)
category: design
assignTo: ["*"]
capability: null
taskType: workflow
triggerPattern: "write (a |the )?plan|implementation plan|plan (out |this )?work|phased plan|how do we build|break .* into steps"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob", "mcp__dpf__search_specs_and_plans", "mcp__dpf__search_code_graph", "mcp__dpf__get_backlog_item"]
composesFrom: ["dpf-file-backlog-item"]
contextRequirements: []
riskBand: low

# Kernel principle enforcement
enforces:
  - kernel/principles/consult-specs-first
  - kernel/principles/research-before-implementing
  - kernel/principles/design-research-required
  - kernel/principles/backlog-lives-in-postgresql
---

# DPF Writing Plans

When work is bigger than a single obvious edit, **write the plan before the code** — but in DPF a plan is not a floating document. It hangs off a filed backlog item. This skill is the DPF-native planning step; it replaces the retired upstream `writing-plans` skill so the flow resolves from one DPF source on every surface.

The order is fixed: **BI first, then plan.** [`dpf-file-backlog-item`](../dpf-file-backlog-item/SKILL.md) creates the governed work record; this skill turns it into an executable, phased plan.

## When to use

- A filed BI describes a multi-step build, migration, or refactor with ordering constraints.
- A spec is approved and you need the implementation sequence before touching code.
- The operator says "plan out X" and X is more than a one-file change.

## When NOT to use

- The work is a single obvious edit — just do it; a plan is overhead.
- There is no BI yet — file one first ([`dpf-file-backlog-item`](../dpf-file-backlog-item/SKILL.md)); a plan for floating intent is the substrate violation this skill exists to prevent.
- The approach itself is unsettled — brainstorm/decide first ([`dpf-brainstorming`](../dpf-brainstorming/SKILL.md) → [`dpf-decision-via-kernel`](../dpf-decision-via-kernel/SKILL.md)), then plan the chosen approach.

## Steps

1. **Anchor to the BI.** Confirm the BI exists and read it (`mcp__dpf__get_backlog_item`). The plan implements that BI; its acceptance criteria are the plan's definition of done.

2. **Ground in the substrate before sequencing.** Don't plan against an imagined codebase:
   - `mcp__dpf__search_specs_and_plans` — an approved design or prior plan may already cover this.
   - `mcp__dpf__search_code_graph` — find the real files/contracts the plan will touch.
   - This is the `consult-specs-first` + `research-before-implementing` discipline applied to planning.

3. **Write phased steps.** Each phase: a concrete deliverable, the files it touches, and its verification (how you'll know it works — functionally, not just structurally). Order by dependency. Call out the first phase that can ship independently.

4. **Name the risks and the rollback.** What could break (blast radius), and how to back out. A plan that only describes the happy path is half a plan.

5. **Save it.** `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`, cross-referencing the BI id. This path is where `search_specs_and_plans` and reviewers expect plans to live.

## Guardrails

- **No plan without a BI.** A plan is for a filed BI, not a TODO or a floating doc.
- **No plan against an unverified codebase.** Ground every "touch file X" claim in a real grep / code-graph hit.
- **Every phase carries its verification.** A phase with no "how I'll know it works" is an aspiration, not a step.

## See also

- Predecessor: [`dpf-file-backlog-item`](../dpf-file-backlog-item/SKILL.md) — the BI the plan implements.
- Upstream of the approach decision: [`dpf-brainstorming`](../dpf-brainstorming/SKILL.md) → [`dpf-decision-via-kernel`](../dpf-decision-via-kernel/SKILL.md).
- Plan/spec path conventions: AGENTS.md §16.
