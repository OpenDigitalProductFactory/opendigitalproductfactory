# Plan — Restaurant owner attention reconciliation (BI-348766E5)

Spec: `docs/superpowers/specs/2026-07-22-restaurant-owner-attention-reconciliation-design.md`
BI: BI-348766E5 · coordinates BI-3DA1DFDC (PR #3387), BI-075F731F, BI-36807E68, BI-7D7EE150, BI-8EA88797

## Coordination

The reservation attention source, `covers`/dietary schema, and the row-specific Storefront Inbox
Confirm/Cancel labels are delivered by the sibling BI-3DA1DFDC PR (#3387). This PR is scoped to the
**complementary workspace-side reconciliation** so the two land cleanly without a duplicate source
or a Storefront Inbox merge collision.

## Phase 1 — Row-specific decision labels (fix 5): NOT via card copy

Investigated; the plain-language owner-copy contract (`owner-decision.test.ts` bans raw-title /
technical-acronym leakage; `AttentionInbox.test` hides the raw title) means a per-row *label* built
from the only per-row datum (the raw technical question) is impossible without breaking the
contract. Delivered instead by Phase 2 (demotion removes the repetition) + the pre-existing
`?attentionId=` exact deep link. No card-copy changes.

## Phase 2 — Demote the generic-decision flood (the substantive fix)

4. `apps/web/lib/attention/owner-routing.ts`: an unlinked corpus `ai-decision`
   (`coverage-gap`, no `blastRadius`) routes to `weekly-digest` (grouped advanced review) instead
   of `needs-you-now`; genuine/blocking decisions stay in `needs-you-now`.

## Phase 3 — Twin reservations queue

5. `apps/web/lib/twin/living-business-snapshot.ts`: distribute booking items — a reservations-keyed
   queue (index > 0) gets upcoming reservations soonest-first; the general queue (index 0) excludes
   them; honest `No upcoming reservations` empty label. Non-restaurant profiles unchanged.

## Phase 4 — Tests

6. Vitest: extend `owner-routing.test.ts` (demotion) and `living-business-snapshot.test.ts`
   (queue distribution + `isUpcomingReservation` / `isReservationQueueKey`).
7. Playwright: `e2e/restaurant-vertical-signal-consistency.spec.ts` compares the public booking
   context, `/storefront/inbox`, `/workspace`, and `/workspace/inbox`.

## Verification

- Merged-code typecheck via the shared local-integration sandbox (`tsc --noEmit`, green).
- Unit gates run in CI (worktree is source-only; the shared sandbox's vitest was drift-blocked by
  an unrelated infra defect — a known `fix/windows-local-integration-vitest` issue).
- e2e requires the live portal + seeded restaurant demo (`loadDemoBusiness("restaurant")`); its
  reservation-signal assertions light up once #3387's source is present.

## Backlog coverage

Closes the workspace-side half of BI-348766E5 (fixes 3/4/5 + smoke 7); fixes 1/2/6 are completed
jointly with BI-3DA1DFDC (#3387). Advances BI-8EA88797 (exact-target focusing), BI-36807E68
(vertical-signal-consistency fixture), BI-075F731F (owner cockpit surfaces reservation next-action).
