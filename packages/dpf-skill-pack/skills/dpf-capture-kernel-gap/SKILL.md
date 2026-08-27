---
name: dpf-capture-kernel-gap
description: "Use when the DPF kernel cannot answer a decision because principles, ownership, evidence, or domain context are missing."
disable-model-invocation: false
user-invocable: true
allowed-tools: mcp__dpf__save_build_notes mcp__dpf__create_backlog_item
category: governance
assignTo: ["ea-architect", "platform-engineer", "coo", "ops-coordinator", "external-coding-agent"]
capability: null
taskType: deliberation
triggerPattern: "kernel gap|WWMD cannot answer|principle gap|evidence gap|founder review|volunteers dilemma"
userInvocable: true
agentInvocable: true
allowedTools: ["mcp__dpf__save_build_notes", "mcp__dpf__create_backlog_item"]
composesFrom: ["dpf-decision-via-kernel"]
contextRequirements: ["DPF MCP write tools reachable or explicit scope escalation path"]
riskBand: medium
enforces:
  - kernel/principles/architecture-over-shortcuts
  - kernel/principles/single-source-of-truth
---

# DPF Capture Kernel Gap

Capture the cases WWMD cannot reliably answer so the founder kernel improves over time.

## When to use

- The decision result is low confidence, tied, or blocked by missing evidence.
- The kernel lacks a principle for a repeated judgment pattern.
- The decision is a real volunteers dilemma or ownership ambiguity.

## Enforces

- `kernel/principles/architecture-over-shortcuts`
- `kernel/principles/single-source-of-truth`

## Steps

1. Classify the unresolved reason: principle gap, evidence gap, domain gap, ownership gap, or volunteers dilemma.
2. Save a build note with the question, options, unresolved reason, and route or task context.
3. Create or link a backlog item only after checking for overlap in the owning epic.
4. Recommend the next action in human language, such as "Clarify founder principle" or "Request better evidence."
5. Return the founder-review context link when one exists.

## Guardrails

- Do not answer a decision just because the thread is blocked. Capturing the gap is a valid outcome.
- Do not bypass MCP scope with direct SQL writes.
- Do not invent a new principle in-place. Draft the clarification through the governed kernel workflow.

## Worked example

A Build Studio routing decision cannot determine whether the platform or a volunteer owner should resolve a shared environment conflict. This skill records it as a volunteers dilemma, links the affected build context, and sends the operator to founder review with "Choose the responsible volunteer path" as the action.
