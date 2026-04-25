---
name: email-campaign-builder
description: "Draft complete, ready-to-send emails adapted to the business archetype"
category: storefront
assignTo: ["marketing-specialist"]
capability: "view_marketing"
taskType: "conversation"
triggerPattern: "email|newsletter|send|subject line|campaign email"
userInvocable: true
agentInvocable: true
allowedTools: [get_marketing_summary]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Email Campaign Builder

Draft a complete, ready-to-send email for this business.

## Steps

1. Use `get_marketing_summary` to load business context, playbook, and recent activity.
2. Ask the user what the email is for (choose from archetype-appropriate options: promotion, reminder, announcement, follow-up, seasonal, welcome sequence).
3. Ask who it is for (use archetype stakeholder language from PAGE DATA -- "homeowners", "patients", "donors", not "customers").
4. Generate a complete email draft including:
   - 3 subject line variants (short, curiosity, direct)
   - Pre-header text
   - Email body with greeting, content, and CTA
   - Plain-text fallback version
5. Ask if they want to adjust tone, length, or CTA before finalising.

## Guidelines

- Use the archetype's contentTone and ctaLanguage from the marketing playbook.
- Keep emails concise -- SMB audiences respond to short, clear messages.
- Always include one clear CTA, using the archetype's CTA vocabulary.
- For sequences (welcome, nurture), outline the full sequence structure but draft one email at a time.
- Never include unsubscribe/legal boilerplate -- that is the email platform's job.
