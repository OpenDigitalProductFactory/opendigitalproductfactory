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

### Slice 1 (this PR) — analyzer + registration

1. Pure `analyzeCollaborationHealth(events)` — hermetic, no Prisma/React.
2. Unit tests: failed/blocked density, stuck active delegations, orphan lineage, sparse capture honesty.
3. Job catalog row + Inngest function that loads recent rows → pure analyzer → logs rollup (notify/BI deferred).
4. This plan + pointer from inventory follow-on language (optional body note only if inventory already merged).

### Slice 2 — closed loop

1. PlatformNotification for warning+ findings.
2. ImprovementSignal `sourceType: a2a-collaboration-health`.
3. Critical auto-BI `BI-A2A-EFF-*` + optional platform-engineer one-shot (copy MCP aiops-handoff).
4. MCP tool `analyze_a2a_collaboration_health` in optimization pack.

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
