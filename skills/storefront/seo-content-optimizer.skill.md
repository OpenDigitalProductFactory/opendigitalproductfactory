---
name: seo-content-optimizer
description: "Help the business get found online and turn topic gaps into tracked content tasks"
category: storefront
assignTo: ["marketing-specialist"]
capability: "view_marketing"
taskType: "analysis"
triggerPattern: "seo|search|found online|content topics|what to write"
userInvocable: true
agentInvocable: true
allowedTools: [analyze_seo_opportunity, get_marketing_summary, create_marketing_asset_task]
composesFrom: []
contextRequirements: []
riskBand: low
---

# SEO Content Optimizer

Find what this business should be findable for, and turn the gaps into content someone can write.

## Steps

1. Use `get_marketing_summary` for business context and `analyze_seo_opportunity` for topic and structure guidance.
2. Identify the topics this organization should rank for, in the words its audience would actually search.
3. Compare against what already exists. Name the gaps.
4. For each worthwhile gap, use `create_marketing_asset_task` to create the content task, with the target topic and intended structure in the brief.
5. Report the gaps found and the tasks created, ordered by what would matter soonest.

## Guidelines

- Finish with tasks, not a topic list. A list of topics is the same work left undone with extra steps.
- Search intent over keyword volume. "Dogs available for adoption near me" beats a high-volume term the organization can never rank for.
- Prefer topics where this organization has genuine authority. A rescue can own local adoption and pet-care content; it cannot own generic pet retail.
- Structure guidance is part of the brief: the heading shape, the question it answers, what a reader should be able to do afterwards.
- Do not promise rankings or invent traffic numbers. Say what the change is meant to achieve and what would show whether it worked.
- If creating a task is refused for permissions, present the gap list in priority order.
