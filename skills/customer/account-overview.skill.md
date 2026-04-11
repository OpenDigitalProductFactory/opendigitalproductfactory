---
name: account-overview
description: "Provide an overview of a customer account"
category: customer
assignTo: ["customer-advisor"]
capability: "view_customer"
taskType: "conversation"
triggerPattern: "overview|summary|account"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Customer Account Overview

Give me an overview of this customer account.

## Steps

1. Use PAGE DATA to identify the customer account in context.
2. Summarise key account details: name, type, status, creation date.
3. List associated products or subscriptions if available.
4. Note any recent activity or open issues.
5. Highlight anything that needs attention (overdue items, missing data).

## Guidelines

- Keep the overview concise — one screen of information.
- Use structured format: key-value pairs for details, bullet lists for activity.
- If data is sparse, note what information would be valuable to capture.
- Offer follow-up actions: "Would you like to see friction points?" or "Want to check their product usage?"
