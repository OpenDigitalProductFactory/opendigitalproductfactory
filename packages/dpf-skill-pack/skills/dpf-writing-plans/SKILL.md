---
name: dpf-writing-plans
description: "Use when a filed DPF backlog item needs an implementation plan before code is written."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob mcp__dpf__search_specs_and_plans mcp__dpf__search_code_graph mcp__dpf__get_backlog_item mcp__dpf__get_work_capsule mcp__dpf__query_backlog mcp__dpf__create_backlog_item mcp__dpf__record_plan_backlog_coverage mcp__dpf__check_plan_backlog_coverage

# DPF coworker fields (Surface B — in-portal seed loader)
category: design
assignTo: ["build-specialist", "platform-engineer", "external-coding-agent", "software-engineer"]
capability: null
taskType: workflow
triggerPattern: "write (a |the )?plan|implementation plan|plan (out |this )?work|phased plan|how do we build|break .* into steps"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob", "mcp__dpf__search_specs_and_plans", "mcp__dpf__search_code_graph", "mcp__dpf__get_backlog_item", "mcp__dpf__get_work_capsule", "mcp__dpf__query_backlog", "mcp__dpf__create_backlog_item", "mcp__dpf__record_plan_backlog_coverage", "mcp__dpf__check_plan_backlog_coverage"]
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

3. **Consume the start-of-work impact contract.** Once exact edit paths are claimed, read the Workroom's `verificationState.changeImpactContract` (also returned by `claim_capsule_scope`). Put every `testImpact` and `guardObligation` in the relevant phase before implementation begins. If the contract is `unresolved`, plan exhaustive verification and an explicit impact-resolution step; never translate missing advice into an exemption.

4. **Write phased steps and classify delivery boundaries.** Each phase needs a concrete deliverable, touched files, dependencies, and functional verification. Mark whether it is independently shippable or only internal sequencing. For every independently shippable deliverable, query for an existing covering BI and reuse it when present; otherwise compose with `dpf-file-backlog-item` and file it. An `xlarge` umbrella always requires this decomposition decision before implementation.

   If the plan opens with an agent-execution preamble, use the DPF-native one — **never copy the retired `superpowers:*` boilerplate from older plans** (~280 historical plans still carry it; those skills no longer exist on any surface, and the `check-no-retired-superpowers-skills` CI ratchet fails a new reference). Canonical preamble:

   > **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

5. **Record live backlog coverage.** Call `mcp__dpf__record_plan_backlog_coverage` with the umbrella BI, plan path, deliverable graph, BI mappings, and decision:
   - `decomposed`: every independent deliverable maps to a live new or existing BI;
   - `atomic`: no deliverable is independently shippable, with a substantive operator rationale explaining why one BI is correct.

   Copy the returned receipt, parent BI, deliverable-to-BI mappings, and dependencies into a `## Backlog coverage` plan section. `mcp__dpf__check_plan_backlog_coverage` is the resumability check. If MCP is unavailable, the tool is missing, or the token lacks scope, stop and report that condition; Markdown checkboxes are not a fallback and planning/backlog completeness cannot be claimed.

   This is the decomposition-pack contract, not the initiative-readiness review contract. The minimum shape is:

   ```json
   {
     "itemId": "BI-...",
     "planPath": "docs/superpowers/plans/YYYY-MM-DD-feature.md",
     "planArtifactRef": { "kind": "repo-blob-at-commit", "repo": "owner/repo", "commitSha": "...", "path": "docs/superpowers/plans/YYYY-MM-DD-feature.md", "providerBlobId": "..." },
     "decision": "decomposed",
     "deliverables": [{ "title": "...", "requirementRefs": ["..."], "contractRefs": ["..."], "flowRefs": ["..."], "verificationRefs": ["..."] }]
   }
   ```

   Use decision: `decomposed` when independently shippable deliverables map to live BIs, or decision: `atomic` with a substantive rationale when they do not. Do not send `gate`, `findings`, or `resolvedFindingRefs` from the readiness lane. Do not send `pass` or `fail` as the decision; those belong to review writers, not plan coverage. Do not send the literal `pass` decision value in this contract. Make one corrected coverage call after verifying the BI and immutable plan. If the server returns `traceability-incomplete`, change only the named prerequisite and retry once; never blind-retry. If the tool is unavailable or shadowed, record the exact refusal and stop rather than calling another lane or fabricating a receipt.

   Treat a rejected coverage write as a remediation contract, not a blind retry:
   - When the result is `traceability-incomplete`, add or repair the initiative baseline and mappings named by the response before making one corrected call. Do not repeat identical arguments.
   - When the result is `plan-artifact-invalid`, reconcile the Workroom to the exact current branch and head SHA, repair the artifact or provenance named by the response, then make one corrected call. Do not mint a new plan path to dodge immutable provenance.
   - When the response says `retryable: false`, stop after following any explicit remediation that changes the request. If no authorized remediation is available, report the returned blocker; repeated calls cannot make the contract valid.

6. **Name the risks and the rollback.** What could break (blast radius), and how to back out. A plan that only describes the happy path is half a plan.

7. **Save it.** `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`, cross-referencing the BI id and the coverage receipt. This path is where `search_specs_and_plans` and reviewers expect plans to live. **Format is opt-in:** Markdown is the default and stays fully supported, but when the plan leans on a flow/state diagram, a multi-column table, or side-by-side option fan-out, an HTML artifact often reads better and keeps the operator in the loop — see [`html-artifacts-guide.md`](../../../../docs/superpowers/html-artifacts-guide.md) and the `_templates/spec.template.html` starting point. If you ship HTML-only, leave a short Markdown stub carrying the canonical coverage section so `search_specs_and_plans` and the guard can find it.

## Guardrails

- **No plan without a BI.** A plan is for a filed BI, not a TODO or a floating doc.
- **No independent work only in Markdown.** Planning is incomplete until each independently shippable deliverable has a live BI mapping and the plan carries a valid receipt.
- **No silent MCP bypass.** Unreachable MCP, a missing tool, or insufficient token scope stops planning before source implementation.
- **No plan against an unverified codebase.** Ground every "touch file X" claim in a real grep / code-graph hit.
- **Every phase carries its verification.** A phase with no "how I'll know it works" is an aspiration, not a step.

## See also

- Predecessor: [`dpf-file-backlog-item`](../dpf-file-backlog-item/SKILL.md) — the BI the plan implements.
- Upstream of the approach decision: [`dpf-brainstorming`](../dpf-brainstorming/SKILL.md) → [`dpf-decision-via-kernel`](../dpf-decision-via-kernel/SKILL.md).
- Plan/spec path conventions: [AGENTS.md §5](../../../../AGENTS.md).
