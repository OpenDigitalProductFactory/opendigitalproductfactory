---
status: active
---
# Plan — AI workforce "Right Now" activity view

- **Backlog item:** BI-1A68257F
- **Epic:** EP-FULL-OBS
- **Decisions:** DI-621EB7CA2134 (information design — workforce-primary, aggregate-safe, high confidence) · DI-B78B2A014223 (new lean surface over augmenting the Operations Map)
- **Date:** 2026-08-05

## Backlog coverage
- Decision: atomic
- Parent: BI-1A68257F
- Receipt: cmsgg9w490a9e01o4fnaknmow
- Rationale: The view is one cohesive surface — the action-outcome map + workforce-activity loaders produce nothing user-visible alone, the API exposes only what they compute, and the page renders nothing without both. No phase ships independent operator value, so the plan is atomic.
- Dependencies: none

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

## 2026-08-08 truth-and-inspection correction — BI-FDB25FA6

The live-install audit found that this page's private `LIVE_TASK_STATUSES` list
included `stalled`, `input-required`, and `auth-required`, while the canonical
`TASK_LIVE_STATES` contract intentionally defines only `working | active` as
live. As a result, old stalled schedules appeared under **Working now** even
though they could not block Self-Upgrade and had not heartbeated for weeks.

### Backlog coverage

- Decision: atomic
- Parent: BI-FDB25FA6
- Receipt: `cmskxrnit03al01o2ab7cuos3`
- Deliverable: `activity-truth` — converge Right Now and Self-Upgrade inspection
  on one trustworthy coworker-activity path.
- Rationale: a blocker link into a view that still labels stalled history as
  live would be misleading; correcting the view without making the initiating
  upgrade blocker inspectable leaves the operator's original journey broken.
  The two seams therefore ship and verify together.
- Dependencies: none

### Implementation sequence

1. Test-drive the liveness correction: stalled and waiting states must not enter
   `working`, while canonical `working` and `active` rows still do.
2. Replace the local status vocabulary with `TASK_LIVE_STATES`; retain quiet
   coworker/outcome behavior without creating a second status classifier.
3. Test-drive and add a contextual **Inspect AI workforce activity** link to the
   Self-Upgrade blocker band, using the existing `/platform/ai/right-now` route.
4. Verify the targeted tests and production build, then exercise both the
   zero-live-work and blocker-inspection states through the governed nonprod UX
   path.

### UX decision record

- Decision: link the coworker-specific Self-Upgrade blocker to the existing
  **Right Now** workforce view, without adding a second coworker-identity link.
- WWMD interaction: `DI-15DC5BCA696C`
- Confidence: high (margin `1.7886216977355875`).
- Rationale: one contextual action gives the operator a stable workforce-wide
  inspection surface while keeping upgrade recovery simple. The destination
  now shares the canonical `TASK_LIVE_STATES` definition, so the action does
  not direct operators into a contradictory status view.

### Risks and rollback

- Risk: a legitimately waiting task could disappear from the live band. This is
  intentional: waiting and stalled are not active execution and belong on an
  attention surface, not under **Working now**. This change does not delete or
  mutate any TaskRun.
- Risk: a generic Self-Upgrade blocker may not be coworker-related. The link is
  rendered only when blocker evidence identifies the coworker reasoning-loop
  surface.
- Rollback: revert the application commit. There is no migration or runtime-data
  rewrite.

## 2026-09-02 unattributed spend and platform work — BI-B3AB7FC9

Live finding: the local model runner was saturated by `reviewDesignDoc`
fan-outs (three `routeAndCall`s per review, ~100s each on the local model)
while this page read **Working now 0 / 37** and named nothing. Two causes:

- The review handlers passed no `agentId` / `threadId` / `buildId` to
  `routeAndCall`, so every call metered as `TokenUsage.agentId = "unknown"`,
  `contextKey = "routed-call"` — 30% of the day's tokens. The loader summed
  tokens only over roster coworkers, so that bucket vanished from the card.
- The deliberation TaskRun the review bootstraps carried no
  `currentAgentId`, so the "working now" projection (keyed on the owning
  coworker) had nowhere to put it.

Changes:

- `build-design-review-handler.ts` / `build-review-handlers.ts` carry the
  calling coworker, thread and build into every reviewer call and into
  `runBuildReviewDeliberation`; `orchestrator.ts` stamps
  `initiatingAgentId` / `currentAgentId` on a bootstrapped TaskRun.
  `routed-inference.ts` falls back to `build:<id>` for `contextKey` before
  the bare `routed-call` sentinel.
- `workforce-activity.ts`: **Tokens today** is now the whole ledger, with
  `tokensUnattributed` / `costUnattributed` for rows no roster coworker
  claims (the card flags a non-zero value). Live runs with no roster owner
  are returned as `platformWork` and rendered as **Platform work in flight**
  (title, status, source, build link, running-for) instead of an empty
  "no coworkers working" state.

Not in this change (filed separately): deliberation TaskRuns re-marked
`working` by the async runner after the orchestrator settles them, and the
build-resume job retrying the same failing review every 30 minutes with no
backoff.
