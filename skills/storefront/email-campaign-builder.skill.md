---
name: email-campaign-builder
description: "Draft a complete email and put it in the approval queue ready to send"
category: storefront
assignTo: ["marketing-specialist"]
capability: "view_marketing"
taskType: "conversation"
triggerPattern: "email|newsletter|send|subject line|campaign email"
userInvocable: true
agentInvocable: false
allowedTools: [get_marketing_summary, create_marketing_asset_task, draft_marketing_asset]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Email Campaign Builder

Draft a complete email for this business and leave it in the approval queue, reviewable and ready to send.

## Steps

1. Use `get_marketing_summary` to load business context, playbook and recent activity.
2. Ask what the email is for, offering archetype-appropriate options (promotion, reminder, announcement, follow-up, seasonal, welcome). Ask who it is for using the archetype's stakeholder language from PAGE DATA — "donors", "adopters", "patients", never "customers".
3. Draft the email: 3 subject line variants (short, curiosity, direct), pre-header, body with greeting and CTA, and a plain-text fallback.
4. Use `create_marketing_asset_task` to record the asset, then `draft_marketing_asset` to turn it into a reviewable draft. The draft lands on the marketing approval queue at `pending-review`.
5. Tell the user it is waiting for their approval and where to find it. Say plainly that nothing has been sent.

## Guidelines

- Finish in the approval queue, not in the chat. A drafted email the user has to copy out by hand is not a delivered email.
- Never send. `draft_marketing_asset` makes no external call; publishing is a separate approved step and this skill must not attempt it.
- Use the archetype's contentTone and ctaLanguage from the marketing playbook.
- Keep it short. Small-organization audiences read short, clear messages, and a rescue's supporters are reading on a phone.
- One clear CTA, in the archetype's CTA vocabulary.
- For sequences, outline the full structure but draft one email at a time so each gets reviewed on its own.
- Never include unsubscribe or legal boilerplate — that belongs to the email platform.
- If drafting is refused for permissions, say so and hand the user the full email text.
