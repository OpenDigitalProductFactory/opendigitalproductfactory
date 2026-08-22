---
name: product-line-performance-review
description: "Roll real Product evidence into a ProductLine review without changing the canonical reporting boundary"
category: product-management
assignTo: ["portfolio-advisor"]
capability: "view_portfolio"
taskType: "analysis"
triggerPattern: "product line performance|portfolio mix|line review"
userInvocable: true
agentInvocable: false
allowedTools: [search_portfolio_context, query_backlog, evaluate_org_business_decision]
composesFrom: []
contextRequirements: []
riskBand: medium
---

# Product-line performance review

Review each canonical business Product in the selected ProductLine, then roll
the evidence up without changing Product ownership or attribution.

1. Compare commercial, consumption, demand, outcome, and freshness posture only
   where the records are comparable.
2. Keep bundle allocations non-additive and missing currencies separate.
3. Name Products with missing evidence instead of ranking them with assumed
   zeros.
4. Route strategic advice through `evaluate_org_business_decision`.
5. Present the owner-level focus first; disclose the professional scorecard and
   provenance after it.

Do not create business units, teams, consumers, or subscribers to complete the
view.
