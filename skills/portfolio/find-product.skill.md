---
name: find-product
description: "Help the user find a specific digital product in the portfolio"
category: portfolio
assignTo: ["portfolio-advisor"]
capability: "view_portfolio"
taskType: "conversation"
triggerPattern: "find|search|locate product"
userInvocable: true
agentInvocable: true
allowedTools: [search_portfolio_context]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Find a Product

Help me find a specific digital product in the portfolio.

## Steps

1. Ask what the user is looking for — product name, keyword, or characteristic.
2. Use `search_portfolio_context` to search across available products.
3. Present matching results with name, portfolio, lifecycle stage, and status.
4. If multiple matches, help the user narrow down.
5. If no matches, suggest alternative search terms or confirm spelling.

## Guidelines

- Be tolerant of partial names and typos — search broadly first.
- Show results in a concise list format, not verbose paragraphs.
- If the user seems unsure what exists, offer to list all products in the portfolio.
- Always include the lifecycle stage so the user has context on where the product stands.
