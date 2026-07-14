# Implementation Plan — BI-B416B12A: work-item comment box + @mention notify UI

**BI:** BI-B416B12A (EP-WORK-CONVERGENCE) · **Date:** 2026-07-14 · **Status:** UI shipped (logic pipeline merged in #2950).

## Design grounding
Source of truth: convergence memo §6.6 + the B416B12A mention-notify plan (2026-07-12). This is the **UI realization** — it wires the merged pipeline (buildMentionRoster → resolveMentions → postWorkItemComment → notification fan-out) to a user-facing surface.

## This slice
- `apps/web/lib/work-management/submit-work-item-comment.ts` — `"use server"` wrapper: assembles the roster (coworkers via `loadRoster` + workspace users, handles slugified since User has email only) and runs the pipeline; returns a value (never throws to the client).
- `apps/web/components/workspace/WorkItemCommentBox.tsx` — comment box (textarea + Post) that reports how many teammates were notified.
- `apps/web/lib/work-management/workspace-case-loader.ts` — exposes `workItemId`/`workItemTitle` on the case detail; `WorkCaseDetailView` renders the box.

## Verification
Typecheck clean; `WorkCaseDetailView` render test passes; module-size ok.

## Deferred (portal-dependent)
Real-time presence (who's viewing/working an item); the live spouse-test on `:3001`.
