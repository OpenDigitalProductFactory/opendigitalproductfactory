# Implementation Plan — BI-B416B12A: threaded comments + @mention + presence

**BI:** BI-B416B12A (epic EP-WORK-CONVERGENCE) · **Date:** 2026-07-11 · **Status:** @mention parse/resolve core implemented; comment-write wiring, presence, and UI deferred (live-portal).

## Gap
Threaded comments already exist as `WorkItemMessage` (body/channel/senderType). The missing collaboration primitives are **@mention → subscription/notification** and **presence**. This slice ships the pure @mention core.

## This slice (pure, unit-testable)
- `apps/web/lib/work-management/mentions.ts`:
  - `parseMentions(body)` — extract unique `@handle`s (lowercased, first-seen order); email addresses and `@@` do not match.
  - `resolveMentions(body, roster)` — resolve handles against a caller-supplied roster to typed `{ handle, type: user|agent, id }` notification targets; unknown handles dropped; case-insensitive.
  - Pure, DB-free — the roster is the caller's concern.

## Verification
- 7 unit tests (unique/ordered/lowercased; email/@@ non-match; start-of-body; resolve known/unknown; case-insensitive). Typecheck clean.

## Deferred (needs live-portal verification, per operator)
- Wiring `resolveMentions` into the WorkItemMessage write path → create `Notification` rows for mentioned targets (the watch fabric; `notify.ts` spine).
- Real-time presence (who is viewing/working a work item).
- The comment/@mention/presence UI on the work-item surface.
