---
name: gap-assessment
description: "Identify compliance gaps — obligations with no controls"
category: compliance
assignTo: ["compliance-officer"]
capability: "view_compliance"
taskType: "analysis"
triggerPattern: "gap|coverage|unmapped|missing control"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Compliance Gap Assessment

Show me where our compliance gaps are — which obligations have no controls?

## Steps

1. Review PAGE DATA for the current compliance model: regulations, obligations, controls.
2. Identify obligations that have no mapped controls (unmapped gaps).
3. Identify controls that are mapped but not yet implemented or verified.
4. Categorise gaps by severity: critical (regulatory deadline approaching), high, medium, low.
5. Present a gap summary with obligation name, regulation, and recommended action.

## Guidelines

- Use a table format: Obligation | Regulation | Gap Type | Severity | Recommended Action.
- Prioritise gaps with upcoming deadlines or high regulatory risk.
- Distinguish between "no control exists" and "control exists but is not effective."
- If the compliance model is sparse, note that more obligations may need to be mapped first.
- End with a prioritised action list for closing the most critical gaps.
