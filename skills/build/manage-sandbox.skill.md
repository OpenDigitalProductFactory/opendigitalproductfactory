---
name: manage-sandbox
description: "Check and start the build sandbox container when it is not running"
category: build
assignTo: ["build-specialist"]
capability: "view_platform"
taskType: "action"
triggerPattern: "sandbox|container|not running|start sandbox|sandbox down|sandbox status"
userInvocable: true
agentInvocable: true
allowedTools: [check_sandbox, start_sandbox]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Manage Build Sandbox

Check the status of the build sandbox and start it if it is not running.

## Steps

1. Call `check_sandbox` to get the current status.
2. If status is **running** — confirm to the user and proceed.
3. If status is **stopped** — call `start_sandbox` to start it. Report success or failure.
4. If status is **not_found** — the container has never been created. Tell the user:
   > "The sandbox container does not exist yet. Please run `docker compose up -d sandbox` once from your DPF directory. After that I can start and stop it automatically."

## Guidelines

- Never ask the user to run terminal commands for start/stop — that is handled by `start_sandbox`.
- The only time a terminal command is needed is the very first setup (`not_found` case).
- After starting, confirm the sandbox is ready before proceeding with any build work.
- If `start_sandbox` times out, suggest waiting 30 seconds and calling `check_sandbox` again.
