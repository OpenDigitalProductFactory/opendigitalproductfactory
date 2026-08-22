---
name: manage-sandbox
description: "Check, start, and report on the Build Studio sandbox container when implementation or verification cannot proceed because the sandbox is stopped or missing."
category: build
assignTo: ["build-specialist"]
capability: "view_platform"
taskType: "action"
triggerPattern: "sandbox|container|not running|start sandbox|sandbox down|sandbox status"
userInvocable: true
agentInvocable: false
allowedTools: [check_sandbox, start_sandbox]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Manage Build Sandbox

Restore Build Studio sandbox readiness by checking the container state, starting it when supported, and reporting exactly what changed. This skill exists to remove an execution blocker, not to debug feature code.

Do not use this for build status summaries; use `check-status` instead. Do not use this for release deployment; use `ship-feature` instead.

## Read First

| Source | Path | What to extract |
| --- | --- | --- |
| Sandbox tool output | `check_sandbox` | Current container state and actionable error text |
| Build context | PAGE DATA | Active build, current phase, and whether sandbox is required now |
| Project runbook | AGENTS.md | Docker-served verification expectations and local QA rules |

## Steps

1. Run `check_sandbox` before taking any other action.
2. If the sandbox is running, report that it is ready and return the next build action.
3. If the sandbox is stopped, run `start_sandbox` and then confirm the new state.
4. If the sandbox is missing, explain the one-time setup requirement without pretending you created it.
5. If a tool fails, return the exact failure category and the next safe recovery action.

## Output Template

- Sandbox state: `<running, stopped, missing, failed>`
- Action taken: `<checked, started, or none>`
- Result: `<ready or blocked>`
- Next step: `<what Build Studio can do now>`

## Guidelines

- Never ask the user to run terminal commands for normal start or stop flows.
- The only terminal guidance allowed is the first-time missing-container setup.
- Do not mask failed starts as success; keep the blocker visible.
- Keep the response operational and short.

## Example

Input: "Sandbox is down."

Output: Check status, start it if stopped, confirm readiness, and say the build can continue. If missing, say the sandbox has not been created yet and name the one-time setup step.
