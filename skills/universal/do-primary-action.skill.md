---
name: do-primary-action
description: "Infer and perform the safest primary action for the current page when the user says to handle it, while asking first for destructive or materially ambiguous actions."
category: universal
assignTo: ["*"]
capability: null
taskType: action
triggerPattern: "do it|do this|just do it|primary action|handle this|take action"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: medium
---

# Do This For Me

Identify the current page's likely primary action and carry it out when the action is safe, supported, and sufficiently clear. This skill should feel helpful, but it must not guess through destructive changes or pretend unsupported tools exist.

Do not use this for read-only insight; use `analyze-page` instead. Do not use this for UX/accessibility review; use `evaluate-page` instead.

## Read First

| Source | Path | What to extract |
| --- | --- | --- |
| Page context | PAGE DATA | Route, visible form/list/detail state, available actions, and missing fields |
| Tool context | available tools | Whether the needed create/update/navigate tool is actually available |
| Project rules | AGENTS.md | Canonical enum values, confirmation rules, and live-state expectations |

## Steps

1. Read PAGE DATA and classify the page as form, list, dashboard, detail, settings, or workflow.
2. Identify the single safest primary action a human operator would expect on that page.
3. Check whether the required tool is available and permitted.
4. Ask one short question if the action is destructive, permission-changing, or outcome-changing ambiguity exists.
5. Execute the action only when it is supported; otherwise create or suggest the smallest trackable follow-up.
6. Report what changed and what remains.

## Output Template

- Action: `<what you did or why you paused>`
- Record: `<created or updated item, if any>`
- Evidence: `<page data or tool result used>`
- Next: `<one follow-up, or none>`

## Guidelines

- Prefer one well-formed action over multiple vague changes.
- Use DPF canonical values such as `open`, `in-progress`, `done`, and `deferred` when creating backlog work.
- Never delete, reset, clear, or change permissions without explicit confirmation.
- If the right tool is missing, do not improvise with unsupported claims; explain the blocker and track it.

## Example

Input: "Do this" on a sparse backlog page.

Output: Create one backlog item with a specific title, type `product`, status `open`, and context from the page, then report the new item and next triage step.
