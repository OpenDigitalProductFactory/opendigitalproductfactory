---
name: dpf-external-evidence-handoff
description: "Use when an external contributor needs to hand branch, file, test, and evidence context back to Build Studio."
disable-model-invocation: false
user-invocable: true
allowed-tools: mcp__dpf__record_execution_evidence mcp__dpf__save_build_notes
category: build
assignTo: ["build-specialist", "platform-engineer"]
capability: null
taskType: evidence
triggerPattern: "external evidence handoff|handoff to Build Studio|record external work|Codex evidence|Claude evidence"
userInvocable: true
agentInvocable: true
allowedTools: ["mcp__dpf__record_execution_evidence", "mcp__dpf__save_build_notes"]
composesFrom: ["dpf-evidence-before-diagnosis"]
contextRequirements: ["Branch or artifact context available; DPF MCP write tools reachable"]
riskBand: medium
enforces:
  - kernel/principles/never-fabricate
  - kernel/principles/build-gate-mandatory
---

# DPF External Evidence Handoff

Record work done outside Build Studio so the platform can continue from current evidence instead of chat memory.

## When to use

- Claude or Codex changed files, ran tests, or found a blocker outside the portal.
- Build Studio needs branch, commit, file, test, or unresolved-question context without manual copy-paste.
- A reviewer needs to compare external evidence with Build Studio's own timeline.

## Enforces

- `kernel/principles/never-fabricate`
- `kernel/principles/build-gate-mandatory`

## Steps

1. Capture branch, commit or pushed-ref state, touched files, verification commands, command outcomes, and unresolved questions.
2. Record execution evidence with source set to the external contributor.
3. Save a short Build Studio note with the next action and recovery path.
4. Include links to build, task run, PR, or branch when available.
5. Return the evidence record identifier and the next action label.

## Guardrails

- Do not mark work merge-ready without the relevant build gate evidence.
- Do not paste raw terminal noise into the default timeline. Summarize results and keep detailed logs in audit fields.
- Do not lose unresolved questions. If a question remains, route it to the decision or founder-review flow.
---
- Do not record worktree-local command outcomes as runtime verification evidence. Runtime-bound checks must be executed against the canonical local install or the shared convergence sandbox (`claim_nonprod_environment_lease(environmentKey="local-integration-ci")`); see `kernel/principles/worktree-is-source-control-not-runtime` and AGENTS.md §5.
---

## Worked example

Codex completes a skill-pack slice, runs seed tests, and pushes the branch. This skill records the branch name, changed skill files, passing test command, and "Run local integration gate" as the next action so Build Studio can resume without asking the user for IDs.
