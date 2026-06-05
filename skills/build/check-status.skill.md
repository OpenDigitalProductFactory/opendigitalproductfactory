---
name: check-status
description: "Summarize the current Build Studio feature status from PAGE DATA, including phase, completed work, blockers, verification evidence, and the next smallest action."
category: build
assignTo: ["build-specialist"]
capability: "view_platform"
taskType: "conversation"
triggerPattern: "build status|progress|current build|where are we|what remains|is it blocked"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Check Build Status

Read the current Build Studio context and give the operator a factual status summary. The answer should separate verified state from inferred next steps.

Do not use this to start or restart sandbox infrastructure; use `manage-sandbox` instead. Do not use this to create a feature brief; use `start-feature` instead.

## Read First

| Source | Path | What to extract |
| --- | --- | --- |
| Build context | PAGE DATA | Feature brief, current phase, build execution state, task results, and verification output |
| Chat context | recent conversation | User's latest concern and any visible blocker |
| DPF rules | AGENTS.md | Required verification gates and Build Studio phase expectations |

## Steps

1. Read PAGE DATA for the active build and current phase.
2. Identify completed work, current phase, visible blockers, and pending verification.
3. Separate facts from inferences; label missing evidence as missing.
4. Return a short status with one next action and the owner of that action.
5. If no build is active, say so and offer the smallest valid start path.

## Output Template

- Current phase: `<ideate, plan, build, test, ship, none>`
- Completed: `<verified progress>`
- Blocked by: `<blocker or none visible>`
- Verification: `<tests/typecheck/build/UX evidence present or missing>`
- Next action: `<one step>`
- Owner: `<agent, Build Studio, operator/admin, reviewer, CI, or human decision-maker>`

## Guidelines

- Do not invent timestamps, build IDs, or test results.
- If the build is stalled, name the stop condition directly.
- Keep this read-only; no tools are needed unless the route context already provides data.
- Prefer a short operator status over a long retrospective.

## Example

Input: "Where are we on this build?"

Output: "Current phase: build. Completed: feature brief and plan exist. Blocked by: sandbox not running. Verification: no test output yet. Next action: restore sandbox readiness, then resume build execution. Owner: Build Studio sandbox manager."
