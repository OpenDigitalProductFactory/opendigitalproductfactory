# Implementation Plan — BI-C41AB195: Unified AgentSession rollup on the WorkCapsule

**BI:** BI-C41AB195 (epic **EP-WORK-CONVERGENCE**)
**Date:** 2026-07-11
**Status:** Implemented — substrate + writer + MCP tool (this PR). Detail-page timeline UI is a deferred follow-up (needs live-portal verification).

## Key finding — the AgentSession already exists: it's the WorkCapsule
A WorkCapsule already carries the named-teammate identity (`executorKind`/`executorRef`) and an append-only `WorkCapsuleActivity[]` timeline. Linear's AgentSession+AgentActivity maps directly: AgentSession = WorkCapsule, AgentActivity = WorkCapsuleActivity. No new model, no migration (`WorkCapsuleActivity.kind` is a plain String). The gap was purely that the activity vocabulary was all lifecycle/plumbing (created, lease-renewed, executor-changed…) with **no human-legible "what is the teammate thinking/doing/asking" kinds and no writer**.

## What this delivers
- **Vocabulary** (`apps/web/lib/work-capsules.ts`): `AGENT_ACTIVITY_KINDS = [thought, action, question, response, error]` + `AgentActivityKind` type + `isAgentActivityKind` guard; also folded into `WORK_CAPSULE_ACTIVITY_KINDS` so `recordActivity`'s typed `kind` accepts them.
- **Writer** (`work-capsule-store.ts`): `recordAgentActivity({ db, capsuleId, activity: { type, body, payload? }, actor })` — validates the type, looks up the capsule, delegates to the existing `recordActivity`. **Roll-up guarantee:** every executor and sub-worker writes to the SAME capsule via this one writer, so multi-agent work reads as one teammate session on one item — never N surfaces. `payload.subtaskRef` attributes a sub-worker line without a separate session record.
- **MCP tool** `record_agent_activity` (pack def + handler `recordAgentActivityTool` + grant + agent-grants) so external Claude/Codex/Grok/opencode sessions emit typed activities directly. Renews the capsule lease on write (mirrors `record_capsule_evidence`). Provenance-free description (clears tool-description-hygiene).

## Verification
- `recordAgentActivity` unit tests (all 5 kinds write with actor identity; invalid type rejected pre-lookup; missing capsule throws). `isAgentActivityKind` guard tests. Drift/hygiene + enum-parity green. `apps/web` typecheck clean (0 errors after `next typegen`). 121 tests across the touched suites.

## Deferred (out of first cut)
- A dedicated `AgentSession` Prisma model — unnecessary; the WorkCapsule is the session.
- A live `WorkCapsule ↔ TaskRun` relation to fold orchestration nodes into the feed (`taskRunId` is a bare FK today).
- **Detail-page timeline UI** (`build/work/[capsuleId]/page.tsx` already fetches `activities` but discards them) — a follow-up UI slice; that one needs live-portal verification per structural-verification-is-not-functional.
