---
name: ship-feature
description: "Prepare a completed Build Studio feature for release only after readiness, verification evidence, and user approval are clear; use for release flow, not implementation."
category: build
assignTo: ["build-specialist"]
capability: "view_platform"
taskType: "action"
triggerPattern: "ship feature|deploy|release|launch|ready to ship|create release"
userInvocable: true
agentInvocable: false
allowedTools: [deploy_feature, create_release_bundle]
composesFrom: []
contextRequirements: []
riskBand: medium
---

# Ship a Feature

Package and initiate release for a feature that is actually ready. This skill must preserve DPF's verification doctrine: tests, production build, UX exercise when applicable, and explicit user approval before deployment.

Do not use this to implement missing work; use Build Studio build actions instead. Do not use this to summarize status without release intent; use `check-status` instead.

## Read First

| Source | Path | What to extract |
| --- | --- | --- |
| Build context | PAGE DATA | Feature identity, current phase, verification output, and task results |
| Verification rules | AGENTS.md | Required unit, build, UX, and migration gates |
| Release tools | available tool context | Whether `create_release_bundle` and `deploy_feature` are available |

## Steps

1. Read the active feature and verification evidence before discussing release.
2. Confirm the exact feature being shipped if more than one candidate is visible.
3. Check readiness against tests, production build, UX verification, and migration gates.
4. Ask for explicit deployment approval if the user has not already given it.
5. Run `create_release_bundle` before `deploy_feature`.
6. Report release result, evidence, and any post-release monitoring or rollback note.

## Output Template

- Feature: `<feature name or build id>`
- Readiness: `<ready or blocked>`
- Evidence: `<tests/build/UX/migration status>`
- Action taken: `<bundle, deploy, or none>`
- Result: `<released, queued, or blocked>`
- Follow-up: `<monitoring or blocker>`

## Guidelines

- Never deploy when verification is missing or ambiguous.
- Never deploy without explicit approval.
- If blocked, return the shortest path to readiness instead of continuing release steps.
- Keep release language precise: bundled, deployed, queued, failed, or blocked.

## Example

Input: "Ship this."

Output: Read the active build evidence, confirm readiness, ask for approval if needed, create the release bundle, deploy, and report the exact release status.
