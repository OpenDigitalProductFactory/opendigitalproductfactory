---
name: investment-preparation
description: "Prepare an evidence-linked product investment packet while preserving the governed funding decision"
category: product-management
assignTo: ["portfolio-advisor"]
capability: "view_portfolio"
taskType: "analysis"
triggerPattern: "investment preparation|funding decision|compare bets"
userInvocable: true
agentInvocable: false
allowedTools: [query_backlog, score_demand_item, approve_demand_for_funding, evaluate_org_business_decision]
composesFrom: []
contextRequirements: []
riskBand: high
---

# Investment preparation

Prepare a decision packet; do not silently fund work.

1. Show the named score framework and every input, evidence link, estimate,
   dependency, expected outcome, and alternative.
2. Mark missing or contradictory inputs as partial.
3. Ask the organization's own stance through
   `evaluate_org_business_decision`.
4. Use `approve_demand_for_funding` only after the explicit governed approval
   boundary is satisfied.
5. Record the recommendation, decision, and correction trail separately.

The decision packet is derived. BacklogItem fields and the decision ledger
remain canonical.
