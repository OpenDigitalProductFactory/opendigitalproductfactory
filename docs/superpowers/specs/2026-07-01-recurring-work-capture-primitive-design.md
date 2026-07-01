# Design: Shared Recurring Work-Capture Primitive

**Status:** reviewed (v2) — GO with the §9 resolutions · **Epic:** EP-MARKETING-EXEC → platform epic TBD · **BI:** BI-4C5F7A2D
**Decision basis:**
- Approach: WWMD kernel recommended `shared-primitive` (composite 1.34, margin 0.34, high; *Architecture Over Shortcuts* +0.58). Operator ratified.
- Host entity (open Q3, elevated by internal review): WWMD kernel recommended **`distinct-ownwork-entity`** (composite 1.455, margin 0.585, high; no commandment conflict) — a new org-scoped `WorkEngagement`, NOT overloading `CoworkerEngagement`.
- Reviewed: internal chief-architect completeness review (conditional NO-GO → GO after §9 edits) + external/industry validation (structure validated; 7 operational gaps). Both folded into **§9 (authoritative — supersedes §4–§8 where they differ)**.

## 1. Problem

Marketing coworker work is **long-running and recurring** (a campaign runs for weeks; content publishes on a cadence), but there is no substrate that captures it as trackable, recurring work:

- `Activity` (CRM) is point-in-time and account-scoped — wrong shape.
- `CoworkerEngagement` is a **cross-agent service-request** model (created via `request_coworker_engagement`/A2A), not an own-work model. It has **no recurrence**, **no activity timeline**, and **no accept/complete transition API** despite having `acceptedAt`/`completedAt` columns.
- `WorkCapsule`/`WorkCapsuleActivity` is platform-dev-scoped.
- Recurrence exists in exactly one place — `StorefrontBooking` (`recurrenceRule`, `recurrenceEndDate`, self-referential `parentBookingId`/`childBookings`) — but as bespoke embedded columns, not a reusable primitive.

The kernel rejected both shortcuts (bake recurrence into engagement; marketing-only special-case) in favour of a **shared primitive** that engagement, marketing, and StorefrontBooking all compose.

## 2. Goals / non-goals

**Goals**
- A reusable way to express **recurrence** (rule + horizon + parent/child instances) shared across consumers.
- A reusable **activity timeline** so any long-running work unit has an append-only, queryable event log.
- A reusable **status-transition state machine** (the engagement lifecycle is missing this entirely).
- First consumer: the marketing coworker (campaign = long-running work unit with recurring content activities).
- No regression to StorefrontBooking; a clear (later) migration path for it onto the shared primitive.

**Non-goals (this spec)**
- Rewriting StorefrontBooking now (adopt-later, proven by making the primitive fit it).
- A calendar UI. This is the data + service substrate.
- External publish behaviour (unchanged; still stubbed + human-approved).

## 3. Prisma reality check (constrains the design)

Prisma has **no schema mixins/inheritance**. "Shared primitive" therefore resolves to one of:
- **(S) Shared standalone entity** referenced by FK (a real row other models point at), or
- **(C) Shared convention + shared code** — a standard column-set each consumer adopts, plus one TypeScript library that operates on it, with a conformance test guarding the convention.

Referential integrity (a DPF data-model stewardship value) favours real FKs (S) where the concept is a genuine shared entity, and disfavours **polymorphic** tables (a single `subjectType`+`subjectId` with no FK) which silently lose integrity.

## 4. Proposed shape (recommended; alternatives in §6)

Two small shared entities + one shared library. Three sub-primitives:

### 4.1 Recurrence — shared entity `RecurrenceSchedule` (option S)
A first-class value object other work units reference by nullable FK.

```prisma
model RecurrenceSchedule {
  id            String    @id @default(cuid())
  rrule         String    // RFC-5545 RRULE, e.g. "FREQ=WEEKLY;BYDAY=MO"
  timezone      String    @default("UTC")   // IANA tz the rule is evaluated in
  anchorAt      DateTime  // DTSTART
  until         DateTime? // UNTIL bound (null = open-ended; count bounded via rrule COUNT)
  active        Boolean   @default(true)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  // Back-relations added per consumer (engagements, campaigns, ...).
}
```
Consumers add `recurrenceScheduleId String?` + relation. Occurrences are **materialized as instance rows in the consumer's own table** (the StorefrontBooking pattern — parent/child self-relation), created eagerly over a bounded horizon and topped up by a ticker. This keeps per-instance status/data on the consumer where it belongs, and keeps the rule DRY in one row.

### 4.2 Activity timeline — per-consumer tables, shared shape + helper (option C, NOT polymorphic)
Generalize `WorkCapsuleActivity` into a **canonical column-set** every work-unit activity table adopts:

`id, <parentFk>, kind, summary, payload Json, recordedAt, recordedById?, recordedByAgentId?, toolExecutionId?` + `@@index([<parentFk>, recordedAt desc])` + `@@index([kind, recordedAt desc])`.

First new table: `CoworkerEngagementActivity` (FK → CoworkerEngagement). A shared `recordWorkActivity()` helper writes rows and bumps the parent's `lastActivityAt`. A conformance test asserts every registered work-activity table matches the canonical shape. **Rationale for per-consumer tables over one polymorphic table:** real FK + cascade delete + referential integrity; the DRY-ness lives in the shared shape + helper + test, not a single integrity-losing table.

### 4.3 Status transitions — shared library (behavior, not schema)
A generic guarded transition function parameterized by an allowed-transitions map, plus the engagement's map (the engagement lifecycle transition API is currently absent). Reused by any status-bearing work unit. Each transition emits a timeline row (§4.2), giving accept/complete/cancel an audit trail for free.

### 4.4 Consumer wiring — CoworkerEngagement as the long-running work unit
- Add to `CoworkerEngagement`: `recurrenceScheduleId?`, `parentEngagementId?`+children self-relation, `instanceNumber?`, `dueAt?`, `lastActivityAt?`, `activities CoworkerEngagementActivity[]`.
- Marketing campaign work opens an engagement against `svc-marketing-campaign-execution` (the service seeded in #2543) as its long-running unit; recurring content = a `RecurrenceSchedule` + materialized child engagement instances; each drafting/publish/measure step records a timeline activity.
- The existing marketing **scheduler** (`ScheduledOutboundAction`) remains the *executor*; the engagement + recurrence is the *record of intent/progress*. A new schedule `kind` (or metadata link) ties a fired action back to its engagement instance.

## 5. RRULE dependency (gated by "never adopt an unvetted external tool")
Recurrence needs RFC-5545 expansion. Candidate: `rrule` (npm). **This spec does NOT adopt it yet** — it requires a `tool-evaluation` pass (license, maintenance, transitive deps, security, bundle size, SSR/edge compatibility) before adoption. Fallback if it fails vetting: a bounded in-house expander for the small rule subset we actually need (FREQ WEEKLY/MONTHLY + INTERVAL + BYDAY + COUNT/UNTIL), which is far less than full RFC-5545. The evaluation is a prerequisite task, not a foregone conclusion.

## 6. Alternatives considered (and why not)
- **A — bake recurrence into `CoworkerEngagement`** (kernel composite 0.97): high blast radius on the shared A2A model, low reversibility, and the own-work-vs-request semantic stretch. Rejected by kernel.
- **B — marketing-only** (kernel 1.00): fast/reversible but a non-generalizing special-case; leaves engagement/A2A capture inconsistent. Rejected by kernel.
- **Polymorphic single activity table** (`subjectType`+`subjectId`): DRY-est but loses FK integrity and cascade semantics — conflicts with data-model stewardship. Rejected in favour of §4.2.
- **Recurrence as shared columns (option C) instead of a `RecurrenceSchedule` entity**: matches StorefrontBooking today but duplicates rule columns across every consumer and has no single place to deactivate/repoint a rule. Kept as the fallback if review finds the FK entity over-engineered for two consumers.

## 7. Implementation slices (post-review)
1. `tool-evaluation` of `rrule` (or decide in-house expander). **Gate.**
2. Shared library: RRULE expansion + guarded transition state machine + `recordWorkActivity()` + conformance test. Pure, unit-tested. No schema yet.
3. Schema slice: `RecurrenceSchedule`, `CoworkerEngagementActivity`, engagement recurrence/timeline fields + migration (additive; validated via BEGIN/ROLLBACK as with the marketing migrations).
4. Engagement lifecycle API: `transitionEngagementStatus`, `recordEngagementActivity`, `createRecurringEngagement`, `queryEngagementInstances` + MCP tools.
5. Marketing wiring: campaign → engagement + recurrence + timeline; scheduler linkage.
6. (Later, separate) StorefrontBooking adopts `RecurrenceSchedule` — proves generalization; not required for marketing value.

## 8. Open questions for review
1. `RecurrenceSchedule` entity (S) vs shared recurrence columns (C) — is a shared entity justified at two consumers, or premature abstraction?
2. Eager materialization horizon + top-up cadence vs lazy on-demand occurrence computation.
3. Is `CoworkerEngagement` truly the right home for marketing own-work, or does "own-work engagement" want a distinct discriminator on the model (e.g. `origin: request | self`) to keep A2A semantics clean?
4. Timezone/DST correctness for recurrence evaluation (marketing cadences are business-local, not UTC).
5. External validation: how do mature systems (calendar/RRULE stacks, work-item trackers, marketing-automation journey engines) model recurring long-running work + activity timelines — does this shape match or miss a known pattern?

---

## 9. Review synthesis v2 (AUTHORITATIVE — supersedes §4–§8 where they differ)

Resolves the internal review's 5 blockers + the external review's 7 operational gaps + the WWMD host-entity decision. This is what we build.

### 9.1 Host entity — RESOLVED (kernel: `distinct-ownwork-entity`)
Introduce **`WorkEngagement`** — a coworker's own long-running/recurring work unit — org-scoped, separate from `CoworkerEngagement` (which stays the pure cross-agent *request* model). Both compose the same three shared primitives. Consequences:
- `WorkEngagement` carries `organizationId String` + `@relation(onDelete: Cascade)` to `Organization` + `@@index([organizationId, status, createdAt(sort: Desc)])` — dissolves **BLOCKER 1** (tenancy).
- No legacy backfill of `CoworkerEngagement` (**BLOCKER 5** dissolved) — it is untouched. Adding a lifecycle/transition API to `CoworkerEngagement` is explicitly **out of scope** (separate follow-up BI).
- No `origin` discriminator needed — separation is by entity, not by flag.

### 9.2 Three shared primitives (composed by WorkEngagement now; CoworkerEngagement/StorefrontBooking later)
1. **`RecurrenceSchedule`** entity: `id, rrule, timezone (IANA), anchorAt, until?, misfirePolicy ("skip"|"fire-once"|"fire-all", default "skip"), supersededByScheduleId?, active, createdAt, updatedAt`. Referenced by consumers via nullable FK, **`onDelete: Restrict`** (a live rule must not be deleted out from under instances) — **BLOCKER 4**.
2. **Activity timeline** — per-consumer table `WorkEngagementActivity` with the canonical WorkCapsuleActivity shape PLUS `seq Int` (monotonic per parent; `@@unique([workEngagementId, seq])`) for strict append-only ordering under concurrency (external gap #5). FK `onDelete: Cascade`. Append-only enforced at the DB grant layer, not just app code (external gap #7). A conformance test asserts registered activity tables match the canonical shape.
3. **Transition state machine** — a shared guarded `transition(map, from, to)` that **subsumes** the two existing copies (`execution.ts` `SCHEDULED_TRANSITIONS`/`isAllowedScheduledTransition` and `ALLOWED_TRANSITIONS`/`assertDraftTransition`); a conformance test asserts both route through it (internal change #3). Transitions are **idempotent** (target==current → no-op, no duplicate activity row) (external gap #6) and emit one activity row each.

### 9.3 Recurrence occurrences — idempotent, exception-aware
- Occurrences materialize as **child `WorkEngagement` instance rows** (`parentWorkEngagementId?` self-relation, `onDelete: Restrict`; `instanceNumber Int`; `dueAt DateTime`; `occurrenceAt DateTime` = UTC occurrence key).
- **Idempotency (BLOCKER 2 / external gap #3):** `@@unique([recurrenceScheduleId, occurrenceAt])`; materialize = **upsert** on that key. Two ticks / two sessions cannot double-materialize.
- **Bounded eager horizon** (explicit const, e.g. `MATERIALIZE_HORIZON_DAYS = 75`) + top-up via the **existing marketing tick harness** (no second scheduler). Never expand an unbounded rule — cap on horizon, not rule (external gap #1).
- **Exceptions/overrides (external gap adds 1–2):** a per-instance `exceptionState ("none"|"cancelled"|"overridden")` that **survives re-materialization** (materializer upsert never resurrects a cancelled occurrence). "This-and-future" edit = truncate original `RecurrenceSchedule.until` + new schedule linked via `supersededByScheduleId` (no library supports this natively).

### 9.4 Timezone/DST — RESOLVED (Q4)
Store IANA `timezone` on the schedule (already in §4.1). **Expand occurrences in that timezone via Luxon (or Temporal), then persist `occurrenceAt` as UTC** — do NOT trust `rrule` for DST (its weakest, most-reported area). Slice-1 acceptance test: a `FREQ=WEEKLY;BYDAY=MO;09:00` cadence stays 09:00 local across a spring-forward AND fall-back boundary.

### 9.5 Scheduler reconciliation — RESOLVED (BLOCKER 3)
Add typed FK **`ScheduledOutboundAction.workEngagementInstanceId String?`** + index (NOT a `kind`-overload — that breaks the closed `SCHEDULED_ACTION_KIND` union — and NOT untyped `metadata`). Status ownership: `tickScheduler`, on firing/failing an action, ALSO calls `transitionWorkEngagement(instance, in-progress|completed|failed)` through the shared guard. Partial-failure rule: the action's own status is authoritative for "did it fire"; if the engagement transition then throws, log + leave the instance in its prior state for the next tick to reconcile (no lost fire). Extend `TickResult` with `materialized/skipped/errored` counts (observability lesser-gap).

### 9.6 Grants (internal lesser-gap)
New MCP tools gated by `work_engagement_write` (create/record) and a **distinct `work_engagement_transition`** (state changes incl. cancel/complete are higher-privilege than create). Added to both the pack `grants` and `TOOL_TO_GRANTS`.

### 9.7 RRULE dependency — RESOLVED (external §2)
**Adopt `rrule`** (BSD-3-Clause, CVE-clean, de-facto standard, 1 transitive dep `tslib`) for **parse/serialize + bounded expansion only** — treat as maintenance-mode; never the DST source of truth (§9.4). Record `rrule-temporal` (Temporal-based, actively developed) as the documented migration path. This satisfies the "never adopt an unvetted external tool" gate; the external validation IS the tool-evaluation. Fallback if pinning `rrule` proves unacceptable: bounded in-house expander for the small subset (FREQ WEEKLY/MONTHLY + INTERVAL + BYDAY + COUNT/UNTIL) driven off Luxon.

### 9.8 Scope-out (external §4)
This primitive is the **campaign/cadence** tier (recurring content on a schedule + status lifecycle). Per-recipient **journey orchestration** (a workflow-instance per contact with branching) is explicitly **out of scope** — it wants a distinct journey model and must not be forced onto recurrence.

### 9.9 Revised slices
0. **`rrule` adoption** — satisfied by external validation §2 (record the tool-eval note; add dep, pinned).
1. **Shared library (pure, unit-tested, NO schema):** tz-aware RRULE expander (Luxon) with DST tests; guarded transition state machine subsuming the two existing maps + conformance test; `recordWorkActivity()` helper (seq allocation). 
2. **Schema slice (additive migration, BEGIN/ROLLBACK-validated):** `RecurrenceSchedule`, `WorkEngagement` (+ self-relation instances), `WorkEngagementActivity`; all `onDelete` per §9.1–9.3; the two unique keys; `ScheduledOutboundAction.workEngagementInstanceId`.
3. **WorkEngagement lifecycle API + MCP tools + grants** (§9.6): create, `createRecurringWorkEngagement`, `transitionWorkEngagement`, `recordWorkEngagementActivity`, `queryWorkEngagementInstances`.
4. **Marketing wiring:** campaign → a `WorkEngagement` (long-running unit); recurring content → `RecurrenceSchedule` + materialized instances; each draft/publish/measure step records an activity; scheduler linkage per §9.5.
5. **(Later, separate BI)** StorefrontBooking + CoworkerEngagement adopt the shared primitives — proves generalization; not required for marketing value.

### 9.10 Go/no-go
Internal review's conditional NO-GO conditions are all resolved above (host entity via kernel; tenancy, idempotency, reconciliation, cascades, backfill; subsume transition maps; grants). External structure validated; 7 operational gaps folded in. **GO for implementation, slice 0→1 first.**
