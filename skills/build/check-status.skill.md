---
name: check-status
description: "Check the status of the current build"
category: build
assignTo: ["build-specialist"]
capability: "view_platform"
taskType: "conversation"
triggerPattern: "status|progress|current build"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Check Build Status

What's the status of my current build?

## Steps

1. Check PAGE DATA for the current build context (feature brief, pipeline state).
2. Identify which phase the build is in: ideate, plan, build, test, ship.
3. Summarise what has been completed and what remains.
4. Flag any blockers or failed steps.
5. Estimate what the next action should be.

## Guidelines

- Be specific about which phase and step the build is on.
- If the build is stalled, explain why and suggest how to unblock.
- If no build is in progress, say so and offer to start one.
- Show timestamps for phase transitions if available.
