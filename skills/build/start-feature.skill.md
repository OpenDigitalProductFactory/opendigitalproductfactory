---
name: start-feature
description: "Start a Build Studio feature brief when the user wants to create or improve product behavior; use this for early feature intake, not for page scaffolding or release work."
category: build
assignTo: ["build-specialist"]
capability: "view_platform"
taskType: "conversation"
triggerPattern: "start feature|new feature|build something|feature brief|start implementation|begin build"
userInvocable: true
agentInvocable: true
allowedTools: [update_feature_brief]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Start a New Feature

Create a concise, buildable feature brief for Build Studio. The brief should capture intent, scope, target surface, acceptance criteria, and verification expectations without pretending the implementation has already started.

Do not use this for page scaffolding; use `build-page` instead. Do not use this for release packaging; use `ship-feature` instead.

## Read First

| Source | Path | What to extract |
| --- | --- | --- |
| Route context | PAGE DATA | Current page, active build state, feature brief, and visible workflow state |
| Existing docs | docs/superpowers/specs and docs/superpowers/plans | Whether an approved design or plan already exists |
| Backlog context | live backlog tools when available | Related epics, open items, and overlap with existing work |
| UI rules | AGENTS.md and docs/platform-usability-standards.md | DPF verification, theme-token, and UI quality expectations |

## Steps

1. Read PAGE DATA and identify the current product surface, route, or build context.
2. Ask one clarifying question only if the user's feature intent is not buildable yet.
3. Check whether the request overlaps an existing spec, plan, or backlog item before drafting new scope.
4. Draft a feature brief with problem, users, scope, non-goals, acceptance criteria, and verification path.
5. Use `update_feature_brief` only after the user approves the brief or clearly asks you to save it.
6. Return the next smallest Build Studio action: ideate, plan, build, test, or ship.

## Output Template

- Feature: `<short title>`
- Problem: `<what needs to change and why>`
- Users: `<who benefits or operates it>`
- Scope: `<what is included>`
- Non-goals: `<what is intentionally outside this slice>`
- Acceptance criteria: `<3-5 checkable outcomes>`
- Verification: `<tests, build, and UX path>`
- Next step: `<one concrete Build Studio action>`

## Guidelines

- Keep the brief compact enough for the build pipeline to use directly.
- Preserve DPF architecture rules: live backlog over seed data, design tokens for UI work, and production build verification.
- If the feature is too broad, split it into the smallest useful slice and name the follow-up explicitly.
- If the request is actually a bug or release task, say so and route to the better skill.

## Example

Input: "Build a better setup checklist for finance."

Output: A feature brief for a finance setup checklist on `/finance/settings`, scoped to visible readiness steps, missing configuration warnings, and a UX verification path through the Docker-served app.
