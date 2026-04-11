---
name: create-task
description: "Create a new backlog task"
category: workspace
assignTo: ["coo"]
capability: "manage_backlog"
taskType: "conversation"
triggerPattern: "create|new task|add item"
userInvocable: true
agentInvocable: true
allowedTools: [create_backlog_item]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Create a Task

Create a new task.

## Steps

1. Ask the user what the task is about — title and description.
2. Determine the type: `"portfolio"` or `"product"`. Ask if unclear.
3. Ask for priority and which epic it belongs to (if any).
4. Set status to `"open"` by default.
5. Use `create_backlog_item` to create the task.
6. Confirm creation and show the item details.

## Guidelines

- Use only canonical status values: `"open"`, `"in-progress"`, `"done"`, `"deferred"`.
- Use only canonical type values: `"portfolio"`, `"product"`.
- Keep it quick — if the user gives enough detail upfront, confirm and create.
- Always show the created item summary after creation.
