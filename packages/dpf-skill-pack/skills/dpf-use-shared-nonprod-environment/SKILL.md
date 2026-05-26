---
name: dpf-use-shared-nonprod-environment
description: "Use in the DPF codebase before preview or UX verification when a thread needs a nonproduction environment. Prefers the governed shared localhost environments and lease workflow over unmanaged per-thread servers."
disable-model-invocation: false
user-invocable: true
allowed-tools: mcp__dpf__list_nonprod_environment_leases mcp__dpf__claim_nonprod_environment_lease mcp__dpf__release_nonprod_environment_lease
category: ops
assignTo: ["build-specialist", "platform-engineer", "ops-coordinator"]
capability: null
taskType: workflow
triggerPattern: "shared nonprod|nonproduction environment|localhost environment|claim environment|preview server|rogue server"
userInvocable: true
agentInvocable: true
allowedTools: ["mcp__dpf__list_nonprod_environment_leases", "mcp__dpf__claim_nonprod_environment_lease", "mcp__dpf__release_nonprod_environment_lease"]
composesFrom: ["dpf-worktree-per-session"]
contextRequirements: ["DPF MCP environment lease tools reachable; target worktree known"]
riskBand: medium
enforces:
  - kernel/principles/no-assumptions
  - kernel/principles/responsible-capacity-utilization
---

# DPF Use Shared Nonprod Environment

Use governed shared localhost environments for preview and UX verification instead of starting unmanaged servers.

## When to use

- A thread is about to verify UI, Build Studio, routes, or workflows in a browser.
- Multiple concurrent threads might compete for local ports or machine resources.
- A verification step needs merged-code truth, not a stale per-thread dev server.

## Enforces

- `kernel/principles/no-assumptions`
- `kernel/principles/responsible-capacity-utilization`

## Steps

1. List current nonproduction environment leases.
2. Choose an available shared environment that matches the task's verification need.
3. Claim the lease with branch, worktree, task, and expected release context.
4. Verify against the provided localhost URL.
5. Release the lease when the verification slice is complete or blocked.
6. If no environment is available, return a clear blocked state instead of starting a new unmanaged server.

## Guardrails

- Do not start a thread-owned preview server when a shared environment is available.
- Do not hold a lease after the thread is complete, blocked, or handed off.
- Do not show lease IDs or raw tool names in the default UI. Show "Shared environment ready", "in use", or "blocked."

## Worked example

A Build Studio UX check needs `localhost`. This skill claims the available shared environment, returns an "Open environment" link, and records the lease in audit details. The operator sees readiness and one action, not the MCP lease payload.
