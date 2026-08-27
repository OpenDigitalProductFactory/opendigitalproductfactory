---
name: campaign-ideas
description: "Suggest marketing campaigns tailored to the business and save the chosen one as a brief"
category: storefront
assignTo: ["marketing-specialist"]
capability: "view_marketing"
taskType: "conversation"
triggerPattern: "campaign|marketing|promotion"
userInvocable: true
agentInvocable: true
allowedTools: [get_marketing_summary, suggest_campaign_ideas, create_marketing_campaign_brief, create_marketing_asset_task]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Campaign Ideas

Suggest campaigns tailored to this business, then turn the one they pick into a durable brief.

## Steps

1. Use `get_marketing_summary` to load business context and audience.
2. Use `suggest_campaign_ideas` to generate tailored concepts.
3. Present 3-5 campaigns, each with name, objective, audience, channel and effort estimate, ranked by expected impact against ease of execution.
4. When the user picks one — or says "yes", "ok" or "go" to a specific recommendation — use `create_marketing_campaign_brief` to save it with objective, audience, channels, CTA and the KPIs it will be judged on.
5. Use `create_marketing_asset_task` to create the first concrete asset the campaign needs, so the brief has a next step rather than sitting idle.
6. Report what was saved and what happens next.

## Guidelines

- Do not end on "which would you like to explore further?" and stop. That is a dead end the user has to restart. Offer the ideas, and when one is chosen, save it in the same conversation.
- Tailor campaigns to the archetype — a rescue runs adoption drives and donor appeals, not enterprise demand-gen. Reuse the archetype's own vocabulary.
- Mix quick wins with longer plays, and be specific about channel: email, social, content, paid, events.
- Estimate effort honestly: low (1-2 days), medium (a week), high (2+ weeks).
- Ground every suggestion in this business's context. If the strategy record is too thin to do that, say so and offer to fill it in rather than generating plausible filler.
- Creating a brief commits nobody to spending or publishing. Publication stays behind the approval queue, and it is worth saying so if the user hesitates.
