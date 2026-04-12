---
name: seo-content-optimizer
description: "Help the business get found online with topic and content structure guidance"
category: storefront
assignTo: ["marketing-specialist"]
capability: "view_storefront"
taskType: "analysis"
triggerPattern: "seo|search|found online|content topics|what to write"
userInvocable: true
agentInvocable: true
allowedTools: [analyze_seo_opportunity, get_marketing_summary]
composesFrom: []
contextRequirements: []
riskBand: low
---

# SEO Content Optimizer

Suggest 3-5 content topics to help this business get found online.

## Steps

1. Use `analyze_seo_opportunity` to fetch business context: archetype, services/products, location, existing content.
2. Identify 3-5 topic opportunities based on what the business offers and what local customers search for.
3. For each topic, provide: suggested title, target search intent (informational/transactional/local), key points to cover, recommended content format (blog post, FAQ page, service page).
4. Rank by estimated impact and effort.
5. Ask the user which topics they want to pursue. Offer to create a backlog item for the chosen topic.

## Guidelines

- Frame as "what to write about" not "keyword density" -- no SEO jargon.
- Ground every suggestion in the business's actual services/products from PAGE DATA.
- Prioritize local search intent for brick-and-mortar archetypes.
- Include practical structure advice: headings, FAQ sections, location mentions.
- Avoid generic advice -- every suggestion should reference the user's specific business context.
