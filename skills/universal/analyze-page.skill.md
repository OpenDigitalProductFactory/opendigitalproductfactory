---
name: analyze-page
description: "Analyze the current page from PAGE DATA and surface non-obvious operational insights, missing information, stale state, or next actions without calling tools."
category: universal
assignTo: ["*"]
capability: null
taskType: conversation
triggerPattern: "analyze page|insights|what's here|summarize page|what am I looking at|anything important"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Analyze This Page

Read the page context already available to the coworker and return the most useful insight. This is a lightweight read-only skill for orientation, not a license to call tools or restate visible UI.

Do not use this for UX/accessibility audits; use `evaluate-page` instead. Do not use this for creating records or acting on the page; use `do-primary-action` instead.

## Read First

| Source | Path | What to extract |
| --- | --- | --- |
| Page context | PAGE DATA | Route, page title, visible records, empty states, counts, errors, and workflow state |
| Conversation | recent user message | What the user is trying to understand right now |
| DPF conventions | AGENTS.md | Truthfulness, live-state preference, and concise communication rules |

## Steps

1. Read PAGE DATA and identify the page type: dashboard, form, list, detail, setup, or workflow.
2. Look for outliers, stale data, missing required fields, blockers, or unusually empty sections.
3. Ignore decorative layout details unless they obscure task completion.
4. Return 2-3 sentences with the most important insight first.
5. If nothing notable appears, say that clearly and mention one concrete positive observation.

## Output Template

`<Most important observation>. <Why it matters or what it implies>. <Optional next action if there is one>.`

## Guidelines

- Do not call tools.
- Do not list everything visible on the page.
- Reference actual names, counts, statuses, or dates when present.
- If PAGE DATA is missing, say that the analysis is limited by missing page context.

## Example

Input: "What am I looking at?"

Output: "Three high-priority backlog items are open and none are claimed, so this queue is ready for triage rather than implementation. The oldest item is the discovery constraint failure, which looks like the first operational blocker to resolve."
