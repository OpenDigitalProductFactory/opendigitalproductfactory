---
status: active
---

# Agent-Safe Self-Upgrade Trigger Design

Date: 2026-06-30
Status: Approved for implementation
Backlog: BI-F5F0AC1D
Work Capsule: WC-793D9EDA

> **Amended 2026-10-06 (BI-2128872C, operator decision "nightly window only").**
> An agent request outside the window is no longer answered with
> `human_override_required`; it is deferred to the next window
> (`status: "deferred_to_window"`, with `runAt`) and the scheduled gate honours
> it there. `human_override_required` remains only for an install with no
> computable window. A browser session signed in as the automation persona is
> treated as an agent. An operator's out-of-window "Upgrade now" records
> `+outside-window` on the run trigger. The outside-window contract below is
> superseded by `apps/web/lib/self-upgrade/upgrade-timing.ts`.

## Problem

### Proposed DEV timing amendment — 2026-10-14

Local follow-up: **BI-DE9FB008**, Workroom **WC-3BEE075D**. This extends the
timing boundary; it does not reopen or modify the paired-peer-owned
BI-2128872C. BI-B22C8E02 covers routine operation consequence classification,
and BI-45DA45A6 covers delivery of the installation contract to clients; neither
implements this timing amendment.

**OBJ-DEV:** An already-authorized repair request on a server-verified
development installation whose primary purpose is `evolve-dpf` can advance a
ready release batch through the existing governed pipeline without waiting for
the organization's ordinary business-hours window.

**OBJ-BOUNDARY:** Production, staging, unknown or invalid installation context,
and organization-operation purposes retain the current agent timing policy.
An explicit operator blackout still pauses agent requests. Actor identity,
token/grant/capability checks, batching, active-run suppression, quiescence,
capture, immutable image identity, health verification and rollback remain.

| Acceptance | Objectives | Statement |
|---|---|---|
| AC-DEV | OBJ-DEV | A verified development/evolve-dpf agent request with an eligible batch runs through ordinary admission outside the business window, retaining agent provenance and requestedForce=false. |
| AC-BOUNDARY | OBJ-BOUNDARY | Production, staging, missing/invalid context and other purposes retain window deferral; caller reason/body cannot claim installation class or purpose. |
| AC-BLACKOUT | OBJ-BOUNDARY | An operator blackout defers the DEV request, with no run admission during the blackout. |
| AC-PIPELINE | OBJ-DEV, OBJ-BOUNDARY | An active run is joined, an ineligible batch does not run, and existing admission/identity/recovery safeguards remain authoritative. |

The observed baseline is qualified batch 89, source
`d317cb499fab936aa2a2fafc392bea0cc6f052be`, deferred to 22:00 UTC on this
development/evolve-dpf install. The October 7 policy answered 56 manual drains
in seven days; the amendment preserves that production protection rather than
making every requester an operator. The October 14 human instruction authorizes
reasonable DEV repair and coordinated deployment. A native WWMD consultation
recommended scoped DEV timing with high confidence; that is design advice,
not a source approval or permission to bypass the currently served policy.

Reuse `request.ts`, `upgrade-timing.ts` and the canonical server instance-stance
composition. Missing or failed stance reads take the existing cautious path.
Do not accept a client environment override, add a force flag, change organization
operating hours, introduce a new actor tier/table/pipeline, or mutate installed
runtime files. Existing deferred requests are reconciled through the normal
request/admission lifecycle rather than reset or retried blindly.

No schema migration is required. Reverting this amendment restores the global
agent window rule. Deployment and live acceptance remain pending until a
protected merged source is published and served through the governed pipeline.

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
