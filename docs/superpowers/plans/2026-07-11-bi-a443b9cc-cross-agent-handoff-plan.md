# Implementation Plan — BI-A443B9CC: Cross-agent handoff records executor changes & transfers leases

**BI:** BI-A443B9CC (epic **EP-WORK-CONVERGENCE**, priority 3 — the headline capability)
**Date:** 2026-07-11
**Status:** Implemented (this PR)
**Memo:** `docs/superpowers/specs/2026-07-11-collaborative-work-management-convergence-memo.md` §6.4

## Gap
The `executor-changed` WorkCapsule activity kind was defined (`apps/web/lib/work-capsules.ts:88`) with **zero writers** — no way to record a cross-agent handoff or transfer the lease when work passes from one executor to another. So a Claude→Grok handoff was invisible and un-leased.

## What this delivers
1. **Store writer** `reassignWorkCapsuleExecutor` (`apps/web/lib/work-capsules/work-capsule-store.ts`): in one transaction, change `executorKind`/`executorRef`, transfer the lease (`leaseHolderPrincipalId` → receiving principal, renew `leaseExpiresAt`), and write an `executor-changed` activity carrying full provenance — from/to executor, from/to lease holder, reason, and a handoff manifest (next action, open risks, evidence digest, branch/worktree, suggested receiver). Mirrors `heartbeatWorkCapsule`'s transactional pattern. Throws on invalid target executor kind or missing capsule (before any mutation).
2. **MCP tool** `reassign_capsule_executor` (`work-capsules-pack.ts` def+handler+grant, handler `reassignCapsuleExecutorTool` in `mcp-handlers.ts`, grant in `tak/agent-grants.ts`) — the 3 sync points. `requiredCapability: manage_backlog`, grant `work_capsule_write`. Provenance-free description (clears tool-description-hygiene).

## Verification
- 3 new store tests (executor+lease transfer with provenance; invalid kind rejected pre-mutation; missing capsule throws) → 37 store tests pass.
- Drift/hygiene green: tool-description-hygiene, tool-registry, coworker-tool-grant, governed-execute (71 tests).
- `apps/web` typecheck clean (0 errors).

## Design notes (propose → acknowledge → adopt)
This ships the **adopt** step (the actual reassignment + record). A full propose→acknowledge handshake (offer a handoff, receiver acknowledges before adopting) is a thin follow-up layered on this writer — the manifest field already carries the offer payload. Renders as a plain status event ("Claude started this; Grok is finishing it"), not raw agent plumbing.

## Out of scope
Customer-mode rendering of the handoff (BI-BB13B599); the propose/acknowledge UX handshake.
