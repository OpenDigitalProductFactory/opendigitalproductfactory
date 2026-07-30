---
name: weekly-intelligence
description: "Review cited market, competitor, customer, and delivery changes for one explicit business-product scope"
category: product-management
assignTo: ["portfolio-advisor"]
capability: "view_portfolio"
taskType: "analysis"
triggerPattern: "weekly intelligence|what changed|product intelligence"
userInvocable: true
agentInvocable: true
allowedTools: [search_portfolio_context, propose_product_research, get_battlecards, search_knowledge_base]
composesFrom: []
contextRequirements: []
riskBand: medium
---

# Weekly intelligence review

Use the typed Product Operating Context supplied by the route or scheduled
playbook. Keep its organization, ProductLine, or Product scope unchanged.

1. Compare source IDs and `asOf` values with the last successful review.
2. Separate corroborated changes, contradictions, stale evidence, and missing
   evidence.
3. Cite every conclusion with a canonical source ID.
4. Propose follow-up research only through `propose_product_research`; do not
   execute or publish it as if approved.
5. End with decisions needed and the smallest next evidence action.

If evidence is partial, say so. Never invent competitors, customers, consumers,
teams, or market movement.
