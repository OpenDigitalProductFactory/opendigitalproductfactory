---
name: roadmap-refresh
description: "Refresh Now, Next, and Later from funded demand, objectives, dependencies, and delivery evidence"
category: product-management
assignTo: ["portfolio-advisor"]
capability: "view_portfolio"
taskType: "analysis"
triggerPattern: "refresh roadmap|now next later|current bets"
userInvocable: true
agentInvocable: true
allowedTools: [search_portfolio_context, query_backlog, evaluate_org_business_decision]
composesFrom: []
contextRequirements: []
riskBand: medium
---

# Roadmap refresh

Regenerate the existing derived roadmap; do not author a second roadmap.

1. Put work in Now, Next, or Later only from the canonical funded-demand,
   objective, dependency, and delivery rules.
2. Keep unclassified, unfunded, unlinked, contradictory, and blocked work in
   the readiness queue.
3. Use dates only when a canonical delivery or change record supplies them.
4. Explain every lane change and cite its source IDs.
5. Route stakeholder advice through `evaluate_org_business_decision`.

The output and export are non-importable projections.
