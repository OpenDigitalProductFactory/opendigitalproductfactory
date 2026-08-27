---
name: content-brief
description: "Draft a content brief for a marketing piece and save it as a tracked asset task"
category: storefront
assignTo: ["marketing-specialist"]
capability: "view_marketing"
taskType: "conversation"
triggerPattern: "content|brief|blog|email|social"
userInvocable: true
agentInvocable: true
allowedTools: [get_marketing_summary, create_marketing_asset_task]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Content Brief

Draft a content brief for a marketing piece and leave it somewhere the work can actually be picked up.

## Steps

1. Use `get_marketing_summary` to load business context, audience and playbook. Do not open by asking the user things the summary already answers.
2. Ask only what the summary cannot tell you — usually the content type, the goal, and anything timely. Keep it to one round of questions.
3. Draft the brief: title/subject, audience, key points, tone, call to action, length, distribution channel.
4. Use `create_marketing_asset_task` to save it, putting the brief text in `brief` and a plain-language `dueWindow` when timing is known.
5. Tell the user what was saved and what happens next — the task is now schedulable and drafts from it land in the approval queue for review.

## Guidelines

- Finish with a saved task, not a question. A brief that exists only in the chat is lost when the thread closes.
- One round of questions, then produce. If an answer is missing, choose a sensible default, state the assumption in the brief, and let the user correct it.
- Match tone to the business archetype and use its stakeholder vocabulary — donors, adopters, patients, homeowners — never a generic "customers".
- Include a clear call to action in every brief, in the archetype's own CTA language.
- Keep the brief actionable enough that a writer could produce from it without coming back with questions.
- If saving is refused for permissions, say so plainly and give the user the full brief text so nothing is lost.
