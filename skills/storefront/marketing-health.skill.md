---
name: marketing-health
description: "Run a marketing health check and save the scorecard as a durable review"
category: storefront
assignTo: ["marketing-specialist"]
capability: "view_marketing"
taskType: "analysis"
triggerPattern: "health check|marketing assessment|metrics"
userInvocable: true
agentInvocable: true
allowedTools: [get_marketing_summary, save_marketing_review, record_marketing_kpi_checkpoint, create_backlog_item]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Marketing Health Check

Assess marketing health and leave a scorecard the next check can be compared against.

## Steps

1. Use `get_marketing_summary` to retrieve current marketing metrics and activity.
2. Evaluate brand presence, content pipeline, campaign activity and audience engagement.
3. Score each area: Strong, Adequate, or Needs Attention.
4. Identify the single biggest gap or missed opportunity.
5. Use `save_marketing_review` to persist the scorecard and findings, so the next check measures movement instead of starting over.
6. Where a finding has a number worth tracking, use `record_marketing_kpi_checkpoint` to set what will be measured.
7. Offer to file the top improvements with `create_backlog_item`, and file them if the user agrees.

## Guidelines

- Save the review. A health check that leaves no record cannot show a trend, and a trend is most of the value.
- Be honest about weak areas. Do not inflate the assessment to be encouraging.
- Ground every finding in available data. If marketing data is minimal, that is itself the finding — record the absence of measurement rather than scoring around it.
- Recommend at most 3 priority actions. A list of twelve gets ignored.
- Compare against basic good practice for an organization this size, not enterprise expectations. A small rescue is not under-performing because it has no attribution model.
- If saving is refused for permissions, present the scorecard in full and say it was not recorded.
