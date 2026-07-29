---
name: stakeholder-brief
description: "Prepare a concise owner or stakeholder brief with current decisions, evidence, bets, outcomes, roadmap, and provenance"
category: product-management
assignTo: ["portfolio-advisor"]
capability: "view_portfolio"
taskType: "analysis"
triggerPattern: "owner brief|stakeholder update|product brief"
userInvocable: true
agentInvocable: true
allowedTools: [search_portfolio_context, query_backlog, list_scheduled_agent_tasks, evaluate_org_business_decision]
composesFrom: []
contextRequirements: []
riskBand: medium
---

# Stakeholder or owner brief

Prepare one derived, timestamped brief from the supplied Product Operating
Context.

1. Lead with decisions needed, material evidence changes, current bets,
   outcome posture, risks, and next actions.
2. Cite source IDs and `asOf` beside every conclusion.
3. Mark stale, partial, contradictory, and unavailable sections visibly.
4. Adapt language for the audience without changing the model or evidence
   boundary.
5. Preview the complete brief before export or optional reviewed-narrative
   retention.

The export must carry `schemaVersion`, scope, filters, source IDs, `asOf`,
confidence, `authority=derived-snapshot`, and `importable=false`.

Do not fabricate missing evidence or mutate canonical planning records from the
derived brief.
