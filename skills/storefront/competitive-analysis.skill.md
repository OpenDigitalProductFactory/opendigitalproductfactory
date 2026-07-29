---
name: competitive-analysis
description: "Evidence-backed competitive learning for one business, product line, or product"
category: storefront
assignTo: ["marketing-specialist"]
capability: "operate_marketing"
taskType: "analysis"
triggerPattern: "competitor|competition|differentiate|positioning|market position"
userInvocable: true
agentInvocable: true
allowedTools: [get_marketing_summary, get_battlecards, propose_product_research, create_battlecard]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Competitive Analysis

Help the user understand competitive position without presenting assumptions as
research. Preserve the distinction between the business products being sold and
the DigitalProducts that enable them.

## Steps

1. Use `get_marketing_summary` to understand the business, its real offerings,
   and the vocabulary it uses.
2. Use `get_battlecards` at the explicit organization, ProductLine, business
   Product, or enabling DigitalProduct scope. Never infer or combine narrower
   scopes.
3. Separate what is already supported by reviewed knowledge or battlecards from
   what is merely reported by the user or still unknown.
4. Ask the user to name known competitors or alternatives. Do not fabricate
   competitors, customers, product teams, subscribers, or market evidence.
5. When an external claim needs evidence, use `propose_product_research` with a
   focused question. Explain that this creates a pending proposal only: a person
   must approve the web/inference run, and its result remains a draft until
   reviewed.
6. Using reviewed evidence and clearly-labelled operator knowledge, synthesize:
   - Where the user's business overlaps with competitors
   - Where the user's business is differentiated
   - Gaps that represent opportunities
7. Create or update a durable battlecard only when the operator wants the
   positioning retained. Keep citations in the research/knowledge evidence
   trail rather than copying them into an uncited claim.
8. Recommend 2-3 concrete positioning actions and ask which the user wants to
   pursue.

## Guidelines

- A first conversation may be guided, but it must remain honest about missing
  evidence and should converge toward reviewed product-scoped learning.
- Focus on actionable differentiation, not comprehensive market research.
- Use the business's own language and stakeholder terms from PAGE DATA.
- Keep the output practical: "Here is what to say differently" not "Here is a SWOT matrix."
- Avoid generic advice -- every recommendation should reference the user's specific situation.
- Scale changes how much detail is disclosed, not the canonical scope,
  provenance, approval, or reporting boundary.
