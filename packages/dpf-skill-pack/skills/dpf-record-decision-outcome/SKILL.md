---
name: dpf-record-decision-outcome
description: "Use in the DPF codebase after a WWMD/kernel decision is made. Records the decision result, evidence summary, and next action through governed MCP tools so Build Studio and reviewers share one source of truth."
disable-model-invocation: false
user-invocable: true
allowed-tools: mcp__dpf__save_build_notes mcp__dpf__record_execution_evidence
category: governance
assignTo: ["*"]
capability: null
taskType: evidence
triggerPattern: "record decision|save decision outcome|decision evidence|capture recommendation|record WWMD"
userInvocable: true
agentInvocable: true
allowedTools: ["mcp__dpf__save_build_notes", "mcp__dpf__record_execution_evidence"]
composesFrom: ["dpf-decision-via-kernel"]
contextRequirements: ["DPF MCP write tools reachable; decision result available"]
riskBand: medium
enforces:
  - kernel/principles/evidence-before-diagnosis
  - kernel/principles/single-source-of-truth
---

# DPF Record Decision Outcome

Persist a decision result once WWMD or founder review has produced an answer.

## When to use

- Build Studio needs to carry a recommendation from one route, phase, or task to another.
- Claude or Codex made a governed decision outside the portal and needs to hand it back.
- A reviewer needs to see what was decided, why, and what action follows.

## Enforces

- `kernel/principles/evidence-before-diagnosis`
- `kernel/principles/single-source-of-truth`

## Steps

1. Collect the decision question, selected option, confidence, reason summary, and next action label.
2. Record execution evidence with links to the build, task run, branch, or PR when available.
3. Save a concise build note that can be shown in the Build Studio timeline.
4. Put raw tool details in audit fields only. Keep the default summary operator-readable.
5. Return the persisted evidence identifier and the recommended next action.

## Guardrails

- Do not write directly to the database if MCP reports insufficient scope. Stop and request the correct token scope.
- Do not create duplicate notes for the same decision. Prefer updating or linking existing evidence when the tool supports it.
- Do not make the operator copy IDs between surfaces; include the context links in the persisted payload.

## Worked example

After WWMD selects the shared nonproduction environment, this skill records the recommendation, confidence, route context, current branch, and next action. The Build Studio phase view can then show "Recommended next action: use the shared environment" while the audit panel keeps the detailed ledger.
