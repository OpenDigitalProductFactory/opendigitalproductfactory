---
name: stage-gate-check
description: "Evaluate whether a product meets the criteria to advance to the next stage"
category: inventory
assignTo: ["inventory-specialist"]
capability: "view_inventory"
taskType: "analysis"
triggerPattern: "stage.gate|ready|criteria"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Stage-Gate Readiness Check

Help me evaluate whether a product is ready to advance to the next stage.

## Steps

1. Identify the product from PAGE DATA or ask the user which product to evaluate.
2. Determine the current stage and the target next stage.
3. List all stage-gate criteria for the transition.
4. Evaluate each criterion: Met, Partially Met, or Not Met.
5. Provide an overall readiness assessment (Ready / Not Ready / Conditional).
6. For unmet criteria, suggest specific actions to close the gap.

## Guidelines

- Present criteria in a checklist format for easy scanning.
- Be honest about gaps — do not soften "Not Met" into "Almost Ready."
- If criteria definitions are not available in the data, state the standard IT4IT stage-gate expectations.
- End with a clear recommendation: advance, wait, or escalate.
