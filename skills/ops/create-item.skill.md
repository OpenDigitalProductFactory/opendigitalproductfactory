---
name: create-item
description: "Help create a new backlog item"
category: ops
assignTo: ["ops-coordinator"]
capability: "manage_backlog"
taskType: "conversation"
triggerPattern: "create|new|add item|task"
userInvocable: true
agentInvocable: true
allowedTools: [create_backlog_item]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Create a Backlog Item

Help me create a new backlog item.

## Steps

1. Ask the user what the item is about — title and description.
2. Determine the type: `"portfolio"` or `"product"`. Ask if unclear.
3. Ask for priority and which epic it belongs to (if any).
4. Set status to `"open"` by default.
5. Use `create_backlog_item` to create the item.
6. Confirm creation and show the item details.

## Guidelines

- Use only canonical status values: `"open"`, `"in-progress"`, `"done"`, `"deferred"`.
- Use only canonical type values: `"portfolio"`, `"product"`.
- Never invent non-canonical values like `"task"`, `"story"`, or `"todo"`.
- If the user provides enough detail in one message, confirm and create without extra questions.
- Always show the created item's title, type, status, and epic assignment.
