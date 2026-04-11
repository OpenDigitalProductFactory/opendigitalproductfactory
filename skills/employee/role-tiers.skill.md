---
name: role-tiers
description: "Explain the role tiers and their SLA commitments"
category: employee
assignTo: ["hr-specialist"]
capability: "view_employee"
taskType: "conversation"
triggerPattern: "tier|sla|hitl|commitment"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Role Tiers and SLA Commitments

Explain the role tiers and their SLA commitments.

## Steps

1. Present the tier structure:
   - **Tier 1 (Automated):** Fully AI-handled, no human in the loop. SLA: immediate.
   - **Tier 2 (AI-Assisted):** AI drafts, human reviews. SLA: defined per workflow.
   - **Tier 3 (Human-Led):** Human performs with AI support. SLA: per role agreement.
   - **Tier 4 (Human-Only):** No AI involvement. SLA: traditional.
2. Explain how tiers map to roles in this organisation.
3. Describe the HITL (Human-in-the-Loop) escalation model.
4. Answer any follow-up questions about specific tiers or roles.

## Guidelines

- Use concrete examples relevant to the user's organisation when possible.
- Explain that tier assignment affects response time expectations.
- If the user asks about changing a tier, explain the governance process.
- Reference IT4IT value streams when explaining how tiers align to operations.
