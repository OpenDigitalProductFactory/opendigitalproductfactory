# Field Service Sprint 1 + 2 — Build Studio Intake Brief Pack

> **Delivery model:** Per the [`feedback_build_studio_for_all_development`](../../../../C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/feedback_build_studio_for_all_development.md) standing rule, this plan does **not** describe Claude implementation steps. It describes the seven Backlog Items the operator files into the Build Studio intake (`BI-FS-001` … `BI-FS-007`) so Build Studio's Ideate → Design → Implement → Review → Ship pipeline can drive each one. Each section below is a self-contained intake brief that maps directly to the `BacklogItem.body` field.

**Goal:** Land the field-service foundation — HVAC archetype, `WorkItem` field-service lifecycle, customer notification preferences, dispatcher coworker V1 with appointment-confirmation and on-my-way SMS — entirely through Build Studio, with no new top-level Prisma models.

**Architecture:** Per the [spec §5 substrate audit](../specs/2026-05-19-field-service-trades-ai-dispatch-design.md) and ADR-1, the field-service "job" is a `WorkItem` row (`packages/db/prisma/schema.prisma:7795`) with `sourceType = "field-service-job"`, lifecycle states in `WorkItem.status`, and on-site capture (photos, sign-off, refrigerant log, parts used) in `WorkItem.evidence`. Notification preferences are additive columns on `CustomerContact`. The dispatcher coworker is a new autonomous coworker seed with grants on `send_customer_notification` and `list_work_items`. **No new top-level models in this Sprint pack.**

**Tech Stack:** Next.js 16 monorepo (pnpm workspaces), Prisma 7.x (PostgreSQL), Zod (`packages/validators`), Vitest, autonomous coworker runtime, communication fabric.

**Governance constraints (apply to every BI):**
- DCO sign-off on every commit (`git commit -s`).
- Full `vitest` run before push (pre-commit hook only runs typecheck; PR CI breaks if vitest is skipped locally).
- Doc + test updates land in the same change set.
- Seed + Prisma migration kept in sync (manual DB patches are lost on fresh install).
- ADR-6 data governance (GPS retention, notification dedupe via `CommunicationDeliveryAttempt`) and ADR-7 conduit framing (no centralized partner credentials) apply.

**Out of scope for this pack (later sprints, per spec §9):**
- Voice-first job-close parser (Sprint 3, depends on STT Slice 1)
- GPS ETA via mapping API (Sprint 4)
- Equipment / site history (Sprint 5)
- TTS outbound call (Sprint 6, depends on persona voice layer)
- QuickBooks invoice write (Sprint 7, depends on QB Anchor Slice 6)
- EPA 608 + rebate intelligence (Sprint 8)
- Inbound call answering (Sprint 9)
- Financing + truck stock (Sprint 10)
- Predictive maintenance IoT hook (Sprint 11)

---

## Epic registration

| Field | Value |
| ----- | ----- |
| `itemId` | `EP-TRADES-FIELD-SERVICE` |
| Type | Epic |
| Title | Field Service Trades — AI Dispatch & Field Automation |
| Source spec | [`docs/superpowers/specs/2026-05-19-field-service-trades-ai-dispatch-design.md`](../specs/2026-05-19-field-service-trades-ai-dispatch-design.md) |
| Outcome | Field service contractor runs job lifecycle, dispatch, and customer notifications through DPF; wife is no longer in the critical path for appointment confirmation and en-route messaging. |

All seven BIs below link to this epic via `BacklogItem.epicId`. **Look up the Epic's cuid first** — passing the semantic string `EP-TRADES-FIELD-SERVICE` as the FK breaks (see Prisma FK pitfall noted in past field-service work).

---

## Dependency graph

```
BI-FS-001 (HVAC archetype) ──┐
BI-FS-002 (WorkItem lifecycle) ─┬─→ BI-FS-004 (Dispatcher seed) ─┬─→ BI-FS-005 (Appt confirm)
BI-FS-003 (Notif prefs) ──────┘                                  ├─→ BI-FS-006 (On-my-way)
                                                                 └─→ BI-FS-007 (Running-late)
```

**Parallelisation:** `BI-FS-001`, `BI-FS-002`, `BI-FS-003` can run as three concurrent Build Studio builds. `BI-FS-004` waits on `BI-FS-002` + `BI-FS-003`. `BI-FS-005`, `BI-FS-006`, `BI-FS-007` can run concurrently once `BI-FS-004` ships.

---

## BI-FS-001 — HVAC/AC Contractor Storefront Archetype

| Field | Value |
| ----- | ----- |
| Type | Feature |
| Effort | XS |
| Epic | `EP-TRADES-FIELD-SERVICE` |
| Depends on | (none) |

### Problem

The `trades-maintenance` archetype family in `packages/storefront-templates/src/archetypes/trades-maintenance.ts` covers facilities-maintenance, plumber, electrician, cleaning-service, landscaping — but not HVAC, the most common field-service SMB vertical. Operators in this archetype cannot stand up a working storefront today without manual schema work.

### Proposed outcome

A new `hvac-contractor` archetype in the `trades-maintenance` category, available to any HVAC contractor at install time, with the services, form fields, and vocabulary overrides defined in spec §11.

### Acceptance criteria

- `ALL_ARCHETYPES` includes `{ archetypeId: "hvac-contractor", category: "trades-maintenance", ctaType: "inquiry" }`.
- `itemTemplates` contains at minimum: AC Tune-Up / Preventive Maintenance, Emergency Service Call, AC Installation, Heating System Service, Refrigerant Recharge, Indoor Air Quality Assessment, Maintenance Agreement, Commercial HVAC Service.
- `formSchema` contains: name, email, phone, `systemType` (Central AC / Heat Pump / Mini-Split / Gas Furnace / Commercial), `urgency` (Emergency / Next Available / Scheduled), `propertyType` (Residential / Commercial), notes.
- Vocabulary overrides include: "Jobs" (not Orders), "Technician" (not Employee), "Service call" (not Appointment), "Parts" (not Inventory items).
- Tags include `hvac`, `air-conditioning`, `heating`, `field-service`.
- Catalog test in `packages/storefront-templates/src/archetypes/archetypes.test.ts` validates archetype presence and required-field shape.
- Operator can install fresh and select HVAC archetype during onboarding; storefront publishes; customer can submit a service request.

### Substrate references (verified against `main`)

- Existing file to extend: `packages/storefront-templates/src/archetypes/trades-maintenance.ts` (`plumber` archetype at line 42 is the closest shape to copy).
- Archetype shape: `packages/storefront-templates/src/types.ts` (StorefrontArchetype interface).
- Catalog test pattern: `packages/storefront-templates/src/archetypes/archetypes.test.ts`.

### Out of scope

- HVAC-specific equipment schema (BI-FS-014, Sprint 5 — uses `CustomerConfigurationItem` extension).
- Flat-rate pricebook population (Sprint 10).
- EPA 608 fields on the archetype (Sprint 8).

### Verification gate

```
pnpm --filter @dpf/storefront-templates exec vitest run
pnpm --filter web typecheck
```

---

## BI-FS-002 — `WorkItem` Field-Service Lifecycle

| Field | Value |
| ----- | ----- |
| Type | Feature |
| Effort | M |
| Epic | `EP-TRADES-FIELD-SERVICE` |
| Depends on | (none) |

### Problem

Field service work needs a state machine: `quoted → scheduled → confirmed → en-route → on-site → complete → invoiced → paid` (plus `cancelled`). Every downstream automation (dispatcher reads "what's open today", on-my-way fires on state transition, invoice generates from `status = complete`) depends on this lifecycle being addressable and validated. The naive design — a new `Job` Prisma model — duplicates substrate that already exists in `WorkItem`.

### Proposed outcome

A `sourceType = "field-service-job"` convention on the existing `WorkItem` model with: (a) state vocabulary enforced at the validator boundary, (b) a Zod `evidence` schema for field-service-specific capture, (c) helper services that wrap the queries the dispatcher coworker will use. **No new top-level Prisma model.**

### Acceptance criteria

- Zod validator `FieldServiceJobEvidence` (in `packages/validators`) shape: `{ technicianNotes?: string[], partsUsed?: PartUsage[], photos?: PhotoAttachment[], customerSignOff?: SignOff, refrigerantLog?: RefrigerantEntry[] }` — defined as forward-compatible (optional fields) so Sprint 3/5/8 can extend without migration.
- Validator `FieldServiceJobStatus` enforces the 9-state vocabulary; rejects any other value with a clear error.
- Service helper `listFieldServiceJobs({ technicianId?, status?, day? })` under `apps/web/lib/field-service/` queries `WorkItem` filtered by `sourceType` and joins via existing `assignedToUserId` / `calendarEventId` / `WorkItemMessage` relations.
- Service helper `transitionFieldServiceJob({ workItemId, fromStatus, toStatus, actorId })` enforces legal transitions (e.g. cannot go from `scheduled → complete` without crossing `en-route` and `on-site`); writes an audit entry via `WorkItemMessage`.
- Unit tests cover: each legal transition, each illegal transition (rejected), `evidence` schema accepts a minimal payload, `evidence` schema rejects unknown top-level keys.
- Architecture doc page added at `docs/architecture/field-service-work-item.md` explaining the sourceType convention and citing spec ADR-1 for the "why no new model" rationale.

### Substrate references (verified against `main`)

- `WorkItem` model: `packages/db/prisma/schema.prisma:7795` — already carries `sourceType`, `status`, `urgency`, `assignedToUserId`, `assignedToAgentId`, `calendarEventId`, `evidence` (Json), `parentItemId`, `dueAt`, `routingDecision`.
- `WorkItemMessage` model: `packages/db/prisma/schema.prisma:7841` — already supports the per-job message thread the dispatcher and technician will use.
- `CalendarEvent.workItems WorkItem[]` relation: `packages/db/prisma/schema.prisma:5285`.

### Out of scope

- **No new Prisma model.** If Build Studio's design review pushes back with "this should be `Job`/`FieldServiceJob`", reject and cite spec §5 + ADR-1.
- No UI in this BI (UI ships with BI-FS-004 dispatcher panel).
- No QB sync hook (Sprint 7).
- No state-change webhooks (deferred until a consumer exists).

### Verification gate

```
pnpm --filter @dpf/db exec vitest run
pnpm --filter @dpf/validators exec vitest run
pnpm --filter web typecheck
pnpm exec vitest run   # full suite, no skips
```

---

## BI-FS-003 — Customer Notification Preference Fields

| Field | Value |
| ----- | ----- |
| Type | Feature |
| Effort | XS |
| Epic | `EP-TRADES-FIELD-SERVICE` |
| Depends on | (none) |

### Problem

The dispatcher coworker (BI-FS-004+) needs to know how to reach each customer — SMS, voice call, or email — and which of a customer's phone numbers is mobile-capable. Today, `CustomerContact` has neither a stated preference nor a mobile/landline distinction. Without these fields, the coworker either spams every channel or fails silently when SMS goes to a landline.

### Proposed outcome

Two additive nullable columns on `CustomerContact` plus a small UI surface on the customer record to set them. Nullable defaults preserve backward compatibility; an absent value means "operator hasn't told us" and the dispatcher falls back to existing notification heuristics until set.

### Acceptance criteria

- Prisma migration adds `CustomerContact.preferredNotificationChannel String?` (allowed values via Zod: `sms | voice | email | none`).
- Prisma migration adds `CustomerContact.phoneType String?` (allowed values via Zod: `mobile | landline | unknown`).
- Seed updated so fixture customers still load; new contacts default `phoneType = "unknown"` only where appropriate.
- Migration is purely additive — no data loss possible if rolled back.
- Customer record edit form (existing UI under `apps/web/app/customers/`) exposes both fields as dropdowns with helper text.
- Validator `CustomerNotificationPreference` in `packages/validators` exports the allowed-value enums for use by the dispatcher (BI-FS-005/006).
- Vitest covers: migration applies cleanly on a fresh DB, validator rejects invalid values, customer edit form saves both fields.
- Seed and migration kept in lock-step — fresh install reproduces same `CustomerContact` shape as a migrated install.

### Substrate references (verified against `main`)

- `CustomerContact` model: `packages/db/prisma/schema.prisma:112`.
- `Notification` model: `packages/db/prisma/schema.prisma:3890`.
- `CommunicationDeliveryAttempt` model: `packages/db/prisma/schema.prisma:3983` — already exists; dedupe in BI-FS-005/006 reads from here.

### Out of scope

- Dispatcher logic (BI-FS-004+).
- Bulk-backfill tool for existing customers (operator backfills as they edit each record; not blocking).
- SMS opt-out workflow (TCPA wiring lands in BI-FS-005 where the first outbound SMS fires).

### Verification gate

```
pnpm exec prisma migrate dev --name customer_notification_prefs
pnpm --filter @dpf/db exec vitest run
pnpm --filter @dpf/validators exec vitest run
pnpm --filter web typecheck
pnpm exec vitest run
```

---

## BI-FS-004 — Dispatcher Coworker Seed (V1)

| Field | Value |
| ----- | ----- |
| Type | Feature |
| Effort | S |
| Epic | `EP-TRADES-FIELD-SERVICE` |
| Depends on | BI-FS-002, BI-FS-003 |

### Problem

There is no autonomous coworker today whose role is field-service coordination. The dispatcher role currently held by the contractor's wife — confirm tomorrow's appointments, notify next customer when running late, fire en-route texts — has no AI surrogate. Hardcoded coworkers also have a history of silent grant misses (a hardcoded coworker without grants returns hallucinated success on every tool call), so seeding the coworker without grants is worse than not seeding at all.

### Proposed outcome

A new `dispatcher` coworker seeded into the catalog with the role, prompt template, and tool grants in place from first install. Per ADR-1 the coworker queries `WorkItem` directly; per ADR-3 it reads `CustomerContact.preferredNotificationChannel` before dispatching. Skills implemented in BI-FS-005/006/007 plug into this coworker.

### Acceptance criteria

- Coworker seed file registers `dispatcher` with bundled-active default (no operator "Register" step needed on fresh install).
- Tool grants seeded in the same change set: `list_work_items` (filtered to `sourceType = "field-service-job"`), `send_customer_notification`, `get_customer_contact`, `update_work_item_status`.
- Invariant guard at boot verifies the dispatcher's grants are present; fails loud if missing (no silent skip — the agent-grant-seeding-gap fix pattern).
- Prompt template captures: dispatcher persona, knows the 9-state lifecycle, reads `preferredNotificationChannel` before acting, escalates to operator when no channel works.
- Routing assigns dispatcher tasks dynamically by capability tier; no provider/model pinning in the seed.
- Dispatcher visible in Admin → Coworkers on fresh install; admin can disable / re-enable.
- Portal "Dispatcher" panel (per spec §8.3) renders today's field-service `WorkItem`s with state chips and a notification-history sidecar.
- Vitest covers: seed produces the expected coworker + grants on a fresh DB, invariant guard fires when a grant is missing, `list_work_items` tool filter rejects non-field-service `sourceType` values.

### Substrate references (verified against `main`)

- Agent model: `packages/db/prisma/schema.prisma:1689`.
- Tool-grant pattern + invariant guard: same as the fix that closed the agent-grant-seeding-gap incident — reuse, don't reinvent.
- Autonomous coworker runtime: spec `docs/superpowers/specs/2026-05-11-autonomous-coworker-runtime-design.md`.

### Out of scope

- The three skill implementations (BI-FS-005/006/007).
- TTS outbound call capability (Sprint 6).
- Inbound call answering (Sprint 9).

### Verification gate

```
pnpm exec vitest run
pnpm --filter web typecheck
# Manual smoke: fresh install via docker-compose, Admin → Coworkers shows Dispatcher with grants populated; toggle disable/enable works
```

---

## BI-FS-005 — Appointment Confirmation Skill (T-24h)

| Field | Value |
| ----- | ----- |
| Type | Feature |
| Effort | S |
| Epic | `EP-TRADES-FIELD-SERVICE` |
| Depends on | BI-FS-004 |

### Problem

Customers forget appointments. The wife calls every customer the day before to confirm — a daily 30-minute task that scales linearly with job volume and is the first thing that breaks when the second technician onboards.

### Proposed outcome

A scheduled dispatcher coworker skill that runs hourly, finds every field-service `WorkItem` with `status = scheduled` whose `calendarEvent.startAt` falls in a 23–25h sliding window, reads each linked customer's `preferredNotificationChannel`, and dispatches a confirmation SMS via the communication fabric. Records the send in `CommunicationDeliveryAttempt` so the same job isn't notified twice (ADR-6 dedupe).

### Acceptance criteria

- Skill file under the coworker-skills package, invoked by a scheduled task running hourly.
- Query joins `WorkItem` (`sourceType = "field-service-job"`, `status = "scheduled"`) → `calendarEvent` → linked `CustomerContact`. Proceeds only if `CustomerContact.preferredNotificationChannel` is `sms` or unset; on `voice` or `none` it skips the SMS path **and writes a `WorkItemMessage` ping to the operator** ("customer prefers voice/no contact; please confirm manually until Sprint 6 TTS ships"). No silent skip.
- Dedupe via `CommunicationDeliveryAttempt`: one confirmation per `WorkItem.id` per event-type per customer per 48h window.
- On send success: skill does **not** auto-advance status to `confirmed`. State advances only when customer replies YES or operator manually marks. Capture the actual response — don't infer from "we sent it".
- On send failure: writes a `WorkItemMessage` flagging the operator with "could not reach this customer for tomorrow's job; please call" — actionable, not a silent miss.
- TCPA-aware opt-out: SMS body includes "Reply STOP to opt out"; STOP replies write `preferredNotificationChannel = none`.
- Vitest covers: window query, dedupe, channel preference respected, failure path raises an alert, STOP handling.

### Substrate references (verified against `main`)

- `CommunicationDeliveryAttempt`: `packages/db/prisma/schema.prisma:3983`.
- Communication fabric SMS path: spec `docs/superpowers/specs/2026-05-15-employee-communication-fabric-design.md`.

### Out of scope

- Voice/TTS confirmation calls (Sprint 6).
- Multi-language templates (English-only for Sprint 2).
- Operator-editable template wording (uses defaults from spec §8.4; CMS-style editing is later UX polish).

### Verification gate

```
pnpm exec vitest run
pnpm --filter web typecheck
# Manual: seed a fixture WorkItem with calendarEvent.startAt = now+24h on a fresh install, invoke the scheduled skill manually, observe one outbound SMS + one CommunicationDeliveryAttempt row + no auto-status-advance
```

---

## BI-FS-006 — On-My-Way SMS Skill (Manual ETA Entry)

| Field | Value |
| ----- | ----- |
| Type | Feature |
| Effort | S |
| Epic | `EP-TRADES-FIELD-SERVICE` |
| Depends on | BI-FS-004 |

### Problem

The single highest-frequency wife-on-the-critical-path event is the en-route notification. Today: tech texts wife from the truck, wife texts customer. Two hops, often delayed, often the wife is doing something else. The customer doesn't know the technician is coming until he knocks.

### Proposed outcome

A coworker skill the technician/operator triggers from the portal (mobile companion lives in Sprint 3 — for Sprint 2 the operator triggers from the portal): selects a `WorkItem` with `status = confirmed` (or `scheduled` if the confirm step was skipped), enters an estimated arrival minutes value (manual for Sprint 2; GPS-derived ETA is Sprint 4), the skill transitions the `WorkItem` to `en-route` and sends the customer the SMS template from spec §8.4.

### Acceptance criteria

- Portal action button on the dispatcher panel + on each `WorkItem` detail row: "Send on-my-way" — opens a tiny form (minutes-out integer, default 20).
- Action invokes the dispatcher coworker `send_on_my_way` skill with `{ workItemId, etaMinutes }`.
- Skill validates: `WorkItem.sourceType = "field-service-job"`, status in `{confirmed, scheduled}`, customer has `preferredNotificationChannel != none` and at least one phone with `phoneType = mobile`.
- On success: `WorkItem.status` → `en-route`, `CommunicationDeliveryAttempt` row written, `WorkItemMessage` audit ("dispatcher sent en-route SMS, ETA 20 min").
- On failure (e.g. customer has landline only): action returns an inline error explaining the gap and suggests upgrading to TTS once Sprint 6 ships. Actionable, never silent.
- Dedupe prevents two en-route notifications for the same `WorkItem` within 1h.
- Vitest covers: happy path, status guard rejects `complete`/`invoiced`, channel guard rejects landline-only customer, dedupe.

### Substrate references (verified against `main`)

- Same as BI-FS-005.
- Mobile companion UX intentionally **not** wired here — Sprint 3 owns that. The portal action is the Sprint 2 surface.

### Out of scope

- GPS-derived ETA (Sprint 4 / BI-FS-011-013).
- Mobile-app trigger button (Sprint 3 / BI-FS-010).
- Customer reply handling beyond STOP.

### Verification gate

```
pnpm exec vitest run
pnpm --filter web typecheck
# Manual: with a fixture WorkItem in 'confirmed' state, fire the action from the dispatcher panel; verify SMS + state transition + dedupe (second click within 1h = no-op + clear UI feedback)
```

---

## BI-FS-007 — Running-Late Cascade Skill

| Field | Value |
| ----- | ----- |
| Type | Feature |
| Effort | S |
| Epic | `EP-TRADES-FIELD-SERVICE` |
| Depends on | BI-FS-004, BI-FS-006 |

### Problem

When the current job runs long, the next 1–4 customers in the day's schedule are silently waiting. The wife either notices and calls, or she misses it — either way the next customer's window slips without acknowledgment.

### Proposed outcome

A scheduled dispatcher coworker skill that runs every 10 minutes: for any `WorkItem` with `status in {on-site, en-route}` whose `calendarEvent.endAt` is in the past by ≥15 minutes, recompute the projected end based on a configurable per-archetype overrun heuristic, identify downstream jobs for the same technician, and dispatch a "running-late, new ETA" SMS to each affected customer (subject to ADR-3 preference rules and ADR-6 dedupe).

### Acceptance criteria

- Skill runs every 10 minutes via the scheduled-task substrate (`ScheduledAgentTask` if appropriate, or the autonomous-coworker probe pattern).
- Heuristic: projected slip = `now - originalEndAt` × `(1 + archetypeOverrunFactor)`. Ships with a sane HVAC default `archetypeOverrunFactor = 0.20` (20%) so the skill works day one without operator tuning; operator can override per archetype later. Applied to each subsequent job's `startAt` and `endAt`. Per-job override allowed via the dispatcher coworker if the technician messages "I'll be 45 minutes late at the next one".
- Outbound SMS per affected downstream customer with spec §8.4 "running late" template; dedupe at one per `WorkItem.id` per slip-window.
- `WorkItemMessage` audit on each affected job: "downstream slip cascade — new ETA sent".
- Operator alert if cascade affects >2 downstream jobs (config flag) — dispatcher pings the operator's coworker thread so they can intervene.
- Vitest covers: cascade math, dedupe, operator-alert threshold, channel preference respected, no notification fired if downstream `WorkItem` lacks a `startAt`.

### Substrate references (verified against `main`)

- `CalendarEvent.workItems WorkItem[]`: `packages/db/prisma/schema.prisma:5285`.
- `ScheduledAgentTask`: `packages/db/prisma/schema.prisma:5294`.
- Same notification/dedupe pattern as BI-FS-005/006.

### Out of scope

- Schedule optimization (resequencing jobs by geography is a later sprint).
- Customer reply handling (reschedule-via-reply is a later UX).
- TTS variant of the running-late call (Sprint 6).

### Verification gate

```
pnpm exec vitest run
pnpm --filter web typecheck
# Manual: with three sequential fixture WorkItems for one technician, mark the first 'on-site' with endAt 20m in the past; observe cascade SMS to the next two customers and audit entries on each WorkItem
```

---

## Cross-BI verification (run before merging the Sprint-pack PRs)

```
# Fresh install reproducibility
docker compose down -v && docker compose up -d
# wait for healthchecks
pnpm exec prisma migrate deploy
pnpm exec tsx scripts/seed.ts

# Full suite — no skips
pnpm exec vitest run
pnpm --filter web typecheck
cd apps/web && npx next build

# Manual smoke checklist
# 1. Admin → Coworkers → Dispatcher present + grants populated (BI-FS-004)
# 2. Customers → edit → preferredNotificationChannel + phoneType save and persist (BI-FS-003)
# 3. Storefront → install picks hvac-contractor → publish → submit a request (BI-FS-001)
# 4. Backoffice → create a field-service WorkItem with sourceType="field-service-job"; run state transitions through scheduled → confirmed → en-route → on-site → complete (BI-FS-002)
# 5. Dispatcher panel → fire on-my-way SMS to a fixture customer with phoneType=mobile (BI-FS-006)
# 6. Wait for 23–25h-windowed scheduled task tick (or invoke manually) → observe outbound confirmation SMS for tomorrow's job (BI-FS-005)
# 7. Mark a fixture job 'on-site' with endAt 20m past + downstream jobs → observe running-late cascade SMS (BI-FS-007)
```

---

## Risks (Sprint-pack-level)

| Risk | Mitigation |
| ---- | ---------- |
| Build Studio Ideate phase rejects BI-FS-002 because "no model = unclear scope" | Spec §5 substrate audit is the authoritative answer — link it from the BI body. Reject any "add a Job model" proposal from Design review with citation to ADR-1. |
| Hardcoded coworker silent-grant regression (BI-FS-004) | Invariant guard from the agent-grant-seeding-gap fix is in scope of BI-FS-004 acceptance criteria — do not ship without it. |
| SMS spam from over-eager scheduled task (BI-FS-005 / 007) | Dedupe via `CommunicationDeliveryAttempt` is in every notification BI's acceptance criteria. Operator alert threshold in BI-FS-007 caps cascade blast radius. |
| Migration data loss on `CustomerContact` (BI-FS-003) | Both columns are nullable, no constraint changes on existing columns; rollback restores prior state without loss. |
| Operator confuses "field-service-job" sourceType with existing WorkItem flows | Architecture doc page in BI-FS-002 acceptance criteria + dispatcher panel filtered view in BI-FS-004 keep the surface distinct. |
| Build Studio writes feature code that wires GPS / TTS / Twilio into a Sprint-2 BI | Out-of-scope blocks at the top of each BI body are explicit. Design review must reject scope creep into Sprint 4/6. |

---

## Recommended next step (after this pack ships)

Sprint 3 — voice-first job completion (`BI-FS-008` / `BI-FS-009` / `BI-FS-010`), which unblocks the "technician on the truck dictates the invoice" loop. Sprint 3 depends on STT Slice 1 being live in production (currently in progress; default-on CPU path lands in `2026-05-17-voice-input-slice-1-5-default-on-cpu.md`).
