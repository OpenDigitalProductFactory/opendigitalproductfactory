---
status: proposed
---

# Human route visit counts: design

- **Backlog item:** `BI-C447E10F`
- **Epic:** `EP-2FB6C0CC` (navigation by activity). This item was deferred out of the areas PR #5750 because it changes data, not navigation.
- **Workroom:** `WC-D30B71D5`
- **Principles:** `count-the-operations-to-outcome`, `absorb-dont-adopt`, `verify-substrate-before-proposing-new`

## 1. Problem

DPF has no page-view or route telemetry. The 2026-09-25 navigation review had to infer "never used" from a side effect. `AgentCoworkerShell` opens an `AgentThread` keyed `coworker:<path>` the first time a user lands on an exact path (`apps/web/lib/actions/agent-coworker.ts`, `getOrCreateThreadSnapshot`). That signal is weak in four ways:

- It records a first visit and never counts a repeat.
- It only exists for pages inside `(shell)`.
- It cannot tell a person from an agent driving the browser. On 08-24 the shared admin login opened about 40 platform pages in 9 minutes, which was a sweep, not a person.
- Review walks create rows. The review itself added rows on 09-25.

The navigation epic decides what to move, merge or retire by how often people reach each surface. It needs repeat counts for humans only, per route, from the running portal.

## 2. Goal and non-goals

**Goal.** For each signed-in human and each route pattern, keep a visit count, the first visit and the last visit. Agent and automation sessions are left out. A read-only MCP tool returns the counts over the whole route inventory.

**Non-goals.**
- No analytics stack, event stream, dashboard product or third-party script (`absorb-dont-adopt`).
- No per-visit event rows, referrer, user agent, IP address, query string or concrete path.
- No anonymous or customer-portal counting. Only staff sessions (`type: "admin"`) are counted.
- No change to coworker thread behaviour. The `coworker:<path>` thread stays as it is.

## 3. Substrate check: why the existing hosts do not fit

The item asks to reuse the thread snapshot, or an existing per-user preference or activity table. Each was checked on `979fd38e`.

| Candidate | Why it does not fit |
|---|---|
| `AgentThread` (`packages/db/prisma/schema/ai-coworker.prisma`, `model AgentThread`) | `updatedAt` is Prisma `@updatedAt`, so every client update of a counter column bumps it. Retention selects threads by that column (`apps/web/lib/operate/retention/policies.ts`, `agentThread: { customPurge: purgeStaleAgentThreads, timestampField: "updatedAt" }`, 545 days). A visited thread would never age out, so a person's chat history would be kept for as long as they kept visiting the page. The thread is also keyed by exact path, not route pattern, and exists only inside `(shell)`. Purging a thread would erase that page's visit history. |
| `UserFact` | It holds facts the coworker recalls into model context (`useCount` and `lastAccessedAt` count recalls). Visit tallies would enter prompt context and the supersession lifecycle. |
| `AdminActivity` | A security-audit ledger of admin tool calls, one row per event, 365 days, keyed by `toolName`. Page views are not tool calls, and one row per view is the event stream this design rejects. |
| `EmployeeSchedulingPreference`, `UserSkill`, `UserGroup` | Domain records with their own lifecycles, unrelated to navigation. |

No existing model holds one row per (user, route pattern) with a retention axis of its own. Using any of the above either puts a retention-sensitive host at risk or mixes telemetry into a business or audit record. So this design adds **one** narrow aggregate model. It is the smallest substrate that meets the retention rule in the acceptance criteria. It replaces the first-visit thread as the review's evidence source, and it adds no service, package or job.

## 4. Design

### 4.1 Model

```prisma
/// Per-person, per-route-pattern page visit tally for staff sessions (BI-C447E10F). Counts humans only; one row per user and route pattern, never per visit. A row with no visit for 400 days ages out on its own lastVisitedAt, so a visit never extends any other row's retention.
/// @dpf lifecycle=telemetry-bounded retention=400d sensitivity=internal categories=telemetry owner=platform-architecture steward=data-steward timeAxis=lastVisitedAt
model RouteVisitTally {
  id             String   @id @default(cuid())
  userId         String
  routePattern   String
  visitCount     Int      @default(1)
  firstVisitedAt DateTime @default(now())
  lastVisitedAt  DateTime @default(now())
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, routePattern])
  @@index([routePattern])
  @@index([lastVisitedAt])
}
```

- **Retention.** The tag declares `telemetry-bounded retention=400d timeAxis=lastVisitedAt`. The existing retention sweep builds its policy from the catalog comment (`apps/web/lib/operate/retention/declarations.ts`), so the tally needs no `RETENTION_OVERRIDES` entry. 400 days keeps a full year plus a review cycle.
- **No `@updatedAt`.** `lastVisitedAt` is written only by the writer in 4.3. No other field can move it.
- **PII.** The only personal data is `userId`. `routePattern` is a route template such as `/ops/workrooms/[capsuleId]`, never a concrete path, so it cannot carry a record id, a name or a query string.
- **User deletion.** Rows cascade with the `User`, as `AgentThread` does.

### 4.2 Who counts: the session actor

A visit is counted only when the session's actor is a human. This is decided from the session and its principal, never from the email address.

1. **Session origin.** The automation sign-in (`apps/web/lib/govern/automation-sign-in.ts`, reached through `issue_ux_verification_sign_in`) encodes its own Auth.js session claims (`AutomationSessionClaims`, minted in `app/api/automation/sign-in/route.ts`). It gains a claim `sessionOrigin: "automation"`. The `jwt` and `session` callbacks in `apps/web/lib/govern/auth.ts` copy it onto `session.user.sessionOrigin`. A password or SSO sign-in never sets it.
   - Principal kind alone cannot do this job. `ensureAutomationPersona` links the persona through `syncUserPrincipal`, which gives every `User` a `kind: "human"` principal (`apps/web/lib/identity/principal-linking.ts`). Today an automation session carries `type: "admin"` and a human principal, so it looks exactly like a person's session.
   - Re-kinding the persona's principal was considered and rejected. Authority and population inference read `Principal.kind` (`inferPopulation` in `effective-auth-context.ts`), so a new kind would change what the persona may do, not only whether it is counted.
2. **Principal kind.** The writer reads `Principal.kind` for `session.user.principalId`. Only `kind = "human"` counts. An agent principal (`kind = "agent"`) holding a browser session is excluded.
3. **Session type.** Only `type = "admin"` (staff) sessions count. Customer-portal sessions are out of scope.

The rule lives in one pure function, `classifyVisitActor(session, principalKind)`, which returns `"human"` or a typed exclusion reason (`"automation-session" | "non-human-principal" | "not-staff" | "no-principal"`). The writer counts only `"human"`.

**Residual risk, stated.** An agent that types a person's password into a browser gets a human session, and no server-side signal can tell. The existing doctrine already says platform browser drives go through `issue_ux_verification_sign_in`. This design makes that path self-excluding, and it does not claim to detect a shared-password drive.

### 4.3 Writing a visit

- **Where.** A client component, `RouteVisitBeacon`, is mounted once in the root layout (`apps/web/app/layout.tsx`), so pages outside `(shell)` are counted too. On each `usePathname()` change it calls the server action `recordRouteVisit({ pathname })`. The action never throws to the page and never blocks rendering. A failed write is dropped and logged at debug level.
  - The nearest existing pattern is `recordUserSeen` (`apps/web/lib/identity/last-seen.ts`), called from the server `(shell)` layout. It cannot carry visits, because a layout does not re-render on client-side navigation and so never sees most page changes. The new action follows its error handling: errors are swallowed and the write is conditional.
- **Normalisation.** `matchRoutePattern(pathname)` maps a concrete path to a route template from the generated page inventory, `apps/web/lib/navigation/route-audience.generated.json` (`routes[].routePath`). That file is derived from `apps/web/lib/ea/route-manifest.json` and is rebuilt by `pnpm route:sync`. The only existing lookup, `getRouteNavRecord`, matches exact paths, so no segment matcher exists yet. Static segments win over dynamic ones, and the longest match wins. A path that matches no inventory route writes nothing, which bounds cardinality to the inventory.
- **Visit window.** A visit is a page view more than 30 minutes after the same person's last counted view of the same route pattern. That is the inactivity window Google Analytics and Matomo use for a session. A reload or a quick back-and-forth inside the window updates `lastVisitedAt` but not `visitCount`.
- **One statement.** The write is a single upsert:

  ```sql
  INSERT INTO "RouteVisitTally" (id, "userId", "routePattern", "visitCount", "firstVisitedAt", "lastVisitedAt")
  VALUES ($id, $userId, $pattern, 1, now(), now())
  ON CONFLICT ("userId", "routePattern") DO UPDATE SET
    "visitCount" = "RouteVisitTally"."visitCount"
      + CASE WHEN "RouteVisitTally"."lastVisitedAt" < now() - interval '30 minutes' THEN 1 ELSE 0 END,
    "lastVisitedAt" = now();
  ```

  It is concurrency-safe and touches no other table. It is written as a typed `prisma.$executeRaw` in `apps/web/lib/telemetry/route-visits.ts`.

### 4.4 Reading the counts

A read-only MCP tool, `get_route_visit_counts`, returns one entry for **every** route in the generated inventory, including routes with zero visits:

```ts
{
  countingSince: string | null;   // earliest firstVisitedAt; the tally cannot see before it existed
  windowDays: number;             // optional filter: only visits whose lastVisitedAt is inside the window
  routes: Array<{
    routePattern: string;
    audience: RouteAudience;
    destinationKind: RouteDestinationKind;
    humanVisitors: number;        // distinct users
    visits: number;               // sum of visitCount
    lastVisitedAt: string | null;
  }>;
}
```

- It joins the tally to the route inventory in `route-audience.generated.json`, so the review's disposition table and the route inventory can be regenerated from one call, with the zero rows that "never used" calls rest on.
- It returns counts, never user ids. A route with one or two human visitors reports the count only.
- It is gated by the existing `registry_read` grant, which the reviewer and external coworkers already hold, and declared read-only in the MCP tool registry.

### 4.5 What it does not touch

- `AgentThread`, its retention and `getOrCreateThreadSnapshot` are unchanged.
- No new grant, job, route segment or navigation entry.

## 5. Research and benchmarking

| Product | How it stores views | How it keeps out bots | What DPF takes | What DPF rejects |
|---|---|---|---|---|
| **Umami** (open source, Postgres or MySQL) | One `website_event` row per view: `session_id`, `url_path`, `url_query`, `referrer_*`, `created_at`. | User-agent bot detection. | The `url_path` column. Counting needs only a path dimension. | One row per view. Counting does not need it, and per-view rows are what grows without bound. |
| **Plausible** (open source, ClickHouse) | An `events` table: `pathname`, hashed visitor id, `timestamp`. Visitor ids rotate daily so no personal data is kept. | User-agent and referrer-spam lists. | Minimal data: no IP and no personal data beyond what the count needs. | A columnar store and an event stream. That is a new dependency, which `absorb-dont-adopt` rules out. |
| **Matomo** (open source, MySQL) | `log_visit` plus `log_link_visit_action`, with a visit ending after 30 minutes of inactivity. Reports are pre-aggregated into archive tables. | User-agent detection plus excluded IPs and user ids. | The 30-minute visit window, and aggregating counts instead of keeping raw rows. | Raw logs, then archiving: two stores and a job. |
| **Discourse** (open source, Postgres) | `user_visits`: one row per user per day (`user_id`, `visited_at`, `posts_read`, `mobile`). | It counts signed-in users only. | The aggregate row keyed by user plus a dimension, inside the application's own database. | Day granularity. DPF needs route granularity, and the day can be read from `lastVisitedAt`. |

**Standards followed.**
- **Visit window.** The 30-minute inactivity window is the de facto web-analytics session definition (Google Analytics session timeout default, Matomo `visit_standard_length`).
- **Bot exclusion.** The industry list for invalid traffic is the IAB/ABC International Spiders & Bots List, matched on user agent. DPF departs from it on purpose. Every counted request is already authenticated, and the platform's own automation signs in through one governed route. A session claim minted there is exact. A user-agent list would miss a headless browser that sends a normal user agent, and it is a third-party list to licence and refresh.

**Gap the design fills.** None of the four knows who the actor is. DPF does, because every session resolves to a `Principal`, so exclusion can be exact rather than heuristic.

## 6. Alignment checklist

1. **Deployment contracts.** A migration adds one table. `prisma migrate deploy` at portal boot applies it on every install. No API response shape, install path or self-upgrade step changes. The new MCP tool is additive.
2. **Canonical identity.** Counts key on `User.id`, and the actor decision reads `Principal.kind`. No parallel identity field.
3. **No parallel utilities.** Route templates come from the existing generated inventory, and retention from the existing catalog-driven sweep. The one new helper, `matchRoutePattern`, has no existing equivalent. The repository has no pathname-to-template matcher.
4. **Rulebook.** No rule is restated. The model tag follows the data model stewardship runbook.

## 7. Data impact

- New table `RouteVisitTally`. No existing rows change, and the migration is additive and reversible by dropping the table.
- Expected size: users × routes visited. On the dev install that is about 10 users × 371 routes, under 4,000 rows. A large install with 500 staff tops out near 185,000 rows. That is far below the steward's `growth-without-disposition` threshold, and the declared retention removes rows anyway.
- Sensitivity `internal`. Classification goes into `packages/db/src/table-classification.ts` through the tag, and the generated `*.data-impact.json` manifest ships in the same PR.

## 8. Objectives and acceptance

**OBJ-RV-COUNT:** Every human visit to a portal page is tallied per person and per route pattern, with a visit count and first and last visit times, using a 30-minute visit window.

**OBJ-RV-HUMAN:** Visits from automation or agent-driven sessions are excluded. The decision comes from the session's origin and its principal kind, never from the email address.

**OBJ-RV-RETENTION:** Writing a visit never extends the retention of any other row. The tally declares its own telemetry retention and holds no personal data beyond the user id.

**OBJ-RV-READ:** A read-only MCP read returns per-route counts across the whole route inventory, zero-visit routes included, so the review's dispositions and the route inventory can be regenerated from it.

| Acceptance | Objectives | Statement |
|---|---|---|
| AC-RV-COUNT | OBJ-RV-COUNT | Unit tests show that a human visit to a concrete path creates one row keyed by its route template, a second view within 30 minutes leaves `visitCount` unchanged and moves `lastVisitedAt`, a view after 30 minutes increments it, and a path outside the inventory writes nothing. |
| AC-RV-HUMAN | OBJ-RV-HUMAN | Unit tests show that `classifyVisitActor` excludes an automation-origin session, an agent-kind principal and a customer session, and counts a human staff session whatever its email, including `admin@dpf.local`. The automation sign-in session carries `sessionOrigin: "automation"`. |
| AC-RV-RETENTION | OBJ-RV-RETENTION | A test asserts the writer issues one statement against `RouteVisitTally` and none against `AgentThread`. The model's `@dpf` tag passes `check-model-metadata-tags`, the migration applies on the dev install, and the data-impact manifest ships in the PR. |
| AC-RV-READ | OBJ-RV-READ | A test shows that `get_route_visit_counts` returns every inventory route, with zero rows included and no user ids. On the dev install, after deploy, a signed-in human visit increments its route and an `issue_ux_verification_sign_in` visit does not. |

## 9. Rollback

One PR. Reverting it removes the beacon, the action, the tool and the claim. A follow-up migration drops the table. The tally holds only derived telemetry, so dropping it loses no business record.
