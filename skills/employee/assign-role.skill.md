---
name: assign-role
description: "Help assign or update an employee's role"
category: employee
assignTo: ["hr-specialist"]
capability: "view_employee"
taskType: "conversation"
triggerPattern: "assign|role|update role"
userInvocable: true
agentInvocable: true
allowedTools: [query_employees]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Assign or Update Employee Role

Help me assign or update an employee's role.

## Steps

1. Ask the user which employee they want to update. Use `query_employees` to search if needed.
2. Show the employee's current role and team assignment.
3. Ask what new role or change the user wants to make.
4. Confirm the change before applying.
5. If direct role update tools are not available, create a backlog item to track the change.

## Guidelines

- Always confirm the employee identity before making changes.
- Show the before and after state of the role assignment.
- If the role change affects tier or SLA commitments, note this.
- Respect the principle that role changes may require approval workflows.
