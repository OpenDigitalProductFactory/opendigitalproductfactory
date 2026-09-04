---
name: dpf-retrieve-decision-context
description: "Use before a WWMD/kernel or WWWD/business decision when the agent still needs context."
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

Gather the evidence needed before a decision. For a **platform/WWMD** decision, query current specs, live backlog, and founder-kernel principles. For a **business/WWWD** decision ("what would *we* do?"), also gather the organization's own context first: its **mission** and its **WWWD corpus** — the org-overlay `stance` / `heuristic` / `principle` pages seeded at onboarding from the company mission + archetype. The org speaks for itself before the platform kernel does.

## When to use

- A Build Studio, Claude, Codex, or coworker thread has an open architecture or workflow decision.
- The options mention new tables, tools, skills, epics, agent behavior, routing, or verification policy.
- The answer depends on live backlog state, current specs, founder-kernel principles, or repo substrate.
- **A business/WWWD decision** turns on how *this organization* operates — who it serves, what it stands for, how it weighs trade-offs. Its mission + WWWD corpus are the primary evidence; the platform kernel is only the fallback when that corpus is silent.

## Enforces

- `kernel/principles/verify-substrate-before-proposing-new`
- `kernel/principles/live-state-over-seed-data`
- `kernel/principles/no-assumptions`

## Steps

1. Restate the decision question in one sentence, and classify it: **platform/WWMD** (how the *platform* should be built) or **business/WWWD** (how the *organization* should act).
2. **For a business/WWWD decision, retrieve the org's own doctrine first.** Query `wiki_query` for the organization's WWWD corpus — `pageKind = "stance"`, then `"heuristic"`, then `"principle"` — phrasing the query around the decision topic. These org-overlay pages (origin `overlay`, seeded at onboarding from the company mission + archetype) are the primary evidence. The company **mission** is already in the coworker's context as Block 0, and also lives as the `org-mission` overlay page. Distinguish `overlay` (this org) from `kernel` (platform) origin in what you return.
3. For a platform/WWMD decision (or as the fallback when the org corpus is silent), query `wiki_query` for directly relevant founder-kernel principles, using `pageKind = "principle"`.
4. Search specs and plans for the domain terms in the question.
5. Query current epics and backlog items for overlapping work.
6. Use `rg` for local code, skill, schema, and route substrate before proposing new artifacts.
7. Return a compact context bundle: the org's mission + WWWD stance (for business decisions), relevant kernel principles, existing substrate, live backlog overlap, missing evidence, and any assumptions that remain. Label org-overlay vs kernel sources so the next step knows which doctrine spoke.

## Guardrails

- Do not create backlog items from this skill. It is read-first context retrieval.
- Do not use seed files or stale docs as a substitute for live backlog state when MCP is available.
- Do not leak raw MCP payloads into an operator-facing answer. Summarize the finding and preserve identifiers only in audit detail.

## Worked example

A Build Studio decision asks whether each thread should start its own preview server. This skill queries founder-kernel capacity principles, searches specs for nonproduction environment policy, lists active Build Studio epics, and greps for existing environment orchestration code. The returned bundle shows that shared nonproduction environments and local integration gates already have planning coverage, so the next decision can score concrete options instead of inventing a fresh runtime pattern.
