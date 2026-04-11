---
name: lifecycle-review
description: "Review products by lifecycle stage and identify which need attention"
category: inventory
assignTo: ["inventory-specialist"]
capability: "view_inventory"
taskType: "analysis"
triggerPattern: "lifecycle|stage|review products"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Lifecycle Review

Which products need attention based on their lifecycle stage?

## Steps

1. Use the PAGE DATA to gather all products and their current lifecycle stages.
2. Group products by stage: Concept, Development, Live, Retire, etc.
3. Identify products that need attention:
   - Stuck in a stage longer than expected
   - Missing required metadata or ownership
   - Approaching end-of-life without a retirement plan
4. Present a stage-by-stage summary with counts and flagged items.
5. Recommend priority actions for the most critical items.

## Guidelines

- Use a table or structured list for clarity.
- Always explain why a product is flagged, not just that it is.
- If no products need attention, say so — do not invent concerns.
- Suggest concrete next steps for each flagged product.
