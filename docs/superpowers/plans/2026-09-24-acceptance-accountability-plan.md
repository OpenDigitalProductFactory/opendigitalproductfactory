---
status: active
---

# Acceptance accountability: implementation plan

Implements BI-5F3D6A37 against
[the design](../specs/2026-09-24-acceptance-accountability-design.md). The
design's acceptance criteria AC-AA-01 through AC-AA-06 are this plan's
definition of done.

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Phase 1: owed acceptance and age (BI-04140C98)

Independently shippable. It changes no behaviour until the sweep calls it.

- New `apps/web/lib/backlog/acceptance-sweep/owed-acceptance.ts`:
  - `projectOwedAcceptance({ decision, authorAgentId, resolveOwner })` is pure.
    It returns `{ owed[], owner, unroutable[], closable }`. `closable` means the
    completion verdict is `allowed`.
  - Owner resolution takes a port wrapping `resolveInitiativeReviewerRecovery`
    (`lib/tak/initiative-readiness-tool-grants.ts:221`) with
    `currentAgentId = authorAgentId`. The port reads only `targetAgentId` for
    the `acceptance-reviewer` and `delivery-coordinator` rows. Any other
    outcome goes to `unroutable` with its reason.
- New `acceptance-age.ts`: `acceptanceEnteredAt(activities, createdAt)` returns
  `{ enteredAt, ageBasis: "entry" | "created" }`. The input is the latest
  `status_change` activity whose `payload.to === "awaiting-acceptance"`.
  `fileAcceptanceMiss` rows (from and to the same status) never count as
  entry, because their `to` equals the status they left.
- New `owed-snapshot.ts`: writes a `BacklogItemActivity` of
  `kind: "acceptance_owed"` only when the canonical JSON of
  `{ owed codes, owner, unroutable }` differs from the last snapshot.
- Tests (`dpf-tdd`):
  - fixtures of the three live shapes: medium feature, small fix, and item
    without an entry row;
  - author exclusion;
  - an item with no granted coworker is unroutable;
  - no snapshot is written when nothing changed;
  - `updatedAt` is never read, asserted by passing a sentinel.
- Verification: `pnpm --filter web exec vitest run lib/backlog/acceptance-sweep`,
  then `pnpm --filter web typecheck`.

## Phase 2: the sweep (BI-DF255666), after phase 1

- `packages/db/src/acceptance-sweep-config.ts` holds these values, next to
  `decision-engine-review-config.ts`:
  - task id `acceptance-sweep-daily`
  - agent `AGT-WS-PORTFOLIO`
  - cron `0 5 * * *`
  - `ACCEPTANCE_AGED_DAYS = 14`
  - `ACCEPTANCE_SWEEP_PAGE_SIZE = 100`
  - `ACCEPTANCE_SWEEP_ROUTE_LIMIT = 10`
- `packages/db/src/seed-acceptance-sweep.ts` mirrors
  `seed-decision-engine-review.ts`. It is called from `seed.ts` next to it.
- `apps/web/lib/operate/scheduled-jobs/agent-task-kind.ts` adds
  `"acceptance-sweep"`. Its test asserts that the set is closed.
- `apps/web/lib/actions/agent-task-scheduler.ts` adds a deterministic branch
  next to `:252`, which calls `executeAcceptanceSweepTask`.
- `apps/web/lib/backlog/acceptance-sweep/acceptance-sweep-task.ts` is the
  executor:
  - It selects the page of items: those with no snapshot first, then the
    oldest snapshot.
  - It computes readiness through `getBacklogItem` as the reviewer dispatch
    already does (`server-reviewer-dispatch.ts:127-133`), so there is one
    projection path.
  - It writes the snapshots and upserts the standing `Acceptance` steward room
    (pattern: `decision/concierge-sweep-runner.ts:147-165`) with a
    `acceptance-sweep` run activity. The activity carries the counts by age
    band, closable, unroutable by code, the `ageBasis: created` count and the
    revisit period.
  - It updates `lastRunAt` and `nextRunAt` like the decision review.
  - Routing is behind `ACCEPTANCE_SWEEP_ROUTING = false` until phase 3.
- Tests:
  - page ordering;
  - idempotent re-run (no duplicate snapshots);
  - the run summary counts;
  - a scheduler branch test next to the existing decision-review one.
- Migration: none. Verify with the full seed against the local-CI Postgres
  in `pnpm run pregate`.
- Live check: run the task once on the development install and record the run
  activity id as evidence for AC-AA-01 and AC-AA-02.

## Phase 3: coworker routing (BI-C1781121), after phase 2

- `acceptance-sweep/route-aged-item.ts`: for each aged item, oldest first, up
  to the route limit, it upserts a `scheduled-steward` Workroom with:
  - `idempotencyKey: acceptance:<itemId>`
  - `outcomeAnchor: { kind: "backlog-item", id }`, with **no**
    `backlogItemId`
  - `ownerUserId`: the install operator, resolved as the seed does
  - a single stage `agent:<owner>`, whose advance is a non-governed
    evidence-recorded condition. The prompt lists the owed codes, their
    `nextAction`, and the item's acceptance criteria from its body.
- Existing rooms are not re-created. An item whose room already ran and is
  still owed is reported `routed-unresolved` with its age.
- Verify first, then set: before phase 3 enables routing, confirm on the
  running app that a room with an `agent:` non-governed stage reaches
  `dispatch_agent` (`work-management/drive-resolution.ts:311-376`) and that
  the resulting TaskRun lets `record_execution_evidence` /
  `record_initiative_evidence` record. If either does not hold, the fallback
  is to stop and re-plan, not to route to a person.
- Tests:
  - the route limit;
  - no `backlogItemId` on the room, with a claim-conflict test proving that
    the author can still claim;
  - an unroutable item gets no room;
  - re-run idempotence.
- Live proof, AC-AA-04: on the development install, one aged item is routed
  by a real sweep run, the dispatched coworker records its acceptance
  evidence, and no person or AI client is involved. Record the TaskRun id and
  evidence activity ids.

## Phase 4: surfaces (BI-CEC60185), after phase 1

- `apps/web/components/ops/OpsClient.tsx:70-71` (epic progress) and
  `apps/web/lib/workspace-home/command-center.ts:346-348`: add
  `awaitingAcceptance` and `agedAcceptance` beside `done`. The aged count uses
  phase 1's age function. Style with `--dpf-*` tokens and compose report-kit
  primitives (AGENTS.md §9).
- Tests: component and loader unit tests for the counts.
- UX verification: `dpf-ux-fit-review`, then a check on the running app
  through the shared nonproduction lease (AC-AA-05).

## Risks and rollback

- **Readiness cost per run.** It is bounded by the page size (design §7). If a
  run exceeds its tick, lower the page size. The config is one constant.
- **Wrong owner.** The owner comes only from the grant-backed lane resolver,
  and an ungranted role is unroutable, not guessed. Rollback: set
  `ACCEPTANCE_SWEEP_ROUTING = false`. Snapshots and summaries continue.
- **Room sprawl.** There is at most one room per item (idempotency key) and at
  most `ROUTE_LIMIT` new rooms per day. Existing reaper and liveness rules
  apply to steward rooms.
- **Evidence written by the wrong actor.** Closure still passes the completion
  gate, which refuses self-review where independence is required.
- Each phase is its own PR and reverts cleanly on its own. Phases 2 to 4 add no
  schema.

## Backlog coverage

Umbrella: BI-5F3D6A37. Decision: `decomposed`.

| Deliverable | BI | Depends on |
|---|---|---|
| Owed acceptance and age | BI-04140C98 | — |
| Acceptance sweep task | BI-DF255666 | BI-04140C98 |
| Coworker routing | BI-C1781121 | BI-DF255666 |
| Delivery surfaces | BI-CEC60185 | BI-04140C98 |

Coverage receipt: recorded with `record_plan_backlog_coverage` after spec
approval mints the objective baseline.
