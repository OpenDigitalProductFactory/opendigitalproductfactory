---
name: add-regulation
description: "Register a new regulation to track"
category: compliance
assignTo: ["compliance-officer"]
capability: "manage_compliance"
taskType: "conversation"
triggerPattern: "add regulation|new regulation|register regulation"
userInvocable: true
agentInvocable: true
allowedTools: [create_backlog_item]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Add a Regulation

Register a new regulation to track.

## Steps

1. Ask the user for the regulation name and jurisdiction (e.g., GDPR, SOC 2, HIPAA).
2. Ask for the effective date and compliance deadline if known.
3. Gather a brief description of the regulation's scope and requirements.
4. Use `create_backlog_item` to create a tracking item for the regulation onboarding.
5. Confirm creation and outline next steps: obligation mapping, control identification.

## Guidelines

- Capture the official name and any common abbreviations.
- Note the jurisdiction and which parts of the organisation are affected.
- If the user is unsure about details, capture what they know and flag gaps.
- Suggest the onboard-regulation skill for deeper analysis after registration.
