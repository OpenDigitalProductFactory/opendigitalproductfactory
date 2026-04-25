---
name: campaign-ideas
description: "Suggest marketing campaigns tailored to the business type"
category: storefront
assignTo: ["marketing-specialist"]
capability: "view_marketing"
taskType: "conversation"
triggerPattern: "campaign|marketing|promotion"
userInvocable: true
agentInvocable: true
allowedTools: [suggest_campaign_ideas, get_marketing_summary]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Campaign Ideas

Suggest 3-5 marketing campaigns tailored to our business type.

## Steps

1. Use `get_marketing_summary` to understand the current business context and audience.
2. Use `suggest_campaign_ideas` to generate tailored campaign concepts.
3. Present 3-5 campaign ideas, each with: name, objective, target audience, channel, estimated effort.
4. Rank campaigns by expected impact and ease of execution.
5. Ask the user which campaigns they want to explore further.

## Guidelines

- Tailor campaigns to the business archetype — B2B vs B2C, product vs service.
- Include a mix of quick wins and longer-term strategies.
- Be specific about channels: email, social, content, paid, events.
- Estimate effort level: low (1-2 days), medium (1 week), high (2+ weeks).
- Avoid generic advice — every suggestion should reference the user's specific business context.
