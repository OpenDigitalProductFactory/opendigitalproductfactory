---
name: review-inbox
description: "Review recent inbox activity for demand signals and marketing opportunities"
category: storefront
assignTo: ["marketing-specialist"]
capability: "view_marketing"
taskType: "analysis"
triggerPattern: "inbox|questions|requests|demand signals|faq"
userInvocable: true
agentInvocable: true
allowedTools: [get_marketing_summary]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Review Inbox

Review recent inbound activity for recurring themes, objections, and campaign opportunities.

## Steps

1. Use `get_marketing_summary` to load the recent storefront and CRM context available to the marketing specialist.
2. Look for repeated questions, objections, popular offers, quiet periods, and signs of demand concentration.
3. Summarize what the inbox suggests about the market right now.
4. Recommend follow-up opportunities such as FAQ content, offer clarification, campaign angles, or funnel fixes.
5. Keep the output focused on the next few useful actions rather than a long report.

## Guidelines

- Treat inbox activity as evidence, not certainty.
- Call out when patterns are weak or based on limited recent activity.
- Prioritize opportunities that reduce repeated manual explanation.
- Prefer practical follow-up ideas over generic marketing theory.
