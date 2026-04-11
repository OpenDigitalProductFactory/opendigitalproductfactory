---
name: epic-progress
description: "Status report on current epics and their progress"
category: ops
assignTo: ["ops-coordinator"]
capability: "view_operations"
taskType: "analysis"
triggerPattern: "epic|progress|status report"
userInvocable: true
agentInvocable: true
allowedTools: [query_backlog]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Epic Progress Report

Give me a status report on the current epics.

## Steps

1. Use `query_backlog` to retrieve all epics and their items.
2. For each epic, calculate: total items, open, in-progress, done, deferred.
3. Compute a completion percentage for each epic.
4. Flag epics that are stalled (no items moved in recent activity).
5. Present a summary table: Epic Name | Status | Progress | Items | Flagged Issues.
6. Highlight the top priorities and any blockers.

## Guidelines

- Use canonical epic statuses: `"open"`, `"in-progress"`, `"done"`.
- Sort epics by priority or completion percentage, not alphabetically.
- Keep the report scannable — table format preferred.
- If an epic has zero items, flag it as potentially abandoned or not yet planned.
- End with a recommendation on where to focus effort next.
