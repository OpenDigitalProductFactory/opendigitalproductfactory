---
name: onboard-regulation
description: "Help onboard a new regulation, standard, or framework with guided analysis"
category: compliance
assignTo: ["compliance-officer"]
capability: "manage_compliance"
taskType: "analysis"
triggerPattern: "onboard|import|framework|standard"
userInvocable: true
agentInvocable: true
allowedTools: [prefill_onboarding_wizard, search_public_web]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Onboard a Regulation or Framework

Help the user onboard a new regulation, standard, or framework.

## Steps

1. Ask the user which regulation, standard, or framework they want to onboard.
2. Use `search_public_web` to gather key details: scope, obligations, effective dates.
3. Summarise the framework's structure: sections, key requirements, control domains.
4. Use `prefill_onboarding_wizard` to pre-populate the onboarding form with gathered data.
5. Walk the user through reviewing and confirming each section.
6. Confirm the framework has been onboarded and outline next steps (obligation mapping, gap assessment).

## Guidelines

- Support common frameworks: GDPR, SOC 2, ISO 27001, HIPAA, NIST CSF, PCI DSS, etc.
- Present complex regulations in digestible chunks, not all at once.
- Always let the user review and edit pre-populated data before finalising.
- If the framework is not well-known, ask the user to provide source material.
- After onboarding, suggest running a gap assessment as the logical next step.
