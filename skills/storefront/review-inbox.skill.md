---
name: review-inbox
description: "Review recent inbox activity for demand signals and turn recurring questions into content"
category: storefront
assignTo: ["marketing-specialist"]
capability: "view_marketing"
taskType: "analysis"
triggerPattern: "inbox|questions|requests|demand signals|faq"
userInvocable: true
agentInvocable: true
allowedTools: [get_marketing_summary, create_marketing_asset_task, create_backlog_item]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Review Inbox

Read recent inbound activity for demand signals, and turn what keeps coming up into work.

## Steps

1. Use `get_marketing_summary` to load recent inbound activity and marketing context.
2. Group what people are actually asking about. Note which questions repeat — repetition is the signal, not volume.
3. Identify demand signals: unmet needs, recurring objections, questions the public pages should already answer.
4. For each question asked more than once, use `create_marketing_asset_task` to create the content that would answer it — an FAQ entry, a page section, a post.
5. Where the gap is not content but a product or process problem, use `create_backlog_item` instead so it reaches the right place.
6. Report the signals found and the tasks created.

## Guidelines

- A recurring question is a content gap with evidence attached. Create the task rather than only reporting the pattern.
- Distinguish a content gap from a product gap. Writing an FAQ about a confusing process is a workaround, not a fix, and should be named as one.
- Quote the actual wording people use. Their phrasing is the search phrasing, and it belongs in the asset task brief.
- Use the archetype's stakeholder vocabulary throughout.
- Report honestly when there is too little inbound activity to draw conclusions from. Thin data is a finding, not something to pad.
- If creating a task is refused for permissions, list the gaps found so the user can act on them.
