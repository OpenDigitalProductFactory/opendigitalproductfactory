# Agent-Safe Self-Upgrade Trigger Design

Date: 2026-06-30
Status: Approved for implementation
Backlog: BI-F5F0AC1D
Work Capsule: WC-793D9EDA

## Problem

Post-merge verification depends on the live portal at `localhost:3000` serving the merged code. The governed path for advancing that portal already exists: `/ops/self-upgrade` creates a `SelfUpgradeRun`, dispatches `ops/self-upgrade.run`, and the runner performs activity precheck, quiescence, recovery point creation, source preparation, promoter swap, health verification, and cooldown handling.

External agents currently cannot reliably initiate that governed path. Browser automation depends on Chrome/session state, direct compose rebuilds bypass governance, and the read-only preflight tool can only say that the live install must advance.

## Goal

Expose an agent-callable self-upgrade trigger that is equivalent to a human initiating the normal governed upgrade during an allowed off-hours window, while preserving human override as the only path outside that window.

## Non-Goals

- No direct Docker, Compose, promoter, or `promote.sh` execution from MCP.
- No agent-controlled `force` or emergency override.
- No new deployment pipeline.
- No replacement for the existing `/ops/self-upgrade` UI.

## Design

Add a small request service shared by the UI server action and the MCP tool. The service owns durable run creation, duplicate-run suppression, event dispatch, and dispatch-failure handling.

Human UI path:
- Keeps current behavior.
- Auth remains `manage_provider_connections`.
- It may continue to act as a manual operator trigger.

Agent MCP path:
- New side-effecting MCP tool: `request_self_upgrade`.
- Required capability: `manage_provider_connections`.
- Checks the effective self-upgrade window before creating a run.
- If the install is outside the allowed window, returns `success: true` with `status: "human_override_required"` and no run/event.
- If the effective window cannot be determined safely, returns `status: "human_override_required"` with the specific reason.
- If the window is allowed, creates a run and dispatches the same `ops/self-upgrade.run` event the UI uses.
- Never accepts or forwards `force`.

The request-layer window check should mirror the scheduled runner's effective-window calculation:
- explicit `SelfUpgradeConfig.maintenanceWindows` wins;
- otherwise a 24/7 install with a known timezone may use the auto-selected overnight window;
- otherwise derive from operating hours;
- if a timezone is needed but unavailable, require human override.

The runner keeps its existing deeper safeguards. The new gate is not a substitute for quiescence; it prevents agents from starting a human-override-class action outside the normal unattended window.

## Result Shape

Allowed:

```json
{
  "success": true,
  "status": "queued",
  "runId": "SUR-...",
  "eventIds": ["..."],
  "triggeredBy": "mcp:<principal-or-user>"
}
```

Already active:

```json
{
  "success": true,
  "status": "already_active",
  "runId": "SUR-..."
}
```

Outside window:

```json
{
  "success": true,
  "status": "human_override_required",
  "reason": "outside-window",
  "message": "Self-upgrade is outside the allowed maintenance window. Use /ops/self-upgrade for a human override."
}
```

Dispatch failure:

```json
{
  "success": false,
  "status": "dispatch_failed",
  "runId": "SUR-...",
  "message": "queue-dispatch-failed: ..."
}
```

## Tests

- UI action still creates a queued run and dispatches the existing event.
- Shared request service suppresses duplicate active runs.
- MCP/agent request queues only when the effective window is open.
- MCP/agent request returns `human_override_required` outside the window and does not create a run.
- MCP/agent request returns `human_override_required` when a safe window cannot be determined.
- MCP definition is side-effecting, grant/capability gated, and has no `force` input.
- MCP handler returns structured `queued`, `already_active`, `human_override_required`, and `dispatch_failed` results.

## Operational Notes

After this lands and the portal advances, the post-merge verification loop becomes:

1. `verify_live_install_readiness(featureSha)`.
2. If `MUST-ADVANCE`, call `request_self_upgrade`.
3. If queued, wait for the live portal SHA to advance.
4. Re-run preflight.
5. Exercise the feature on `localhost:3000`.

If `request_self_upgrade` returns `human_override_required`, an agent stops and asks for a human action rather than bypassing the window.
