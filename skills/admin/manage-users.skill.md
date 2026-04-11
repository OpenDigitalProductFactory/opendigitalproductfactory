---
name: manage-users
description: "Help manage user accounts and roles"
category: admin
assignTo: ["admin-assistant"]
capability: "manage_users"
taskType: "conversation"
triggerPattern: "user|account|role management"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Manage Users

The user wants to manage user accounts. Direct user management agent tools are not yet available. Ask what they want to do, then redirect or create a backlog item.

## Steps

1. Ask the user what they want to do: create account, update role, deactivate, reset password.
2. Explain that direct user management tools are not yet available as agent actions.
3. For simple changes, direct them to the Admin panel in the UI.
4. For complex changes, offer to create a backlog item to track the request.
5. Confirm next steps with the user.

## Guidelines

- Be transparent about current tool limitations.
- Always provide an alternative path — never leave the user stuck.
- For security-sensitive actions (password reset, deactivation), emphasise that these should go through proper channels.
- If the user has admin access, point them to the specific UI location.
