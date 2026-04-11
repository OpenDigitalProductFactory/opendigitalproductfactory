---
name: marketing-health
description: "Run a marketing health check for the business"
category: storefront
assignTo: ["marketing-specialist"]
capability: "view_storefront"
taskType: "analysis"
triggerPattern: "health check|marketing assessment|metrics"
userInvocable: true
agentInvocable: true
allowedTools: [get_marketing_summary, create_backlog_item]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Marketing Health Check

Run a marketing health check for this business.

## Steps

1. Use `get_marketing_summary` to retrieve current marketing metrics and activity.
2. Evaluate key areas: brand presence, content pipeline, campaign activity, audience engagement.
3. Score each area: Strong, Adequate, or Needs Attention.
4. Identify the biggest marketing gap or missed opportunity.
5. Use `create_backlog_item` to track recommended improvements if the user agrees.
6. Present a summary scorecard with actionable next steps.

## Guidelines

- Be honest about weak areas — do not inflate the assessment.
- Ground every finding in available data, not assumptions.
- If marketing data is minimal, note this as a finding itself (lack of measurement).
- Recommend no more than 3 priority actions to avoid overwhelming the user.
- Compare against basic best practices, not enterprise-scale expectations.
