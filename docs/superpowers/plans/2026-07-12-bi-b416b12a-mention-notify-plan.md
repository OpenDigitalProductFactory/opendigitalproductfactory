# Implementation Plan — BI-B416B12A: @mention → notification wiring

**BI:** BI-B416B12A (EP-WORK-CONVERGENCE) · **Date:** 2026-07-12 · **Status:** mention-notify write core implemented; human-handle roster + comment UI + presence deferred.

## Design grounding
Source of truth: convergence memo (`docs/superpowers/specs/2026-07-11-collaborative-work-management-convergence-memo.md` §6.6) + the earlier B416B12A plan (`2026-07-11-bi-b416b12a-mentions-plan.md`). **Extends** that plan. Substrate check: `parseMentions`/`resolveMentions` already merged; `WorkItemMessage` model exists but had **no `.create` write path anywhere** in the app; `Notification` is user-only (FK to User, no agentId); coworker roster via `coworker-record/roster.ts loadRoster()`.

## This slice
- `lib/work-management/mention-notify.ts` — pure `buildMentionNotifications`: resolves @mentions against a roster → one Notification spec per mentioned human + list of mentioned coworker ids (agents have no user inbox).
- `lib/work-management/post-work-item-comment.ts` — the comment write path: creates the `WorkItemMessage` (messageType "comment"), fans out Notifications to mentioned humans (skips the author's self-mention), records `mentionedAgentIds` on the message's `structuredPayload`. Structurally typed on db + injected roster → unit-testable.

## Verification
- 9 unit tests (fan-out human-vs-agent, dedupe, self-mention skip, structuredPayload omission, message shape). Typecheck.

## Deferred (genuine substrate dependencies + UX)
- **Human @mention roster:** User has no `@handle`/username field (email+name only). A correct human roster needs a handle convention — the "use server" wrapper that assembles the roster and the handle field are the remaining substrate work.
- Comment-box UI on the work-item surface; real-time presence (who's viewing/working the item).
- Live-portal validation.
