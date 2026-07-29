---
name: outcome-review
description: "Review whether a funded product bet changed its intended outcome and append evidence-backed learning"
category: product-management
assignTo: ["portfolio-advisor"]
capability: "view_portfolio"
taskType: "analysis"
triggerPattern: "outcome review|did the bet work|record learning"
userInvocable: true
agentInvocable: true
allowedTools: [search_portfolio_context, record_product_outcome_observation, review_product_objective, correct_product_outcome_observation]
composesFrom: []
contextRequirements: []
riskBand: high
---

# Outcome review

Review the canonical ProductObjective measure contract and its observations.

1. Verify measure kind, unit, baseline, target, observation time, source, and
   confidence are compatible.
2. Separate qualitative, baseline-missing, observation-missing, and
   incompatible evidence.
3. Preview observations, corrections, and review dates before proposing a
   write.
4. Append corrections; never overwrite prior learning.
5. Relate funded work only through explicit ProductObjectiveWork evidence.

Do not infer outcome movement from delivery completion or revenue alone.
