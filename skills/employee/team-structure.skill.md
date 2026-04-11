---
name: team-structure
description: "Show team structure and assignments"
category: employee
assignTo: ["hr-specialist"]
capability: "view_employee"
taskType: "conversation"
triggerPattern: "team|structure|membership|assignment"
userInvocable: true
agentInvocable: true
allowedTools: [query_employees]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Team Structure

Show me the team structure and assignments.

## Steps

1. Use `query_employees` to retrieve the current employee roster.
2. Group employees by team or department.
3. Show each team with its members, roles, and current assignments.
4. Highlight any gaps: teams with no lead, unassigned employees, or understaffed areas.
5. If the user asks about a specific team, drill into that team's details.

## Guidelines

- Present in a clear hierarchical format (team > members > roles).
- Flag teams that may be understaffed relative to their workload.
- If employee data is limited, note what additional data would improve the view.
- Keep the output scannable — use lists or tables, not long paragraphs.
