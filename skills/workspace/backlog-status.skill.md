---
name: backlog-status
description: "Current backlog status — open epics, completed work, and priorities"
category: workspace
assignTo: ["coo-orchestrator"]
capability: "view_platform"
taskType: "analysis"
triggerPattern: "backlog|status|epic|priority"
userInvocable: true
agentInvocable: true
allowedTools: [query_backlog]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Backlog Status

Give me the current backlog status — open epics, what's done, what's next.

## Steps

1. Use `query_backlog` to retrieve all epics and backlog items.
2. Summarise by status: open, in-progress, done, deferred.
3. List open epics with their item counts and completion percentages.
4. Highlight what was recently completed.
5. Identify the next priority items based on epic order and item status.

## Guidelines

- Use canonical statuses only: epics (`"open"`, `"in-progress"`, `"done"`), items (`"open"`, `"in-progress"`, `"done"`, `"deferred"`).
- Present in a scannable format: table or structured list.
- Show completion percentages to give a sense of progress.
- If the backlog is empty, note this and suggest creating initial items.
- End with a clear "what's next" recommendation.
