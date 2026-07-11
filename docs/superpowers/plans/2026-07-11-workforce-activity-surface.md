# Workforce Activity Surface (BI-D80A1C3E)

## Problem
`/employee` (the Workforce surface) was an HR roster: role definitions (most
unassigned) plus sparse employee records. It answered "who exists," not "what is
the workforce doing for customers/business outcomes." As a PRIMARY outside-in
surface it should lead with workforce ACTIVITY and demote the directory to a
secondary drill-in.

## Approach
Add a workforce-activity lead to the existing `?view=workforce` tab, above the
unified human+AI roster (which becomes the secondary "Directory" section).

Two composed signals:

1. **Workforce at work** — in-flight `FeatureBuild`s (non-terminal, not
   abandoned) that the AI + human workforce owns, each with its driving owner
   (accountable employee or claiming agent) and phase. This is the live
   customer/business work.
2. **Needs you** — a derived, ordered "needs-operator" concern list:
   - **Unassigned role with an SLA** — a `PlatformRole` with `slaDurationH > 0`
     and zero assigned users (e.g. Operations Manager with a 4h SLA and nobody
     holding it: the SLA is unowned). Severity scales with SLA tightness.
   - **Pending approval** — a build gated at a human phase (`review`/`ship`).
   - **Pending handoff** — the latest `PhaseHandoff` on an active build that
     carried open issues forward.

## Substrate (reused, no schema change)
- `PlatformRole.slaDurationH` + `_count.users` — SLA + assignment count.
- `FeatureBuild` (`phase`, `claimedByAgentId`, `accountableEmployee`, `kind`,
  `abandonedAt`) — active work + approval gates.
- `PhaseHandoff.openIssues` — handoff concern signal.
- Existing `loadWorkforceRoster` (BI-554E1A14) — the secondary directory.

## Files
- `apps/web/lib/workforce/workforce-activity.ts` — pure `deriveWorkforceConcerns`
  (severity + deterministic ordering) + `loadWorkforceActivity` Prisma loader.
- `apps/web/lib/workforce/workforce-activity.test.ts` — unit tests for the pure
  concern derivation (classification + ordering + edge cases).
- `apps/web/components/employee/WorkforceActivityPanel.tsx` — presentational lead.
- `apps/web/app/(shell)/employee/page.tsx` — wires the lead above the roster.

## Testing
Unit-tested the pure "needs-operator" derivation: unassigned-with-SLA
classification, assigned/no-SLA roles excluded, approval + handoff concerns,
open-issue singularization, and the severity → SLA → kind → id ordering.
