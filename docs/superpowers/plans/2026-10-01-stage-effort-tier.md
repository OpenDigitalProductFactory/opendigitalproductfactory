---
status: active
---

# Effort tier per work-shape stage: plan

- **Spec:** [2026-10-01-stage-effort-tier-design.md](../specs/2026-10-01-stage-effort-tier-design.md)
- **Backlog:** BI-B3BBF9AD (parent BI-7AE90091)

There is one phase, and the change ships as one PR on `feat/stage-effort-tier`. The declaration, the hand-off and the routing only mean something together.

## Phase 1: Declare, carry and route the tier

| Deliverable | Files | Covers | Backlog |
|---|---|---|---|
| Stage effort and its resolver | `work-shapes.ts` (`effort`, `resolveStageEffort`), standing, coworker and orchestration shape files | AC-G2, AC-G5 | BI-B3BBF9AD |
| Declared tier beats the proxy | `tak/effort-warrant.ts` | AC-G1 | BI-B3BBF9AD |
| Hand-off on the one stage record | `scheduling/workroom-stage-task-config.ts`, `work-management/workroom-stage-effort.ts`, `queue/functions/workroom-drive.ts`, `actions/agent-task-scheduler.ts` | AC-G3 | BI-B3BBF9AD |
| Routing by tier | `tak/stage-effort-routing.ts`, `tak/agentic-loop.ts`, `inference/spend-aware-routing.ts` | AC-G4 | BI-B3BBF9AD |
| Live check after deploy | the running install | AC-G6 | BI-B3BBF9AD |

Gate: unit tests for the touched areas, both typecheck programs, preflight, and the local CI gate.
