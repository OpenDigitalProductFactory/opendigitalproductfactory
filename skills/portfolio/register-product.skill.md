---
name: register-product
description: "Help the user register a new digital product in a portfolio"
category: portfolio
assignTo: ["portfolio-advisor"]
capability: "view_portfolio"
taskType: "conversation"
triggerPattern: "register|create|new product"
userInvocable: true
agentInvocable: true
allowedTools: [create_digital_product]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Register a New Digital Product

Help me register a new digital product. Ask me for the name and which portfolio it belongs to, then create it.

## Steps

1. Ask the user for the product name. Confirm spelling.
2. Ask which portfolio the product should belong to. If only one portfolio exists, suggest it as the default.
3. Optionally ask for a short description (one sentence) of the product's purpose.
4. Use `create_digital_product` to register the product.
5. Confirm success and show the product details.

## Guidelines

- Never create the product without the user confirming the name and portfolio.
- If the user provides all details in one message, confirm before creating.
- If creation fails, explain the error clearly and suggest next steps.
- After creation, remind the user they can add more details from the product page.
