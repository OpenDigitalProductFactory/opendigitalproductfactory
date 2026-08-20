---
name: posture-report
description: "Report on current compliance posture score and key detractors"
category: compliance
assignTo: ["compliance-officer"]
capability: "view_compliance"
taskType: "analysis"
triggerPattern: "posture|score|compliance health"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Compliance Posture Report

What is our current compliance posture score and what's dragging it down?

## Steps

1. Review PAGE DATA for compliance metrics: coverage ratio, control effectiveness, audit findings.
2. Calculate or retrieve the overall posture score.
3. Break down the score by regulation or framework.
4. Identify the top detractors — what is pulling the score down the most.
5. Present a summary: overall score, per-regulation scores, top 3 detractors with root causes.
6. Recommend actions to improve the score.

## Guidelines

- Express the posture score as a percentage or letter grade for clarity.
- Show trend direction if historical data is available (improving, declining, stable).
- Be specific about detractors — name the regulation and obligation, not just "some gaps."
- If the score is good, say so — do not manufacture concern.
- End with prioritised improvement actions ranked by impact.
