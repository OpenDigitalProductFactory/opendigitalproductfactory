# Plan — AI workforce "Right Now" activity view

- **Backlog item:** BI-1A68257F
- **Epic:** EP-FULL-OBS
- **Decisions:** DI-621EB7CA2134 (information design — workforce-primary, aggregate-safe, high confidence) · DI-B78B2A014223 (new lean surface over augmenting the Operations Map)
- **Date:** 2026-08-05

## Problem
The AI coworker workforce is "like people," but the portal had no view of **what
the coworkers are doing and have accomplished**. Resource metrics already exist
(portfolio Health tab); the gap is a *workforce* lens. Founder-approved HTML
prototype: the coworker is the unit — now, today's outcomes, the responsible
human, and where nobody is acting.

## Design (grounded)
Extends EP-FULL-OBS; no new contract. Source of truth for activity is the
workforce-activity loader over `TaskRun` / `ToolExecution` / `TokenUsage`; the
`action-outcome-map` is the curated translation from tool calls to business
outcomes. Resource load is NOT replicated — the page links to the Health tab.

### Route
`/platform/ai/right-now` (secondary-nav tab beside the Operations Map, which
keeps the deep topology/replay/forecast altitude).

### Data
- `lib/platform-runtime/action-outcome-map.ts` — `toolName → outcome` labels +
  `summarizeOutcomes`. Read tools excluded (lookups, not accomplishments);
  unmapped writes fold into "other actions"; each outcome carries a `sensitive`
  flag from `SENSITIVE_DATA_TOOLS` (HR/finance/customer/legal PII/financial).
- `lib/platform-runtime/workforce-activity.ts` — grouped aggregations keyed by
  `agentId`: live tasks (now / quiet), tool counts (today), tokens+cost (today),
  last-acted (30d). Emits per-coworker `now`, `didToday`, `handlesSensitive`,
  `humanSupervisorId`, `hitlTier`, and pulse KPIs including
  `quietOverThresholdCount` and `coworkersWithoutOwnerCount`.
- `app/api/platform/workforce-activity/route.ts` — `view_platform`-gated, no-store.

### Surface
- `page.tsx` server snapshot + `WorkforceNowShell` (polls 12s).
- Working list: now + today's outcome chips + tokens + human owner + Manage jump-offs.
- Quiet list: last-acted + gap note (inactivity is a signal) + owner + Manage.
- Pulse: working, actions today, tokens today (+cost), governance (quiet + no-owner).

### Data governance (load-bearing)
The viewing platform admin is not necessarily in HR/finance, so the view is
**aggregate-safe**: the digest is COUNTS with a sensitivity flag — never record
content — and offers no drill-in on sensitive items. `handlesSensitive` is a
colour-coded badge; details stay in the owning domain's authorized surfaces.
`humanSupervisorId` surfaces the human-in-the-loop accountable for each coworker;
a missing owner is itself a flagged governance gap.

## Non-goals
Replicating the Health-tab resource dashboards; per-transaction record display;
per-phase model resolver (lives on Runtime Health).

## Verification
- `action-outcome-map.test.ts` + `workforce-activity.test.ts` (11 tests) —
  outcome mapping, read exclusion, "other" bucket, sensitivity flagging,
  working/quiet split, no-owner counting, ordering. Injected Prisma double.
- Full local CI on the merged tree before merge.
