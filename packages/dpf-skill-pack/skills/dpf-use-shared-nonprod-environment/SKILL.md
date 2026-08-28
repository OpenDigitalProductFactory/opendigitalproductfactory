---
name: dpf-use-shared-nonprod-environment
description: "Use before DPF preview or UX verification when a thread needs a nonproduction environment."
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

## Worktree vs. runtime, restated

Thread worktrees give source-control isolation. They do not give a runtime. When a task needs runtime-bound verification (portal up, MCP reachable, Build Studio executing, a route rendered in a real browser), the answer is **this skill**, not "make the worktree runnable." The canonical local install and the governed shared nonprod environments are where runtime verification happens; the worktree is where the diff under test lives. See [`worktree-is-source-control-not-runtime`](../../../../docs/founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md) and [AGENTS.md §5](../../../../AGENTS.md).

If no shared environment is available and the canonical local install is the right target, verify there and record the URL + run evidence in the PR. Reserve "spin up a disposable runtime clone" for the rare task whose explicit deliverable is exactly that.

## When to use

- A thread is about to verify UI, Build Studio, routes, or workflows in a browser.
- Multiple concurrent threads might compete for local ports or machine resources.
- A verification step needs merged-code truth, not a stale per-thread dev server.

## Enforces

- `kernel/principles/no-assumptions`
- `kernel/principles/responsible-capacity-utilization`

## Steps

1. List current nonproduction environment leases.
2. Choose a shared environment that matches the task's verification need.
3. Request admission with branch, worktree, task, expected release context, and
   a stable `claimKey` for this exact attempt.
4. If the result is `queued`, do not touch the runtime. Re-observe the same
   claim with bounded backoff; reusing `claimKey` preserves FIFO position.
5. Only an `admitted` result authorizes verification against the provided URL.
6. Release an admitted lease when verification is complete or blocked. Release
   a queued lease to cancel the request when the task stops waiting.

## Guardrails

- Do not start a thread-owned preview server when a shared environment is available.
- A successful queued response is not runtime ownership; only `admitted` is.
- Do not hold a lease after the thread is complete, blocked, or handed off.
- Do not show lease IDs or raw tool names in the default UI. Show "Shared environment ready", "in use", or "blocked."
- Don't treat this skill as optional when runtime-bound verification is needed in a thread worktree — it IS the runtime path; the worktree is not.

## Worked example

A Build Studio UX check needs `localhost`. This skill requests durable FIFO
admission and quietly waits on the same claim identity. Once admitted it
returns an "Open environment" link and records the lease in audit details. The
operator sees readiness and one action, not the MCP lease payload.
