---
name: add-customer
description: "Register a new customer account (CRM draft for operator confirmation)"
category: customer
assignTo: ["customer-advisor"]
capability: "view_customer"
taskType: "conversation"
triggerPattern: "add|register|new customer"
userInvocable: true
agentInvocable: false
allowedTools: [create_customer_account]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Add a New Customer

The user wants to register a new customer account. Gather the details, then use `create_customer_account` to draft the account — CRM writes land as a draft for an operator to confirm, not an instant live record.

## Steps

1. Ask the user for the customer details: name, contact info, account type.
2. Gather any additional context: industry, size, relationship type.
3. Use `create_customer_account` to draft the customer account with the captured details.
4. Confirm the draft was created and explain that an operator will review and confirm it.

## Guidelines

- Be upfront that this creates a draft for operator confirmation, not an instant live account.
- Capture as much detail as possible so the draft is complete and the reviewer has what they need.
- Do not promise a timeline for confirmation — that depends on the operator's review.
- This skill does not file backlog items; customer registration goes through the CRM, not the backlog.
