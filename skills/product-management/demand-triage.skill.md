---
name: demand-triage
description: "Prepare classification, evidence gaps, and score inputs for product demand without crossing the funding boundary"
category: product-management
assignTo: ["portfolio-advisor"]
capability: "view_portfolio"
taskType: "analysis"
triggerPattern: "triage demand|sort requests|demand review"
userInvocable: true
agentInvocable: true
allowedTools: [query_backlog, score_demand_item, transition_demand_item, link_demand_evidence]
composesFrom: []
contextRequirements: []
riskBand: high
---

# Demand triage

Work only on BacklogItems in the supplied organization, ProductLine, or Product
scope.

1. Identify unclassified demand, missing direct evidence, incomplete score
   inputs, and conflicting estimates.
2. Explain each proposed classification or score component before proposing a
   canonical write.
3. Use `link_demand_evidence`, `score_demand_item`, or
   `transition_demand_item` only within the active approval boundary.
4. Keep partial scores out of the ready/funded state.
5. Preserve the BacklogItem and its activity trail as the authority.

Never treat frequency, a chat statement, or an aggregate score as a funding
decision.
