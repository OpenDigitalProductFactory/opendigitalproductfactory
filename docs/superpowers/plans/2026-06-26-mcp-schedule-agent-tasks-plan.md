# Plan — MCP interface for scheduled agent tasks (BI-1C44A93A, v1)

**Status:** in progress (external Claude Code build, 2026-06-26)
**Backlog:** BI-1C44A93A (EP-PROACTIVE-OPS) — "MCP interface to manage schedules; today portal-server-action only."

## Problem

DPF's recurring-agent-task substrate (`scheduledAgentTask` + `scheduleAgentTask()` / `getScheduledAgentTasks()` / `cancelAgentTask()` in `apps/web/lib/actions/agent-task-scheduler.ts`) is reachable **only** through portal server actions. An MCP-driven agent (Claude Code / Codex / Grok / in-portal coworker) cannot create / list / cancel recurring tasks through MCP — which forced a Claude-Code client-local cron workaround (a defect under `mcp-is-the-coordination-plane`).

## Design

### Auth safety (the load-bearing decision)
The existing functions are `"use server"` actions that resolve identity via `auth()` (web session). Adding an optional `userId` override to a server action would let a client **spoof another user** across the action boundary. Instead, extract the logic into a **non-`"use server"` core** — `apps/web/lib/operate/scheduled-jobs/agent-task-core.ts` — with explicitly `userId`-parameterized functions:
- `scheduleAgentTaskFor(userId, input)`
- `getScheduledAgentTasksFor(userId)`
- `cancelAgentTaskFor(userId, taskId)` — ownership-checked (only the owner may cancel).

Both callers delegate to the core with a *trusted* userId:
- web actions (`agent-task-scheduler.ts`) → `auth()` → core;
- MCP tools (`mcp-tools.ts`) → MCP-authenticated userId (the tool layer already gated scope + grant).

### v1 scope — the agent-task trio
Closes the founder-flagged gap (create a recurring scan via MCP):
- `create_scheduled_agent_task` (side-effecting → **write** scope)
- `list_scheduled_agent_tasks` (read-only → **read** scope)
- `cancel_scheduled_agent_task` (side-effecting → **write** scope)

The ScheduledJob admin tools (`list/update/enable/run_scheduled_job`) — managing platform crons, which require `manage_platform` + core-locked rules — are a **follow-up slice** (separate PR), to keep this change bounded and the auth surface small.

### Grants
Reuse existing grants for v1 to avoid a new grant category + seed/role churn:
- `create_scheduled_agent_task`, `cancel_scheduled_agent_task` → `["work_capsule_write"]`
- `list_scheduled_agent_tasks` → `["work_capsule_read"]`

Scheduling a recurring agent task is coordination-plane work, so the work-capsule grants are a semantically reasonable fit and satisfy the routing-audit INV-1 (every PLATFORM_TOOLS entry needs a TOOL_TO_GRANTS mapping). A dedicated `schedule_manage` category (per the BI) can follow if tighter separation is wanted.

### Authority / scope
All three are **userId-scoped**: tasks are owned by the caller; list returns the caller's tasks; cancel is ownership-checked. No platform-wide authority is taken in v1.

### Out of scope (follow-ups)
- ScheduledJob admin MCP tools (platform crons; `manage_platform`).
- A dedicated `schedule_manage` grant category.
- Non-UTC timezone support (the existing UTC-only limitation is retained; tracked separately).

## Tests
Unit-test the core's pure-ish guarantees (UTC rejection, ownership check on cancel) against a mocked prisma, mirroring the existing scheduled-jobs test style.
