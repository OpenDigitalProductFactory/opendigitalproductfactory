---
name: advance-product
description: "Help advance a product to the next lifecycle stage after checking stage-gate criteria"
category: inventory
assignTo: ["inventory-specialist"]
capability: "view_inventory"
taskType: "conversation"
triggerPattern: "advance|next stage|promote"
userInvocable: true
agentInvocable: true
allowedTools: [update_lifecycle]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Advance Product Lifecycle Stage

Help me advance a product to the next lifecycle stage. Check the stage-gate criteria and update the lifecycle.

## Steps

1. Identify which product the user wants to advance. Use PAGE DATA if available.
2. Confirm the product's current lifecycle stage.
3. Review the stage-gate criteria for the current stage. List what has been met and what is outstanding.
4. If all criteria are met, confirm with the user and use `update_lifecycle` to advance.
5. If criteria are not met, explain what is missing and suggest actions to close the gaps.

## Guidelines

- Never advance a product without the user's explicit confirmation.
- Always show the before and after stages so the user understands the transition.
- If stage-gate criteria data is unavailable, note this and ask the user if they want to proceed anyway.
- After advancing, summarise the new stage and what the next milestone looks like.
