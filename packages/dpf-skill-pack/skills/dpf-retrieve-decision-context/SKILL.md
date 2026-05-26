---
name: dpf-retrieve-decision-context
description: "Use in the DPF codebase before a WWMD/kernel decision when the agent needs repo, backlog, spec, evidence, or principle context. Queries DPF MCP and local repo state before options are scored."
disable-model-invocation: false
user-invocable: true
allowed-tools: mcp__dpf__wiki_query mcp__dpf__search_specs_and_plans mcp__dpf__list_backlog_items mcp__dpf__list_epics Bash(rg *)
category: governance
assignTo: ["*"]
capability: null
taskType: deliberation
triggerPattern: "decision context|retrieve context|before WWMD|kernel context|principle context"
userInvocable: true
agentInvocable: true
allowedTools: ["mcp__dpf__wiki_query", "mcp__dpf__search_specs_and_plans", "mcp__dpf__list_backlog_items", "mcp__dpf__list_epics", "Bash"]
composesFrom: ["dpf-verify-substrate-first"]
contextRequirements: ["DPF MCP read tools reachable; repo available for rg"]
riskBand: low
enforces:
  - kernel/principles/verify-substrate-before-proposing-new
  - kernel/principles/live-state-over-seed-data
  - kernel/principles/no-assumptions
---

# DPF Retrieve Decision Context

Gather the evidence needed before a WWMD decision. Query current specs, live backlog, and relevant principles before scoring options.

## When to use

- A Build Studio, Claude, Codex, or coworker thread has an open architecture or workflow decision.
- The options mention new tables, tools, skills, epics, agent behavior, routing, or verification policy.
- The answer depends on live backlog state, current specs, founder-kernel principles, or repo substrate.

## Enforces

- `kernel/principles/verify-substrate-before-proposing-new`
- `kernel/principles/live-state-over-seed-data`
- `kernel/principles/no-assumptions`

## Steps

1. Restate the decision question in one sentence.
2. Query `wiki_query` for directly relevant principles, using `pageKind = "principle"` when available.
3. Search specs and plans for the domain terms in the question.
4. Query current epics and backlog items for overlapping work.
5. Use `rg` for local code, skill, schema, and route substrate before proposing new artifacts.
6. Return a compact context bundle: relevant principles, existing substrate, live backlog overlap, missing evidence, and any assumptions that remain.

## Guardrails

- Do not create backlog items from this skill. It is read-first context retrieval.
- Do not use seed files or stale docs as a substitute for live backlog state when MCP is available.
- Do not leak raw MCP payloads into an operator-facing answer. Summarize the finding and preserve identifiers only in audit detail.

## Worked example

A Build Studio decision asks whether each thread should start its own preview server. This skill queries founder-kernel capacity principles, searches specs for nonproduction environment policy, lists active Build Studio epics, and greps for existing environment orchestration code. The returned bundle shows that shared nonproduction environments and local integration gates already have planning coverage, so the next decision can score concrete options instead of inventing a fresh runtime pattern.
