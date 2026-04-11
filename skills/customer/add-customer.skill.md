---
name: add-customer
description: "Register a new customer account via backlog item"
category: customer
assignTo: ["customer-advisor"]
capability: "view_customer"
taskType: "conversation"
triggerPattern: "add|register|new customer"
userInvocable: true
agentInvocable: true
allowedTools: [create_backlog_item]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Add a New Customer

The user wants to register a new customer account. Direct customer creation is not yet available as an agent action — explain this briefly, then ask what details they have and create a backlog item.

## Steps

1. Explain that direct customer account creation is not yet available as an agent tool.
2. Ask the user for the customer details: name, contact info, account type.
3. Gather any additional context: industry, size, relationship type.
4. Use `create_backlog_item` to create a task for the customer registration.
5. Confirm the backlog item was created and explain the next steps.

## Guidelines

- Be upfront that this will create a tracked task, not an instant account.
- Capture as much detail as possible so the person fulfilling the task has what they need.
- Suggest a priority level based on the user's urgency.
- Do not promise a timeline for account creation — that depends on the workflow.
