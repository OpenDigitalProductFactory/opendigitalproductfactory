---
status: active
---

# Human route visit counts: implementation plan

- **Backlog item:** `BI-C447E10F`
- **Epic:** `EP-2FB6C0CC`
- **Design:** [human route visit counts](../specs/2026-10-08-human-route-visit-counts-design.md)
- **Workroom:** `WC-D30B71D5`

## Outcome

Each signed-in person's page views are tallied per route pattern, with first and last visit times and a 30-minute visit window. Automation and agent sessions are left out. One read-only MCP tool returns the counts over the whole route inventory, and a visit never touches `AgentThread`.

## Steps

The work ships as one PR. The steps are ordered so that each one is testable before the next one uses it.

1. **Model and migration.** Add `RouteVisitTally` with its `/// @dpf` tag to `packages/db/prisma/schema/ai-coworker.prisma`, plus the `User.routeVisitTallies` back-relation. Add migration `packages/db/prisma/migrations/20261008010000_route_visit_tally/`, the generated data-impact manifest and the sensitivity entry. Run `pnpm --filter @dpf/db exec prisma generate` and the model metadata guard.
2. **Session origin.** Add `sessionOrigin?: "automation"` to `AutomationSessionClaims` and set it in the automation sign-in route. In `apps/web/lib/govern/auth.ts`, copy it through the `jwt` and `session` callbacks and add it to the `DpfSession.user` type. Update the automation sign-in tests.
3. **Route matcher.** Add `apps/web/lib/telemetry/route-pattern.ts`, exporting `matchRoutePattern(pathname)` over `route-audience.generated.json`. Static segments beat `[param]`, which beats `[...slug]`. A trailing slash and a query string are stripped. An unmatched path returns null.
4. **Actor rule and writer.** Add `apps/web/lib/telemetry/route-visits.ts`:
   - `classifyVisitActor(sessionUser, principalKind)` returns `"human"` or an exclusion reason.
   - `writeRouteVisit(db, { userId, routePattern })` runs the single upsert from spec §4.3.
   - Add the server action `recordRouteVisit({ pathname })` in `apps/web/lib/actions/route-visits.ts`. It never throws.
5. **Beacon.** Add a `RouteVisitBeacon` client component (renders nothing) under `apps/web/components/telemetry/`, mounted in `apps/web/app/layout.tsx` and fired on each `usePathname()` change.
6. **Read tool.** Add `get_route_visit_counts` to a `route-visits-pack.ts` under `apps/web/lib/mcp/packs/`:
   - `sideEffect: false`, with the `registry_read` grant mirrored in `TOOL_TO_GRANTS`.
   - Registered in `pack-registry.ts`.
   - It joins the tally to the inventory, returns zero rows and never returns user ids.
7. **Docs.** Add a short section to the route inventory documentation on regenerating dispositions from the tool. Set the spec status to `accepted`.

## Verification

- Unit tests:
  - the matcher: static, dynamic and catch-all routes, trailing slash, unmatched paths;
  - the actor rule: automation origin, agent principal, customer session, a human admin whatever the email;
  - the writer: one statement against `RouteVisitTally` and none against `AgentThread`;
  - the 30-minute window, against a real upsert in the migration test harness where one exists, otherwise against the SQL text;
  - the read tool: every inventory route, zero rows, no user ids.
- `pnpm --filter web typecheck`, the model metadata guard and the schema regression guard.
- The migration applies on the dev install after deploy.
- Live check on the dev install after deploy:
  - a signed-in human page view increments its route in `get_route_visit_counts`;
  - an `issue_ux_verification_sign_in` session's page views do not.

## Traceability

Requirements are the spec's §8 objectives, and verification is its acceptance rows. Contracts and flows name the code seam and the operator path the deliverable changes.

| Deliverable | Requirements | Contracts | Flows | Verification |
|---|---|---|---|---|
| route-visit-tally | OBJ-RV-COUNT, OBJ-RV-HUMAN, OBJ-RV-RETENTION, OBJ-RV-READ | contract-route-visit-tally-model, contract-session-origin-claim, contract-get-route-visit-counts | flow-human-page-view-to-tally, flow-review-reads-route-counts | AC-RV-COUNT, AC-RV-HUMAN, AC-RV-RETENTION, AC-RV-READ |

- `contract-route-visit-tally-model`: the `RouteVisitTally` model, its `@dpf` tag and its migration (steps 1 and 4).
- `contract-session-origin-claim`: `session.user.sessionOrigin`, set only by the automation sign-in (step 2).
- `contract-get-route-visit-counts`: the read-only MCP tool's response shape from spec §4.4 (step 6).
- `flow-human-page-view-to-tally`: a person opens a page, the beacon fires, the actor rule passes, the tally row increments (steps 3 to 5).
- `flow-review-reads-route-counts`: a reviewer or coworker calls `get_route_visit_counts` and regenerates the disposition table (step 6).

## Rollback

Revert the PR. The beacon, the action, the tool and the claim go with it. A follow-up migration drops the table. Only derived telemetry is lost.

## Backlog coverage

- Decision: atomic
- Parent: `BI-C447E10F`
- Rationale: the steps are sequencing, not independent deliverables. A tally without a writer counts nothing. A writer without the actor rule would count automation, which the acceptance forbids. A read tool without the tally has nothing to read. None of them ships value on its own.
- Receipt: blocked-by: the coverage receipt is minted by record_plan_backlog_coverage at this plan's commit and lives in the MCP substrate; writing its id here would move the head that the plan review binds to
- Deliverables:
  - route-visit-tally -> `BI-C447E10F`; depends on: none
