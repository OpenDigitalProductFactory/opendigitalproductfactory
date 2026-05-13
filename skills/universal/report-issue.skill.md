---
name: report-issue
description: "Collect a concise bug, usability, or feedback report from the current page and create a trackable backlog item without making the user repeat known context."
category: universal
assignTo: ["*"]
capability: null
taskType: action
triggerPattern: "report issue|bug report|feedback|broken|problem|not working|wrong|file issue"
userInvocable: true
agentInvocable: false
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Report an Issue

Turn a user's bug report or feedback into a useful backlog item. The skill should capture enough context for another coworker or developer to act without forcing the user through a long support form.

Do not use this for broad UX audits; use `evaluate-page` instead. Do not use this for feature intake when there is no defect or feedback; use `start-feature` or the route-specific skill instead.

## Read First

| Source | Path | What to extract |
| --- | --- | --- |
| User message | current conversation | The user's own words about what is broken or confusing |
| Page context | PAGE DATA | Route, page title, visible errors, empty states, and relevant record IDs |
| Backlog rules | AGENTS.md | Canonical type/status values and live backlog expectations |

## Steps

1. Read the user's report and PAGE DATA before asking anything.
2. Ask one clarifying question only if the report is too ambiguous to title.
3. Classify the report as bug, UX feedback, feature request, or data issue.
4. Create one backlog item with type `product`, status `open`, and a title in the user's language.
5. Include route, visible state, expected behavior, actual behavior, and any known reproduction detail.
6. Confirm the created item title and what will happen next.

## Output Template

- Issue type: `<bug, UX feedback, feature request, data issue>`
- Backlog item: `<title>`
- Context captured: `<route and key visible state>`
- Next: `<triage or build follow-up>`

## Guidelines

- Do not ask the user for screenshots, console logs, or reproduction steps they have not already offered.
- Do not over-interview; keep the exchange to one follow-up at most.
- Preserve the user's wording in the title when it is specific.
- If the backlog tool is unavailable, say the issue is not recorded yet and provide the exact draft.

## Example

Input: "This button does nothing on finance setup."

Output: Create `Finance setup button does nothing` with the current route, visible setup state, expected navigation, and actual no-op behavior, then confirm the item was recorded.
