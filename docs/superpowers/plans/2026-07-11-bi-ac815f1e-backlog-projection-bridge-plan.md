# Implementation Plan — BI-AC815F1E: Bridge backlog items into the WorkCase projection

**BI:** BI-AC815F1E (epic **EP-WORK-CONVERGENCE**) — "bridge remaining work primitives into the WorkCase projection via source-registry". First slice: **BacklogItem**.
**Date:** 2026-07-11
**Status:** Implemented (bridge + invocation, this PR); live E2E is the acceptance step (see below).

## Slice scope — BacklogItem first
BacklogItem is the cleanest first bridge because most of the substrate exists: `backlog-item` is registered in `WORK_CASE_WORK_ITEM_SOURCE_TYPES`, `projectWorkItem` already maps WorkItem statuses to WorkCase states, and the workspace lens already surfaces `sourceType:"backlog-item"` rows. `bridgeBacklogItemToWorkItem` already existed and was already invoked on `→in-progress`.

## Gaps closed
1. **Status was hardcoded `queued`** (`backlog-bridge.ts`): an in-progress backlog item materialized as a WorkItem at `queued` → rendered as *intake*. Fixed with a `BacklogStatus → WorkItem.status` map (`triaging|open→queued`, `in-progress→in-progress`, `done→completed`, `deferred→deferred`); the item is now created at its projected status.
2. **No lifecycle sync**: once created (at in-progress), later backlog transitions never updated the WorkItem, so a done item's case stayed *active*. The bridge now syncs an existing live case's status+title, so `in-progress → done` closes the case.
3. **Invocation only fired on `→in-progress`** (`mcp-tools.ts` backlog status handler): broadened to fire on every backlog transition. To avoid flooding the queue with a case for every triaging/open item, the bridge only **creates** a fresh case on work-start (in-progress) and otherwise only **syncs** an existing case (returns null when there's nothing to materialize).

## Verification
- 5 bridge unit tests: create-at-projected-status; no-create for not-yet-started (no flooding); sync-on-advance (in-progress→done closes); no-op when already matching; body fallback. `apps/web` typecheck clean (0 errors).
- **Live-portal acceptance (follow-up, per structural-verification-is-not-functional):** confirm on the Contributor preview (:3001) that claiming/advancing a real backlog item materializes/syncs a WorkItem and it appears at `/workspace` cases at the right state. Not claimed as done from the unit run alone.

## Follow-on
Epic, FeatureBuild, TaskRun, CoworkerEngagement, WorkEngagement each need their own source-type + registry entry + bridge + status map (their statuses differ from WorkItem's). BacklogItem is first because it skips those.
