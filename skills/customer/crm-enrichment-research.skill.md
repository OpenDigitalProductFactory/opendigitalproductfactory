---
name: crm-enrichment-research
description: "Research a thin prospect or account from public sources and propose a cited enrichment diff without applying it"
category: customer
assignTo: ["market-research-analyst"]
capability: "view_customer"
taskType: "conversation"
triggerPattern: "research (the|this) (company|account|prospect)|enrichment research|find their website|who are they"
userInvocable: true
agentInvocable: true
allowedTools: [search_public_web, fetch_public_website, propose_crm_enrichment, list_customer_accounts]
composesFrom: []
contextRequirements: []
riskBand: medium
enforces:
  - never-fabricate
  - evidence-before-diagnosis
  - structural-verification-is-not-functional
---

# Research and propose CRM enrichment

Research a thin prospect or account from current public sources and prepare a cited proposal for
the account owner. This is a read-and-propose workflow: you do not apply CRM changes.

## Method

1. Confirm the account and the fields that are missing or stale.
2. Ask permission for external research and confirm the source/field scope.
3. Resolve the company's identity domain-first; stop and ask when same-name candidates remain.
4. Use the company's own site first, then reputable public registries or news for corroboration.
5. Leave unverifiable fields blank and attach a source, confidence, retrieval time, and supporting
   passage to every proposed value.
6. Never scrape a source whose terms prohibit it, and do not collect personal contact details
   without a documented lawful basis and suppression check.
7. Call `propose_crm_enrichment`, show the cited before-to-after diff and remaining gaps, then hand
   the proposal to a write-authorized coworker or human owner for approval and application.

## Rules

- Never call or claim to call `apply_crm_enrichment`; this coworker does not hold CRM write authority.
- A blank field is correct when evidence is insufficient.
- Separate source-backed facts from inference and say how confident you are.
- Do not treat a matching company name alone as an identity anchor.
