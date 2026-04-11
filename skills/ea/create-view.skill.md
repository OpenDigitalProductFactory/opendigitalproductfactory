---
name: create-view
description: "Help the user create a new EA view with ArchiMate guidance"
category: ea
assignTo: ["ea-architect"]
capability: "manage_ea_model"
taskType: "conversation"
triggerPattern: "create view|new view|ea view"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Create an EA View

The user wants to create a new EA view. Agent tools for direct EA canvas manipulation are not yet available. Ask what view they want to create (name, layer, purpose), advise on the ArchiMate elements that belong in it, then create a backlog item to track the modelling work so it isn't lost.

## Steps

1. Ask the user what view they want to create: name, purpose, and target audience.
2. Determine the ArchiMate layer (Business, Application, Technology, or cross-layer).
3. Recommend which ArchiMate element types belong in this view (e.g., Business Process, Application Component, Node).
4. Suggest relationships that should be shown (composition, serving, flow, triggering).
5. Explain that direct canvas manipulation is not yet available as an agent action.
6. Offer to create a backlog item capturing the view specification so it can be built.

## Guidelines

- Use standard ArchiMate 3.2 terminology and element names.
- Keep recommendations practical — suggest 5-10 elements, not an exhaustive model.
- If the user is unfamiliar with ArchiMate, explain in plain language first.
- Always create a backlog item so the work is tracked.
