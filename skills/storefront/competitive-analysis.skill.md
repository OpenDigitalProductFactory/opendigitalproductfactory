---
name: competitive-analysis
description: "Guided conversation to understand competitive position and find differentiation opportunities"
category: storefront
assignTo: ["marketing-specialist"]
capability: "view_storefront"
taskType: "analysis"
triggerPattern: "competitor|competition|differentiate|positioning|market position"
userInvocable: true
agentInvocable: true
allowedTools: [get_marketing_summary]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Competitive Analysis

Help the user understand their competitive position and identify differentiation opportunities.

## Steps

1. Use `get_marketing_summary` to understand the business type and offerings.
2. Ask the user to name 2-3 competitors (or describe the competitive landscape if unsure).
3. For each competitor, ask: What do they do well? What do your customers say they lack?
4. Synthesize a positioning summary:
   - Where the user's business overlaps with competitors
   - Where the user's business is differentiated
   - Gaps that represent opportunities
5. Recommend 2-3 concrete positioning actions (messaging changes, service gaps to fill, content to create).
6. Ask the user which actions they want to pursue. Offer to create backlog items for chosen actions.

## Guidelines

- This is a guided conversation, not a data-driven report -- the user provides the competitive intelligence, the specialist structures the analysis.
- Focus on actionable differentiation, not comprehensive market research.
- Use the business's own language and stakeholder terms from PAGE DATA.
- Keep the output practical: "Here is what to say differently" not "Here is a SWOT matrix."
- Avoid generic advice -- every recommendation should reference the user's specific situation.
