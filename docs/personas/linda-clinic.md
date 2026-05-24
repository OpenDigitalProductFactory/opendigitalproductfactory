# Linda, Scheduler at a neighborhood dental practice - DPF persona

## Snapshot

- **Business**: Independent dental practice serving families and returning patients through exams, hygiene appointments, emergency visits, and treatment plans.
- **Size**: Small clinic with a front desk, several treatment rooms, dentists, hygienists, and part-time admin coverage. Exact revenue and geography are not specified.
- **Tech baseline**: Comfortable with scheduling software, email/SMS reminders, scanned forms, and spreadsheets, but not with platform administration or software delivery terms.
- **What they don't have**: One calm view that says whether today's and tomorrow's appointments are actually ready: forms complete, patient confirmed, practitioner load sane, and follow-ups queued.
- **Archetype**: Seeded leaf `dental-practice`; category `healthcare-wellness`.
- **IT4IT value streams they care about**: `request-to-fulfill`, `detect-to-correct`, `deploy-to-operate`.

## The narrative (marketing-grade)

Linda's day starts before the first patient walks in. She is checking who confirmed, who still needs forms, whether a new patient is missing intake paperwork, whether a hygienist is overbooked, and which appointment is likely to no-show because the reminder bounced. None of those problems look dramatic on a dashboard, but each one can knock the whole morning sideways.

The practice already has software. What Linda needs is the missing connective tissue: a front-desk home that shows the work exactly as she thinks about it. If a patient is ready, it should be obvious. If a form is missing, it should be in her face before the patient arrives. If a practitioner is overloaded, the system should say that in plain clinic language, not bury it in an operations report.

For Linda, DPF is valuable when it makes the schedule less fragile. The platform should feel like a second set of eyes at the desk: quiet, privacy-aware, and specific enough that she can act before a queue forms in the waiting room.

## What they ask DPF to build (the first feature)

"I want tomorrow's schedule to show which patients are ready, which forms are missing, and where the hygienists are overloaded."

First-feature smoke scope:

- Show today's and tomorrow's appointments.
- Mark each appointment as ready, needs forms, needs confirmation, or needs follow-up.
- Highlight no-show risk from missing or failed reminders.
- Show practitioner and hygienist capacity by time block.
- Queue patient follow-ups without exposing platform internals.

Primary workspace-home backlog item: `BI-8954667A`.

## What the platform needs to be like for them

- **Vocabulary** they expect: patients, appointments, chairs, dentists, hygienists, practitioner load, forms, intake, confirmations, reminders, no-shows, follow-up calls, ready for visit.
- **Coworkers** they need active: a clinic scheduler or patient-engagement coworker for reminders, missing forms, and follow-up calls; no field-service Dispatcher is needed. Before dogfood, verify the seed state for any named coworker and simulate missing roles through the generic Build Studio coworker if needed.
- **Features** that are critical vs irrelevant: critical features are schedule readiness, missing-form detection, failed reminder visibility, practitioner capacity, patient follow-up tasks, privacy-aware copy, and translated coworker handoffs. Irrelevant at first touch: truck inventory, warehouse stock, POS merchandising, platform architecture, raw model/provider details, and GearInterface terminology.
- **Surfaces** they'll touch first and what should be on them: `/workspace` should open to a schedule board with readiness and exceptions above generic KPIs; `/build` should accept the appointment-readiness request in clinic language; any patient-facing form reminder should remain previewable without exposing admin internals.
- **Surfaces** they should NEVER see: model IDs, MCP/tool names, schema fields, internal audit mechanics, raw autonomy decisions, gear/ring/torque/slip/cockpit language, or unrelated platform release work.

## Marketing extractables

- "Linda is not asking for another calendar. She is asking to know whether the day is going to hold together."
- "A missing form is not paperwork; it is a waiting-room delay that can ripple across every appointment after it."
- "DPF helps the front desk see tomorrow's problems while there is still time to fix them."
- **Before/after hero block**: Before DPF, Linda pieces together readiness from reminders, forms, and mental notes. After DPF, the schedule shows which patients are ready, which appointments need action, and where practitioner capacity is starting to bend.
- **Feature soundbites**: Appointment readiness replaces calendar guesswork; missing forms become early warnings; failed reminders create follow-up tasks; practitioner load is visible before the waiting room backs up; clinic language keeps the platform out of the patient's way.
- **Permission to use?** Pseudonym/synthetic persona. Not a real customer story unless replaced with a customer-approved case study.

## Test scenarios (re-runnable dogfood)

- With substrate BI `BI-1CCC6264` complete, configure a `dental-practice` / `healthcare-wellness` install and confirm `/workspace` resolves to the clinic contribution rather than the platform fallback.
- With projection BI `BI-3E8D2CF5` complete, render a missing-form signal and a failed reminder as clinic-native needs-review items, not GearInterface or Governor copy.
- Drive `BI-8954667A` on the Live portal with fixture-backed appointments: one ready appointment, one missing forms, one failed reminder, one no-show risk, and one overloaded practitioner block.
- Confirm the first viewport prioritizes schedule readiness, queue exceptions, missing forms, and practitioner load before generic business KPIs.
- On mobile, confirm the readiness and exceptions slots stay ahead of lower-priority cards.
- Start Linda's first-feature Build Studio request only after `BI-4396EFEC` has been functionally verified against Dale's flow; confirm plan iterations converge or stop with split-scope guidance.

## Dogfood history

| Date | Phase reached | Deficiencies surfaced | Outcome |
| ---- | ------------- | --------------------- | ------- |
| 2026-05-24 | Persona defined from vertical-home design | None yet; not dogfooded | Ready as a peer-story and future Build Studio smoke once Dale's D38 blocker is cleared. |

## Open BIs from this persona's dogfooding

No Linda-specific dogfood deficiencies yet.

Related live backlog anchors:

- `BI-8954667A` - Clinic scheduler workspace home; live status `open`.
- `BI-1CCC6264` - Vertical workspace home substrate; live status `open`.
- `BI-3E8D2CF5` - Vertical workspace home projection service; live status `open`.
- `BI-4396EFEC` - Dale D38 plan-iteration divergence; live status `triaging`, gating new peer-persona Build Studio sessions.

## Source evidence

- Workspace-home anchor: [Vertical Workspace Home design](../superpowers/specs/2026-05-24-vertical-workspace-home-design.md).
- Archetype seed reality: `packages/storefront-templates/src/archetypes/healthcare-wellness.ts`.
- Vocabulary grounding: `apps/web/lib/storefront/archetype-vocabulary.ts`.
- Live backlog source at creation: MCP `get_backlog_item("BI-8954667A")`, `get_backlog_item("BI-1CCC6264")`, `get_backlog_item("BI-3E8D2CF5")`, and `get_backlog_item("BI-4396EFEC")` on 2026-05-24.
