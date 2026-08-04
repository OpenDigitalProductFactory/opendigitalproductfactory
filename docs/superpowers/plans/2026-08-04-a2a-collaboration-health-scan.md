# Plan: A2A collaboration health scan (BI-3003EE63)

| Field | Value |
|-------|-------|
| **BI** | BI-3003EE63 |
| **Epic** | EP-COWORKER-INTERACTIVITY |
| **Date** | 2026-08-04 |
| **Related** | BI-A08EBAEC (MCP twin, done), BI-D5348705 (inventory, done), BI-9DB7C332 (capture), BI-65B0D697 (ops-map) |
| **Pattern** | `apps/web/lib/operate/mcp-call-efficiency/*` + `ops/mcp-call-efficiency-scan` |

## Goal

Daily (or on-demand) pass over coworker↔coworker substrate that **finds collaboration waste/failure**, emits operator-safe signals, and optionally hands off to AI Ops — **without** inventing a second bus or fabricating deliberation agent identity.

## Shared dimensions (with MCP efficiency)

| Dimension | MCP unit | A2A unit |
|-----------|----------|----------|
| Window | `windowStart` / `windowEnd` ISO | Same |
| Actor | `agentId` (tool caller) | `fromAgentId` / `toAgentId` pair |
| Session | `threadId` | `taskRunId` / `chainId` / `buildId` when present |
| Success | `success` boolean | edge `state` ∈ completed vs failed/blocked |
| Duration | `durationMs` | `completedAt − occurredAt` when both known |
| Surface | executionMode / PAT | edgeKind (delegation, handoff, lineage, deliberation) |

## Phases

### Slice 1 (merged #3964) — analyzer + registration

1. Pure `analyzeCollaborationHealth(events)` — hermetic, no Prisma/React.
2. Unit tests: failed/blocked density, stuck active delegations, orphan lineage, sparse capture honesty.
3. Job catalog row + Inngest function that loads recent rows → pure analyzer → logs rollup.
4. Plan checked in under `docs/superpowers/plans/`.

### Slice 2 (this PR) — closed loop

1. PlatformNotification for warning+ findings (`category: a2a-collaboration-health`).
2. ImprovementSignal `sourceType: a2a-collaboration-health`.
3. Critical auto-BI `BI-A2A-EFF-*` + one-shot platform-engineer review task.
4. MCP tool `analyze_a2a_collaboration_health` in optimization pack + agent-grants.
5. Daily cron enables notify + dispatchAiOps (owner from scheduled-owner).

### Slice 3 — polish

1. Ops-map deep links (filter types/states).
2. Shared dimension labels in user-guide AI Ops section.
3. Capture incompleteness metrics surfaced next to findings.

## Non-goals

- Public A2A wire protocol.
- Fabricating `a2a-deliberation` edges without branch `agentId`.
- Replacing MCP tool plane.

## Verification

1. `pnpm --filter web exec vitest run lib/operate/a2a-collaboration-health`
2. Catalog lists `a2a-collaboration-health-scan`.
3. Inngest function registered in `scheduledFunctions`.
4. Empty install: `ledgerSufficiency.usable === false`, no fake “green collaboration”.
