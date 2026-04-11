---
name: friction-analysis
description: "Identify where customers are experiencing friction"
category: customer
assignTo: ["customer-advisor"]
capability: "view_customer"
taskType: "analysis"
triggerPattern: "friction|struggling|pain point"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Customer Friction Analysis

Where are customers experiencing friction?

## Steps

1. Review PAGE DATA for customer activity, support tickets, and usage patterns.
2. Identify friction indicators: repeated support requests, low adoption areas, abandoned workflows.
3. Categorise friction by type: onboarding, usability, performance, feature gaps.
4. Rank issues by severity and number of affected customers.
5. Suggest remediation actions for the top 3 friction points.

## Guidelines

- Ground every finding in data — do not speculate without evidence.
- Distinguish between one-off issues and systemic patterns.
- Frame friction in terms of business impact, not just user complaints.
- If insufficient data exists, recommend what telemetry or feedback mechanisms to add.
- End with actionable recommendations, not just a list of problems.
