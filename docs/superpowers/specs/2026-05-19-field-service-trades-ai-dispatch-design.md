# Field Service Trades — AI Dispatch & Field Technician Automation Design

| Field | Value |
| ----- | ----- |
| Status | Draft for review |
| Date | 2026-05-19 |
| Author | Mark Bodman |
| Scope | Trades archetype, field dispatch coworker, GPS automation, voice-first UX, customer notification routing, job lifecycle, QuickBooks mobile |
| Business archetype | `trades-maintenance` — HVAC / AC contractor (solo operator hiring first employee) |
| Related specs | [Small-Business OS Parity / QuickBooks Anchor](2026-05-16-small-business-os-parity-quickbooks-anchor-design.md), [Voice Input & Transcription](2026-05-16-voice-input-and-transcription-design.md), [Persona Voice Layer & TTS](2026-05-19-persona-voice-layer-wwtd-design.md), [Realtime HITL Mobile Companion](2026-05-13-realtime-hitl-mobile-companion-design.md), [Employee Communication Fabric](2026-05-15-employee-communication-fabric-design.md), [Autonomous Coworker Runtime](2026-05-11-autonomous-coworker-runtime-design.md) |

---

## 1. Purpose

A solo AC contractor running his business for four years is the canonical field service SMB. He quotes jobs, schedules visits, orders parts, collects payments, and manages customer expectations — today supported by QuickBooks, a collection of single-purpose tools, and his wife acting as dispatcher. She calls ahead to confirm appointments, checks in when jobs run long, and handles the downstream customers whose windows shift as a result.

He is now hiring his first employee. That changes the coordination surface: two technicians, two trucks, independent job streams, and a single admin burden that was already at capacity.

DPF's opportunity here is larger than a software swap. The platform already has customers, calendar, accounts receivable/payable, QuickBooks integration, voice input (Slice 1 in progress), TTS (in spec), mobile companion (in spec), communication fabric (WhatsApp/SMS/call), and a trades-maintenance archetype family. The gap is not the pieces — it is the **operational automation loop that connects them**, driven by a field-aware AI coworker that removes the dispatcher from the critical path.

This spec answers:

1. What does the field service SMB actually need day to day?
2. Which DPF capabilities already serve those needs?
3. Which gaps must be closed for this archetype to work end to end?
4. How can the contractor build this incrementally through Build Studio without a long-horizon software project?

---

## 2. Target Business Profile

**Archetype name:** HVAC / Field Service Contractor

**Operator profile:** 1–4 technicians including the owner. Owner-operator is in the field most of the time — driving between job sites, hands dirty, phone in a pocket or truck cupholder.

**Revenue model:** Quoted flat-rate or time-and-materials jobs. Emergency call-outs carry a premium. Maintenance contracts (recurring revenue) are the strategic goal. Parts are a pass-through with a margin.

**Tools currently in use:** QuickBooks Online (invoicing, payments, parts costs), phone calendar or simple booking app, Google Maps, a scheduling spreadsheet or whiteboard, SMS and phone calls from a mobile.

**Pain points to eliminate:**

| Pain point | Current workaround | Platform solution |
| ---------- | ------------------ | ----------------- |
| Customer not home, doesn't know ETA | Wife calls/texts "on his way" | GPS departure trigger → automated customer notification |
| Job runs long, next customer waits | Wife tracks, calls manually | AI coworker cascades ETA recalculation automatically |
| Appointment not confirmed, customer forgets | Wife calls day before | AI coworker confirmation workflow (SMS or voice call) |
| QuickBooks invoice while hands dirty | Pull over, type on phone | Voice dictation → structured invoice → QuickBooks |
| Parts to order mid-job | Note on paper, forget, follow up later | Voice command → purchase order → supplier |
| Two technicians, overlapping schedules | Whiteboard or spreadsheet | Unified calendar with dispatch coworker |
| New employee doesn't know the workflow | Training + oversight | AI coworker knows the process, guides both technicians |

**Scope:** US-based, residential and light commercial HVAC, service area within 1–2 hour radius. One QuickBooks install. Up to 8 jobs per technician per day.

---

## 3. Current DPF Capability Map

### 3.1 What DPF already has

| Capability | Status | Relevance to field service |
| ---------- | ------ | -------------------------- |
| Customers module (account, contact, site) | Active — schema and UI exist | Customer records, service addresses, contact preferences |
| Calendar infrastructure | Active — spec 2026-03-15 | Job scheduling, time-slot management |
| Storefront (trades-maintenance archetype) | Active — facilities, plumber, electrician, cleaning, landscaping | Customer-facing booking for trades — **no HVAC/AC archetype yet** |
| Accounts receivable | Active — invoices, payments, PDF send | Post-job invoicing and payment collection |
| Accounts payable | Active — suppliers, bills, purchase orders | Parts ordering, supplier management |
| QuickBooks integration | Active Slice 1 — read: company, customers, invoices | Invoice sync path exists; write requires Slice 6 |
| Communication fabric | Active — in-app, email; WhatsApp/SMS in progress | Customer notifications, appointment reminders |
| STT / voice input | Slice 1 in progress — speaches sidecar, portal mic button | Hands-free job logging, voice commands |
| TTS / voice output | In spec (2026-05-19) | Read back appointment details, job briefings |
| Mobile companion | In spec (HITL-focused Slice 1) | Field technician app — currently paused-work only |
| AI coworker runtime | Active — autonomous + HITL runtime | Dispatcher coworker, field coworker |
| GPS / location | **Not present** | Needs design — core to en-route automation |

### 3.2 What is missing

- **HVAC/AC contractor archetype** — no storefront template for HVAC-specific services (tune-up, refrigerant recharge, install, emergency call-out, maintenance contract)
- **GPS / geofence integration** — no location awareness for technicians or their devices
- **En-route automation** — no trigger-from-departure workflow
- **Customer notification preference model** — no per-customer "prefers call / prefers SMS" field or escalation logic
- **Pre-recorded / TTS outbound call** — no "call the customer and play a message" capability
- **Job lifecycle state machine** — no first-class `Job` entity with states (Quoted → Scheduled → Confirmed → EnRoute → OnSite → Complete → Invoiced → Paid)
- **Running-late cascade** — no logic to recalculate downstream ETAs when a job runs long
- **Dispatcher AI coworker** — no coworker role designed for field service coordination
- **Voice-first field UX** — mobile companion is HITL-approval focused, not field-technician-first

---

## 4. Research and Benchmarking

### 4.1 Commercial field service platforms

| Platform | Key capabilities | Relevant patterns |
| -------- | ---------------- | ----------------- |
| **ServiceTitan** | Job lifecycle, dispatch board, GPS tracking, customer notifications, QuickBooks sync, technician mobile app, revenue-optimized dispatch (Dispatch Pro), Pricebook Pro flat-rate pricing | Revenue-optimized dispatch assigns jobs to technicians based on revenue value, not just geography — drives close rates and upsell |
| **Housecall Pro** | Booking, scheduling, customer texting, GPS "on my way", invoice/payment, QuickBooks integration, **built-in AI CSR that answers inbound calls and books appointments**, automated email marketing | AI call answering is embedded in the base tier — the expectation for field service in 2026 is that the phone answers itself |
| **Jobber** | Quoting, scheduling, GPS tracking, automated reminders, client hub, QuickBooks/Xero sync, Wisetack customer financing | Financing integration for large jobs ($5K+) surfaces at invoice creation — not an afterthought |
| **FieldEdge** | HVAC-specific, flat-rate pricing, equipment history per customer site, maintenance agreements | Equipment record per customer site is the HVAC differentiator — tracks each unit's service history |
| **BuildOps** | Commercial HVAC/plumbing, subcontractor management, skill-based dispatch, 1099 labor | Subcontractor skill filtering (EPA 608 certified, licensed electrician) — relevant once business grows |
| **FieldPulse** | GPS fleet tracking, truck stock / van inventory with barcode scan, auto-reorder | Truck stock management is a day-to-day operational need — technicians run out of parts mid-job |

**Sources:** ServiceTitan HVAC features page, Housecall Pro HVAC software page, Jobber HVAC features, FieldEdge HVAC software overview, BuildOps platform pages, FieldPulse features (all reviewed 2026-05-19). FSM integration ecosystem review, AI dispatcher announcement (FieldCamp, 2026-03-19, Robotics & Automation News).

**Patterns adopted:**

- **Job as the unit of work** — every billable action links to a `Job`. Customers, invoices, parts, notes, and technician time all attach to it. The job is the operational record.
- **"On my way" as a first-class event** — GPS departure from previous job site (or manual trigger) fires a customer notification immediately. No human dispatcher needed.
- **Equipment history per site** — customer owns a unit (AC, furnace, heat pump). Technician can see: last service date, refrigerant type, model/serial, prior repairs. Enables flat-rate accuracy and maintenance upsell.
- **Maintenance agreements as recurring jobs** — the service contract is a scheduled job template, not a billing subscription alone.
- **Technician mobile as the operating surface** — technicians use phones; portal is for the office/owner. The mobile surface must support photo capture, customer sign-off, invoice creation, and payment collection.
- **AI inbound call answering** — Housecall Pro has embedded this in their base tier; the contractor's phone should answer itself, book the appointment, log the customer. DPF's STT/TTS infrastructure (both in progress) is the native foundation for this.
- **Customer financing at invoice creation** — for jobs over $3K, the invoice should offer a financing option (Wisetack or equivalent). No separate integration step; it appears automatically when the invoice total crosses a threshold.
- **Flat-rate pricing as operator-owned pricebook** — technicians should not be quoting from memory. DPF's storefront items are the pricebook; the AI coworker can suggest rates from hive mind pricing patterns (anonymized across installs).
- **Truck stock as a simple inventory layer** — technicians need to log parts used and see what's on their truck. Van inventory is not warehouse inventory; it's a small flat list with reorder thresholds.

**Patterns rejected:**

- **Full dispatch board UI** — ServiceTitan's drag-and-drop scheduling board is rich but complex to build. DPF's first-class calendar + AI coworker is the simpler, AI-native alternative. Build the coworker first; the visual board is a later enhancement.
- **Native payment hardware integration** — ServiceTitan and Jobber integrate tap-to-pay card readers. Stripe handles this at the payment layer; DPF's first-payment slice should rely on QuickBooks Payments or Stripe mobile links sent to the customer.
- **Licensed proprietary flat-rate pricing databases** — Flat Rate Plus, Profit Rhino, and ServiceTitan Pricebook Pro are licensed third-party content. DPF uses operator-defined storefront items enriched by hive mind pricing signals — no licensing fees and no vendor dependency.

### 4.2 HVAC-Specific Compliance — The Industry's Biggest Blind Spot

**EPA 608 refrigerant tracking is absent from every mainstream FSM platform.** This is not a minor feature gap — it is a mandatory federal compliance requirement. EPA 608 regulations require HVAC technicians to:

- Hold current EPA 608 certification for the refrigerant type they handle (Type I/II/III/Universal)
- Track refrigerant purchases, recovery, and disposal with documented logs
- Report refrigerant leaks above threshold rates on commercial equipment (≥50 lbs refrigerant charge: 30% annual leak rate triggers repair obligation)
- Certify equipment as leak-tight after repair

**Penalties:** $44,539+ per violation per day. Technician certification expiry during a job is an uninsured liability.

Specialized tools (OXmaint, ERA-EHS) cover this in isolation, but no mainstream FSM has native EPA 608 tracking. Every HVAC contractor using DPF needs this. It is a compliance gap the hive mind is positioned to fill: technician cert expiry dates, per-job refrigerant logs, equipment leak rate tracking.

**Utility rebate tracking is completely missing from every FSM.** In 2025-2026, federal and state programs offer $1,250 to $25,000+ per household for HVAC efficiency upgrades (HEEHRP / 25C tax credit, state rebate programs, utility instant rebates). No FSM platform surfaces available rebates by customer zip code, bundles them into the estimate, or generates the required documentation.

**This is a live customer value proposition.** A contractor who can say "your Carrier replacement qualifies for a $3,500 federal rebate and a $1,200 utility rebate — here's the form" closes more jobs and wins more trust. An AI coworker that looks up the customer's zip code and flags applicable rebates at estimate time is a significant differentiator the market does not have.

**AHRI certification lookup** — the Air-Conditioning, Heating, and Refrigeration Institute maintains a public directory ([ahridirectory.org](https://www.ahridirectory.org)) of certified equipment combinations. HVAC systems require a certified matched system (outdoor unit + coil + furnace) for warranty validity and utility rebate qualification. No FSM integrates AHRI lookup into the estimate workflow. An AI coworker that validates "this outdoor unit + this coil = certified match" before the estimate is submitted prevents installation failures.

### 4.3 Predictive Maintenance — The Unbuilt Opportunity

Every mainstream FSM is reactive: the customer calls when the AC fails. The platform handles the job. No platform has closed the loop from **equipment health signal → proactive outreach → scheduled PM → upsell financing → completed replacement**.

The components exist in isolation:

- IoT equipment monitoring (Monnit HVAC sensors: blower health, airspeed, electricity consumption)
- Proactive outreach (email/SMS campaigns in Housecall Pro)
- Customer financing (Wisetack in Jobber)
- Replacement quotes (estimate workflow in every FSM)

But no platform orchestrates them. The opportunity: a compressor running hot and cycling short trips a sensor alert → AI coworker notifies the technician → coworker drafts a "your equipment is showing early failure signs" customer outreach → customer schedules a diagnostic → diagnostic converts to a replacement quote → customer accepts financing → job booked.

DPF's autonomous coworker runtime is the orchestration layer this market needs. IoT integration is a future sprint, but the architecture must be designed to receive equipment health events and route them to the dispatcher coworker from the beginning.

### 4.4 GPS and Geofence Patterns

The "on my way" notification pattern is now standard in field service (Housecall Pro, Jobber, Google Maps sharing). The technical basis is geofence exit detection: when the technician's device leaves a job-site geofence (or departs from "home base" with a customer job in status `Scheduled`), the system fires the notification.

Two implementation approaches used by the field service industry:

1. **Native app background location** — the mobile app holds a background location permission; the device reports position periodically. Accurate but battery-intensive. Used by ServiceTitan, Jobber.
2. **Manual "start drive" trigger with ETA calculation** — the technician presses "I'm on my way" in the app; the system calls a mapping API for ETA, then fires the customer notification. Less accurate but battery-friendly and covers the "forgot to tap" case with a fallback.

DPF's first approach should be **approach 2 (manual trigger with GPS ETA)** for the MVP mobile companion slice, graduating to passive geofencing in a later slice once background location permissions are understood for the Expo app. The AI coworker should be smart enough to prompt the technician: "Ready to head to [customer name]? I'll let them know you're on the way."

### 4.5 Customer Notification Routing

Field service customers span a broad range: elderly homeowners who only have landlines, property managers who need SMS, commercial customers who prefer email. The pattern from Jobber and Housecall Pro is:

- Per-customer contact preference stored on the customer record
- Notification templates configurable per event (appointment confirmation, on-my-way, complete, invoice)
- Fallback escalation: try SMS first; if no mobile on record, call; if no answer, email

For calls without a live human (running late, appointment reminder), the industry standard is pre-recorded or TTS-generated voice messages. DPF's TTS layer (persona-voice-layer spec) is the foundation for this.

---

## 5. Substrate Audit

Per the [`verify-substrate-before-proposing-new`](../../../../../DPF/docs/founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md) kernel principle, every new entity or capability in this spec is checked against the live Prisma schema and existing platform services **before** being proposed. Findings drive the ADRs in §6.

| Proposal | Existing substrate (verified) | Recommendation |
| -------- | ----------------------------- | -------------- |
| New `Job` entity with state machine, customer/calendar links, technician assignment, notes, evidence | `WorkItem` (`packages/db/prisma/schema.prisma:7795`) carries: polymorphic `sourceType`/`sourceId`, `status` state machine, `urgency`, `effortClass`, `assignedToUserId` / `assignedToAgentId`, `calendarEventId` FK, `dueAt`, `evidence` Json, `parentItemId` hierarchy, `WorkItemMessage` thread, `routingDecision` Json | **Extend `WorkItem`, do not create `Job`.** Use `sourceType = "field-service-job"`, encode lifecycle states in `status` (`quoted/scheduled/confirmed/en-route/on-site/complete/invoiced/paid/cancelled`), attach equipment, refrigerant log, photos, and sign-off through `evidence`. Parent/child models the "main visit + parts orders + follow-up" composition. |
| Equipment record per customer site (model, serial, refrigerant type, install date, history) | `CustomerConfigurationItem` (`schema.prisma:2098`) already FKs to `CustomerSite`, carries `manufacturer / vendorName / productName / productModel / edition / serial` and friends | **Extend `CustomerConfigurationItem`** with an HVAC-specific Json sidecar (refrigerant type, install date, AHRI cert id, warranty terms). No new `EquipmentRecord` model. Resolves Deferred Decision §16.5. |
| Customer notification preference + landline/mobile distinction | `CustomerContact` (`schema.prisma:112`), `Notification` (`schema.prisma:3890`), `CommunicationDeliveryAttempt` (`schema.prisma:3983`) all present | **Additive migration** on `CustomerContact`: `preferredNotificationChannel`, `phoneType` (mobile/landline). Notification routing reads existing `CommunicationDeliveryAttempt` for dedupe. |
| Calendar / scheduling | `CalendarEvent` (`schema.prisma:5263`) with `WorkItem[]` relation already in place | Use `CalendarEvent` as the scheduling primitive; `WorkItem.calendarEventId` is the job ↔ calendar link. |
| Storefront archetype family | `trades-maintenance.ts` has `facilities-maintenance / plumber / electrician / cleaning / landscaping`; no dedicated `hvac-contractor` | New archetype is correct (no substrate to reuse). |
| GPS / location | No model present; intentional | Express as coworker tool (ADR-2), do not introduce a `Location` model. |

**Net effect on the spec:** Sprint 1 has **no new top-level Prisma models**. It is one new archetype, two additive migrations (`CustomerContact` fields, `CustomerConfigurationItem` Json sidecar), and a `WorkItem` lifecycle vocabulary for field service. This is materially smaller and lower-risk than the original "new `Job` model" framing.

---

## 6. Key Architecture Decisions

### ADR-1: The Field-Service Job Is a `WorkItem`, Not a New Entity

**Decision:** The operational record for field service work is a `WorkItem` row with `sourceType = "field-service-job"`. Lifecycle states live in `WorkItem.status` (`quoted | scheduled | confirmed | en-route | on-site | complete | invoiced | paid | cancelled`). Calendar slot lives on `WorkItem.calendarEventId`. Technician assignment uses existing `assignedToUserId`. On-site capture (photos, sign-off, refrigerant log, parts used) is written to `WorkItem.evidence`. Parent/child relationships model "main visit + parts orders + follow-up." Invoices are generated from a completed `WorkItem`, not the other way around.

**Rationale:** `WorkItem` (`packages/db/prisma/schema.prisma:7795`) was designed as a polymorphic unit-of-work substrate with exactly the fields a field service job needs (state, assignment, calendar link, urgency, due date, evidence, hierarchy, message thread, routing decision). Introducing a parallel `Job` model would duplicate this substrate, fragment routing, and split the dispatcher coworker's "what work is open?" view across two tables. The original ADR-1 draft missed this — see §5 substrate audit.

**Implication:** Sprint 1 ships a `WorkItem` extension (sourceType convention + `evidence` Json schema for field service), not a new top-level model. Dispatcher and field coworker skills query `WorkItem` directly. The "job" vocabulary appears in UI strings and archetype overrides (§11) — it is a presentation-layer concept layered onto a unified work substrate.

**Kernel principles applied:** [`verify-substrate-before-proposing-new`](../../../../../DPF/docs/founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md), [`research-before-implementing`](../../../../../DPF/docs/founder-kernel/wiki/principles/research-before-implementing.md).

### ADR-2: GPS Is a Coworker Tool, Not a Background Service

**Decision:** Location awareness is expressed as a coworker tool (`get_technician_location`, `calculate_eta`), not as a persistent background location service on the portal server. The mobile companion app holds the location permission; the server acts on location data only when the app sends it in response to a coworker prompt or technician action.

**Rationale:** Background server-side GPS tracking introduces privacy concerns, battery drain, data costs, and regulatory complexity (location data residency). The AI coworker pattern is pull-based: the coworker asks the app for location when needed to send an "on my way" notification or to calculate ETA. The app sends it once. No continuous stream.

**Implication:** The mobile companion needs a single-shot location fetch capability. The "on my way" flow is: technician taps "I'm leaving" in the app → app sends current location to the coworker → coworker calls mapping API for ETA → coworker sends customer notification. All triggered by the technician, not running in the background.

### ADR-3: Customer Notification Routing Is Governed by Preference, Not Channel Availability

**Decision:** Customer contact preference (`preferred_notification: sms | call | email`) is a first-class field on the customer record. The AI coworker reads this preference before dispatching any notification. Escalation logic (SMS → call → email) is codified in the dispatcher coworker prompt and configurable per install.

**Rationale:** Field service customers are heterogeneous. An automated SMS to a customer who only has a landline is a silent failure. The system must know the preference before acting, and must surface "could not notify" as an actionable alert, not a silent miss.

**Implication:** The customer module needs a `preferredNotificationChannel` field and a `mobilePhone` / `landlinePhone` distinction. Until this exists, the dispatcher coworker must ask the technician "Can this customer receive text messages?" before sending.

### ADR-4: Voice Is the Primary Input for Field Technicians

**Decision:** For any action a technician takes in the field (job notes, parts used, job complete, invoice line items, on-my-way), voice input via the STT pipeline (spec 2026-05-16) is the primary pathway. Type-based input is available but is a fallback.

**Rationale:** Dirty hands, gloves, truck cab, outdoor environment — the technician's physical context makes typing unreliable. Existing STT infrastructure (speaches sidecar, `AgentMessageInput` mic button) is being built now. The field technician mobile companion should be designed voice-first from the start, not retrofitted.

**Implication:** All field technician coworker skills must accept natural-language voice input. The coworker should be able to parse "I'm done, put down 2 hours labor and a $45 capacitor from Johnstone Supply" into structured invoice line items without requiring the technician to fill a form.

### ADR-5: QuickBooks Remains the Accounting System of Record for This Archetype

**Decision:** Per the [SMB OS Parity / QuickBooks Anchor spec](2026-05-16-small-business-os-parity-quickbooks-anchor-design.md) ADR-1 and ADR-3, DPF operates in `integration-led` mode for accounting. Jobs produce DPF invoices; invoices are proposed to QuickBooks via the approval-governed write path. The technician does not interact with QuickBooks directly — they interact with DPF, and DPF syncs.

**Rationale:** The contractor already trusts QuickBooks for taxes and accountant collaboration. DPF does not displace that trust; it makes the accounting happen automatically from the technician's field actions.

**Implication:** The "invoice created" event in the job lifecycle triggers a QuickBooks write proposal (Slice 6 of the QB anchor spec). Until that slice ships, invoices live in DPF's native AR module and can be exported manually. The contractor sees DPF as the operating surface; QuickBooks stays as the accounting truth.

### ADR-6: Field-Service Data Governance — Location, Refrigerant, and Hive Mind Boundaries

**Decision:** Three field-service data classes have distinct governance:

1. **GPS location** — captured per single-shot tool call (ADR-2), retained only on the `WorkItem` record that consumed it (e.g., the ETA snapshot at "on my way"). No continuous location stream is stored. Raw lat/lng older than the parent `WorkItem`'s close date is purged via the standard data-retention sweep.
2. **EPA 608 refrigerant logs and technician certifications** — treated as legal compliance records. Stored on `WorkItem.evidence` (per-job entries) and a new `ComplianceArtifact` row on the technician's `EmployeeProfile` (cert expiry). Immutable once written; corrections are append-only adjustments. Retention: 3 years minimum (EPA Section 608 record-keeping requirement).
3. **Hive mind contributions** — only the following signal classes leave the install: anonymized job-type taxonomy, notification template performance ratios, anonymized job duration distributions, anonymized rebate-program success rates. **Never contributed:** customer PII, addresses, GPS traces, technician names, refrigerant log content (legally sensitive), specific equipment serial numbers, invoice amounts.

**Rationale:** Field service generates exactly the categories of data that go wrong under careless defaults: location (privacy), compliance logs (legal exposure if mishandled), and customer-level business data (competitive harm if leaked through hive mind). Each class needs explicit handling — a generic "we collect data" framing is inadequate.

**Implication:** The hive contribution layer (per `feedback_obfuscated_not_anonymous`) carries a per-signal allowlist for the field-service archetype, not a blanket export. Refrigerant log writes go through an immutability guard. Mobile location capture surfaces an explicit per-action consent the first time the technician triggers it.

### ADR-7: Financing and Rebates Are Conduit-Only, Not Brokered

**Decision:** Customer financing (Wisetack, Synchrony, etc.) and utility rebate program enrollment are surfaced by the AI coworker as **information and pre-filled forms the customer or operator submits through their own account**. DPF does not enroll as a financing or rebate-platform partner, hold partner credentials, or earn referral fees through the platform.

**Rationale:** Per the `dpf-as-integration-conduit` standing rule (customer brings their own account, credentials, and vendor agreement; DPF never enrolls as a partner), enterprise integrations work through the operator's existing relationships. The "financing offered at invoice" pattern in §4.1 and §10.2 is correct in intent but must be implemented as: (a) detect the threshold, (b) generate the financing application link or rebate form the operator/customer signs in to themselves, (c) capture the resulting state back on the `WorkItem`. DPF never sits in the partner contract.

**Implication:** Sprint 10 (`BI-FS-027`, `BI-FS-029`) ships as a coworker skill that opens the financing provider's apply-link with prefilled query parameters and records the application id on the `WorkItem`. The operator configures their own Wisetack/Synchrony/utility account; DPF stores only the operator-supplied account identifier, not partner API keys held centrally.

---

## 7. Gap Analysis

| Capability | DPF Today | Priority | Approach |
| ---------- | --------- | -------- | -------- |
| HVAC/AC contractor archetype | Missing — trades-maintenance has plumber, electrician, etc. but no HVAC | High | Add `hvac-contractor` to `packages/storefront-templates/src/archetypes/trades-maintenance.ts` |
| Job entity with state machine | Missing | High | New `Job` model in Prisma — core entity for all field service work |
| Customer notification preference | Missing | High | Add `preferredNotificationChannel` and phone type fields to customer record |
| En-route / on-my-way notification | Missing | High | GPS tool in mobile app + dispatcher coworker skill |
| Running-late cascade | Missing | High | Coworker skill that recalculates ETAs for remaining jobs when one job runs long |
| Appointment confirmation workflow | Missing | High | Coworker skill: SMS/TTS call day before appointment |
| Voice-first job completion | Partial — STT Slice 1 in progress | High | Coworker skill: parse voice description → invoice line items |
| Customer equipment / site history | Missing | Medium | Equipment records per customer site (model, serial, service dates) |
| Maintenance agreement / recurring job | Missing | Medium | Recurring job template linked to service contract |
| Parts on the fly / voice PO | Partial — AP exists | Medium | Voice command → PO creation against supplier |
| TTS outbound call | In spec — not built | Medium | Persona voice layer + outbound calling via Twilio or equivalent |
| QuickBooks mobile voice | Partial — QB read exists; voice in progress | Medium | STT → coworker → QB write proposal (after QB Slice 6) |
| GPS ETA calculation | Missing | Medium | Mapping API integration (Google Maps / Mapbox distance matrix) |
| Job photo capture | Missing | Low | Mobile companion camera → job attachment |
| Customer sign-off / digital signature | Missing | Low | Mobile-first signature capture on job completion |
| Dispatch optimization (multi-technician) | Missing | Low | Scheduling coworker skill: sequence jobs by geography |
| Multi-technician schedule view | Partial — calendar exists | Low | Calendar view filtered by technician |
| **EPA 608 refrigerant tracking** | **Missing — no FSM covers this natively** | **High** | **Per-job refrigerant log, technician cert expiry, leak rate tracking; $44K+ penalty per violation** |
| **Utility rebate lookup by zip code** | **Missing from every FSM** | **High** | **AI coworker looks up HEEHRP / state / utility rebates at estimate time; flags qualifying jobs** |
| **AHRI system match validation** | **Missing** | **Medium** | **Validate outdoor unit + coil + furnace combination before estimate; required for warranty and rebates** |
| **AI inbound call answering** | **Missing** | **High** | **STT + TTS + dispatcher coworker: phone answers itself, books appointment, logs customer** |
| **Customer financing at invoice** | **Missing** | **Medium** | **Wisetack or equivalent: offer financing automatically when invoice > $3K** |
| **Truck stock / van inventory** | **Missing** | **Medium** | **Simple flat-list inventory per technician/truck; voice add/remove; reorder alert** |
| **Flat-rate pricebook** | **Partial — storefront items** | **Medium** | **Coworker-assisted pricing from hive mind signals; operator owns the rates** |
| **Opportunity flagging during job** | **Missing** | **Medium** | **Technician flags "also noticed X failing" → coworker drafts upsell quote while on site** |
| **Customer portal (service history + equipment)** | **Missing** | **Low** | **Customer-facing view of their equipment, service history, upcoming maintenance** |
| **Before/after photo documentation** | **Missing** | **Medium** | **Mobile camera → job attachment; required for warranty claims and customer disputes** |
| **IoT equipment health events (future)** | **Missing — architecture hook needed** | **Low** | **Equipment sensor alerts route to dispatcher coworker → proactive PM outreach** |
| **Seasonal demand forecasting + proactive outreach** | **Missing** | **Low** | **AI coworker identifies customers due for spring/fall tune-up; drafts outreach campaign** |
| **Technician close rate / scorecard** | **Missing** | **Low** | **Track which technician closes more quotes, generates more upsells** |

---

## 8. Recommended Architecture

The operational loop for a field service contractor is a six-stage cycle that runs multiple times per day:

```
Quote → Schedule → Confirm → Dispatch → On-Site → Close
  ↓        ↓          ↓          ↓         ↓         ↓
  AR       Cal       SMS/Call   GPS       Voice     Invoice
                               Trigger   Notes     + QB
```

Each transition in this loop is currently a manual action. The platform's job is to automate every transition that does not require a human decision.

### 8.1 Automation map

| Transition | Current state | Platform automation |
| ---------- | ------------- | ------------------- |
| Quote → Schedule | Technician types into calendar | Coworker parses voice: "Schedule the Johnson AC tune-up for Tuesday 10am" |
| Schedule → Confirm | Wife calls customer day before | Dispatcher coworker sends confirmation SMS (or TTS call) automatically at T-24h |
| Confirm → Dispatch | Manual — wife notifies customer | On departure tap: GPS ETA → coworker → SMS/TTS "on my way, ETA 20 min" |
| Between jobs (running late) | Wife tracks, calls next customer | Coworker monitors job duration against schedule; auto-notifies next customer |
| Dispatch → On-Site | No tracking | GPS arrival detection or manual "I'm here" tap |
| On-Site → Close | Technician types invoice on phone | Voice: "Done, 2 hours labor, new capacitor $45" → structured invoice |
| Close → Invoice | Manual QB entry | DPF invoice created from job → QB write proposal (after QB Slice 6) |
| Invoice → Paid | Manual follow-up | Stripe/QB payment link sent to customer on invoice creation |

### 8.2 Dispatcher AI Coworker

The dispatcher coworker is the AI replacement for the scheduling and coordination role currently held by the contractor's wife. It runs as an autonomous coworker with scheduled probes and event-triggered responses.

**Scheduled automations:**
- T-24h: confirmation SMS or TTS call for all jobs tomorrow
- T-1h: pre-job brief to technician (customer name, address, last service note, equipment on file)
- Daily morning: schedule overview for the day

**Event-triggered automations:**
- Job exceeds scheduled window by 15 minutes: check remaining schedule; notify next customer with updated ETA
- Technician taps "on my way": fire en-route notification to next customer
- Job marked complete: create invoice from job notes; send payment link

**Coworker tools required:**
- `get_jobs_for_day(date, technicianId)` — returns job schedule
- `send_customer_notification(jobId, template, channel)` — sends SMS/TTS call
- `calculate_eta(fromLocation, toCustomerSite)` — mapping API call
- `create_invoice_from_job(jobId, lineItems)` — creates DPF invoice
- `update_job_status(jobId, status)` — state machine transition

### 8.3 Field Technician Mobile UX

The mobile companion needs a dedicated field service UX that is distinct from the HITL approval surface. It is not a portal in a phone. It is the technician's operating surface for the job in front of them.

**Primary flows (all voice-capable):**

1. **Morning briefing** — opens to today's jobs with time, address, customer name. Tap any job for details. Voice: "What's my first job today?"
2. **On my way** — single tap fires en-route notification. Voice: "I'm heading to the Johnson job."
3. **On-site checklist** — voice-captured notes as they work. "Installing new capacitor, model 370v 50uf, Johnstone Supply part 88-1052."
4. **Parts order** — voice: "Order a 5-ton TXV for Thursday's install from Wittichen." → PO created.
5. **Job complete** — voice summary → structured invoice line items displayed for review → customer sends payment link.
6. **Dirty hands mode** — large touch targets, minimal typing, all confirmations by voice or single tap.

### 8.4 Customer Notification Routing

For each notification event, the dispatcher coworker follows this decision tree:

```
Does the customer have a mobile number? 
  → YES: prefer SMS unless customer preference = call
  → NO (landline only): use TTS outbound call
    → Call answered: deliver message
    → No answer: leave voicemail (TTS) + send email if on file
```

TTS outbound call requires Twilio or equivalent telephony integration. For the first slice, SMS via the communication fabric is sufficient. TTS calls are a Slice 3+ capability once the persona voice layer lands.

Notification templates per event (operator-configurable, hive mind seeded defaults):

| Event | Default message |
| ----- | --------------- |
| Appointment confirmation | "Your [service] appointment with [company] is confirmed for [date] at [time]. Reply YES to confirm or call us to reschedule." |
| On my way | "Your technician [name] is on the way to your [service] appointment. Estimated arrival: [ETA]. Your address: [address]." |
| Running late | "We're running a bit behind — your technician will now arrive at approximately [new ETA]. We apologize for the delay." |
| Job complete + invoice | "Your service is complete. Your invoice for $[amount] is ready: [payment link]. Thank you for choosing [company]." |

---

## 9. Backlog Structure

This epic spans multiple platform capability families. The recommended backlog structure is:

### Epic: EP-TRADES-FIELD-SERVICE (new)

**Title:** Field Service Trades — AI Dispatch & Field Automation

**Scope:** HVAC/field service contractor end-to-end: job lifecycle, dispatcher coworker, GPS en-route automation, customer notifications, voice-first mobile, QB sync.

### Backlog items (ordered by dependency and value)

**Sprint 1 — Foundation (no dependencies)**

- `BI-FS-001` HVAC/AC Contractor storefront archetype (`hvac-contractor` in trades-maintenance family)
- `BI-FS-002` Job entity with state machine (Prisma model: `Job`, states quoted/scheduled/confirmed/en-route/on-site/complete/invoiced/paid)
- `BI-FS-003` Customer notification preference fields (`preferredNotificationChannel`, phone type distinction on customer record)

**Sprint 2 — Dispatcher Coworker (depends: Sprint 1)**

- `BI-FS-004` Dispatcher AI coworker registration and grant seeding
- `BI-FS-005` Appointment confirmation skill (T-24h SMS trigger)
- `BI-FS-006` On-my-way notification skill (triggered by technician tap + manual ETA entry)
- `BI-FS-007` Running-late cascade skill (monitors job duration vs. schedule)

**Sprint 3 — Voice-First Job Close (depends: STT Slice 1)**

- `BI-FS-008` Voice job completion parser skill ("done, 2 hours labor, $45 capacitor" → invoice line items)
- `BI-FS-009` Voice PO creation skill ("order a [part] from [supplier]")
- `BI-FS-010` Field technician mobile companion UX (job list, on-my-way tap, voice note, job complete)

**Sprint 4 — GPS ETA (depends: Sprint 2, mobile companion)**

- `BI-FS-011` Mapping API integration (Google Maps / Mapbox distance matrix as a coworker tool)
- `BI-FS-012` GPS single-shot location fetch from mobile (app sends location to coworker on "on my way" tap)
- `BI-FS-013` ETA calculation in en-route notification (replaces manual ETA entry from Sprint 2)

**Sprint 5 — Equipment & History (depends: Sprint 1)**

- `BI-FS-014` Customer equipment record (unit model, serial, refrigerant type, install date, service history per customer site)
- `BI-FS-015` Pre-job brief skill (coworker assembles: customer name, address, equipment history, last service note, sends to technician T-1h before job)

**Sprint 6 — TTS Outbound Call (depends: TTS spec, Twilio integration)**

- `BI-FS-016` Outbound call with TTS message (dispatcher coworker calls customer and plays TTS notification)
- `BI-FS-017` Voicemail fallback + email escalation

**Sprint 7 — QuickBooks Sync (depends: QB Anchor Slice 6)**

- `BI-FS-018` Job-to-invoice QuickBooks write proposal (completed job → DPF invoice → QB sync with human approval)
- `BI-FS-019` Parts cost sync (PO parts cost → QB bill)

**Sprint 8 — Compliance & Rebates (high-value, no platform covers this)**

- `BI-FS-020` EPA 608 technician certification record (cert type, expiry date, license number; alert when expiring; block job assignment if expired)
- `BI-FS-021` Per-job refrigerant log (refrigerant type, lbs purchased/recovered/disposed, equipment serial; stored as job evidence)
- `BI-FS-022` Equipment leak rate tracker (commercial equipment: calculate annual leak rate, alert when threshold reached)
- `BI-FS-023` Utility rebate lookup coworker skill (customer zip code → available HEEHRP / state / utility rebate programs; surfaces at estimate time)
- `BI-FS-024` AHRI system match validator (outdoor unit model + coil + furnace → AHRI directory lookup; flags mismatch before estimate)

**Sprint 9 — AI Inbound Call Answering**

- `BI-FS-025` Inbound call handler (Twilio webhook → STT transcription → dispatcher coworker → book appointment → TTS confirmation; depends on TTS spec shipping)
- `BI-FS-026` After-hours booking flow (coworker books appointment for next available slot; sends SMS confirmation)

**Sprint 10 — Customer Financing & Upsell**

- `BI-FS-027` Customer financing offer at invoice (auto-surface financing link when invoice > configurable threshold, default $3K)
- `BI-FS-028` Opportunity flagging on job completion (technician voice-flags "also noticed X" → coworker drafts upsell quote while on site)
- `BI-FS-029` Truck stock / van inventory (simple flat-list inventory per technician; voice add/remove; low-stock alert)

**Sprint 11 — Predictive Maintenance (IoT architecture hook)**

- `BI-FS-030` Equipment health event intake (webhook receiver for IoT sensor events; routes to dispatcher coworker)
- `BI-FS-031` Proactive PM outreach skill (AI coworker identifies overdue maintenance + seasonal-demand customers; drafts outreach campaign)
- `BI-FS-032` Customer equipment health portal view (customer-facing: their units, service history, next PM due)

---

## 10. Market Differentiator Opportunities

Research revealed three areas where every existing FSM platform has a gap that DPF is uniquely positioned to fill. These are not just features — they are platform moats.

### 10.1 EPA 608 Compliance — The Industry's Unbuilt Requirement

EPA 608 refrigerant compliance is **mandatory federal law** for any HVAC technician who purchases or handles refrigerants. The penalty is $44,539+ per violation per day. Every HVAC contractor is exposed. No mainstream FSM platform (ServiceTitan, Housecall Pro, Jobber, FieldEdge) has native EPA 608 tracking built in. Contractors manage this with spreadsheets, paper logs, or standalone compliance tools that are completely disconnected from their job workflow.

DPF's opportunity: every job that involves refrigerant automatically creates a refrigerant log entry as part of the job close flow. The technician says "recovered 2.4 lbs R-410A, added 1.8 lbs" and the coworker logs it against the EPA 608 record without a separate form. Technician cert expiry is a calendar event. Commercial equipment with a high leak rate gets a compliance alert.

This is the kind of feature that sells the platform before any demo: "Do you have your EPA 608 logs current? With DPF, every job logs automatically."

### 10.2 Utility Rebate Intelligence — $1,250 to $25,000 per Household

Federal and state efficiency programs (HEEHRP, 25C tax credit, state energy offices, utility instant rebates) pay significant rebates for HVAC efficiency upgrades. In 2025-2026 these programs are at peak funding. No FSM platform surfaces rebate opportunities at estimate time.

The workflow DPF can offer: technician diagnoses an aging system → coworker looks up the customer's zip code → returns available rebates for the proposed replacement equipment → estimate includes the rebate math ("Your out-of-pocket after rebates: $4,200 instead of $9,800"). This is a close-rate advantage on every large-job quote. It also generates documentation the customer needs to claim the rebates, which builds trust and loyalty.

This requires two data sources: zip code → program lookup (state energy offices, DSIRE database) and equipment model → rebate eligibility lookup (ENERGY STAR, manufacturer rebate portals). Neither requires a license; both have public APIs or crawlable data.

### 10.3 The Predictive Maintenance Loop — What No Platform Has Orchestrated

The components for predictive HVAC maintenance exist in isolation across the market. No platform has assembled the orchestration:

```
Equipment health signal (IoT sensor / usage pattern / install age)
  → Dispatcher coworker alert
  → Proactive customer outreach ("your system is showing early warning signs")
  → Diagnostic appointment booked
  → On-site: technician confirms failure mode
  → Replacement quote with rebate calculation
  → Financing offer embedded in quote
  → Customer accepts → job scheduled → completed → invoice → paid
```

DPF's autonomous coworker runtime is built for exactly this kind of multi-step orchestration. The first implementation does not require IoT sensors — it can trigger from simple rules (equipment age from service history, time-since-last-service from job records, seasonal calendar). IoT sensor integration is a later enhancement that plugs into the same architecture.

**This is the "replace the wife" equivalent for proactive revenue generation.** Today, a contractor's seasonal revenue spike depends on whether they remember to call past customers before summer. DPF's dispatcher coworker does this automatically, every spring, for every customer with an aging system.

---

## 11. HVAC/AC Contractor Archetype

The `trades-maintenance` category currently has five archetypes. HVAC/AC is the most common field service SMB vertical and is not represented. The new `hvac-contractor` archetype should be added to `packages/storefront-templates/src/archetypes/trades-maintenance.ts`.

**Services:**
- AC Tune-Up / Preventive Maintenance — flat rate
- Emergency Service Call — from $x
- AC Installation — quote
- Heating System Service — from $x
- Refrigerant Recharge — from $x
- Indoor Air Quality Assessment — fixed
- Maintenance Agreement — subscription / recurring
- Commercial HVAC Service — quote

**Form fields:** name, email, phone, system type (Central AC / Heat Pump / Mini-Split / Gas Furnace / Commercial), urgency (Emergency / Next Available / Scheduled), property type (Residential / Commercial), notes.

**Storefront sections:** hero, items (services), about, testimonials, contact (Request Service).

**Vocabulary overrides for this archetype:**
- "Jobs" not "Orders"
- "Technician" not "Employee" 
- "Service call" not "Appointment"
- "Parts" not "Inventory items"

---

## 12. Smallest Buildable Slice

### Slice: HVAC Archetype + Job Entity + Dispatcher Coworker V1

**Why this slice:**

Every downstream automation (GPS, voice invoice, TTS calls) depends on the field-service `WorkItem` lifecycle being live. Per ADR-1, this is a `sourceType` convention and `evidence` Json schema on the existing `WorkItem` substrate — not a new top-level model. The HVAC archetype is the visible front door; the `WorkItem` lifecycle is the invisible foundation. Both can be built in one sprint without any external dependencies and without a heavy schema migration.

The dispatcher coworker V1 (appointment confirmation + on-my-way SMS with manual ETA) completes the first closed loop: technician taps "on my way" → customer gets a text. This is the single highest-value automation for this contractor: it removes the wife from the critical path for the most frequent daily action.

**Definition of done:**

- `hvac-contractor` archetype seeded to `StorefrontArchetype` via `trades-maintenance.ts` update; customer-facing booking works.
- `WorkItem.sourceType = "field-service-job"` registered as a first-class lifecycle in the work routing layer, with the §6 state vocabulary enforced; `evidence` Json schema documented and validated.
- Additive migration: `CustomerContact.preferredNotificationChannel` and `CustomerContact.phoneType` (mobile/landline) fields.
- `Dispatcher` coworker seeded with grants for `send_customer_notification` and `list_work_items` (filtered to field-service sourceType).
- Appointment confirmation runs at T-24h for field-service `WorkItem`s whose linked customer has a mobile number on file and `preferredNotificationChannel` permits SMS.
- Technician can mark a field-service `WorkItem` "en-route" from the portal (mobile companion in Sprint 3); dispatcher coworker sends SMS with manually entered or AI-estimated ETA.
- Notification dedupe via `CommunicationDeliveryAttempt` lookup (one per event per customer per `WorkItem`).
- All existing tests pass. `pnpm --filter web typecheck`. `next build` succeeds. Full vitest run green (per [`feedback_run_full_tests_before_push`](../../../../../../../../Users/Mark%20Bodman/.claude/projects/D--DPF/memory/feedback_run_full_tests_before_push.md)).
- UX: dispatcher panel visible in the portal, today's field-service work list shows state chips and notification history.

---

## 13. Build Studio Path

This epic is specifically designed to be built iteratively by the contractor themselves using Build Studio, once the DPF platform reaches them. The sprint structure maps directly to Build Studio intake prompts.

**Hive mind value chain:**

Every HVAC contractor running DPF contributes:
- Job type taxonomy (common repair types, parts, labor codes) — anonymized
- Notification template performance (which message variants get reply / confirmation rates)
- Seasonal demand patterns (without PII)
- Routing efficiency baselines (job duration vs. job type) — anonymized

The hive mind receives these contributions and feeds improved defaults back to every new HVAC contractor install: better flat-rate price suggestions, better appointment window defaults, better notification timing.

**Iterative Build Studio prompts (examples a contractor could use):**

1. "Add a way for customers to book an AC tune-up from my website"
2. "Text my next customer automatically when I leave a job"
3. "Let me say what I did on a job and turn it into an invoice"
4. "Order parts by voice"
5. "Call customers who can't receive texts to confirm tomorrow's appointments"

Each of these maps to a defined backlog item. The contractor does not need to understand the architecture — they describe the problem and Build Studio delivers the slice.

---

## 14. UX Direction

**Mobile-first, voice-first, glance-friendly.**

The primary user surface for a field technician is their phone, often in a truck cab or at a job site. The UX must:

- Show the current job prominently: customer name, address, arrival time.
- Provide single-tap actions for the most common transitions: "I'm on my way" / "I'm here" / "Job done."
- Accept voice for everything that requires more than a tap.
- Minimize form fields — "what did you do?" is a voice prompt, not a multi-field form.
- Surface alerts (running late, customer callback needed) as push notifications with one-tap actions.

**Portal (owner/admin side):**

- Schedule view: jobs by technician, day view and week view, state chips color-coded by lifecycle stage.
- Dispatcher panel: today's jobs, notification history, any coworker alerts.
- Customer panel: equipment history per site visible alongside customer record.

---

## 15. Risks

| Risk | Likelihood | Severity | Mitigation |
| ---- | ---------- | -------- | ---------- |
| `WorkItem` extension semantics conflict with other `sourceType` consumers | Low | Medium | Reserve `sourceType = "field-service-job"` namespace; add an `evidence` Json schema validator for the field-service shape; do not overload existing sourceTypes (resolved per §5 substrate audit, ADR-1) |
| GPS background permission denied on iOS | High | Medium | Slice 1 uses manual "on my way" tap only; background GPS is Sprint 4+ |
| TTS outbound call requires Twilio account setup | High | Medium | First slice uses SMS only; TTS call is Sprint 6 with explicit Twilio activation |
| Notification spam if dispatcher coworker fires redundantly | Medium | High | Deduplication guard: one notification per event per customer per job; log all sends to `CommunicationDeliveryAttempt` |
| QB write proposal requires Slice 6 of QB anchor spec | High (dependency) | Medium | Sprint 7 is explicitly gated on QB anchor Slice 6 shipping; earlier sprints use DPF-native invoicing only |
| Multi-technician scheduling complexity | Low (Sprint 1 is solo) | Medium | Start solo-tech; technician assignment added in Sprint 4 when second employee is active |
| EPA 608 compliance data accuracy | Medium | High | Refrigerant logs are legal documents. Display a clear disclaimer that DPF provides a log-keeping tool, not legal compliance advice. Operator is responsible for record accuracy. |
| Rebate program data staleness | High | Low | HEEHRP / state programs change frequently. Rebate lookup must show last-fetched date and link to the authoritative source; never present estimated rebate amounts as guaranteed. |
| AHRI directory availability | Low | Medium | AHRI directory is a public service; use as a validation hint, not a hard gate. If lookup fails, the estimate proceeds without AHRI validation and flags for manual check. |
| IoT sensor integration scope creep | Low | Medium | IoT architecture hook (Sprint 11) is a webhook receiver and event router only. Full IoT sensor management is a separate spec. Do not bundle them. |

---

## 16. Deferred Decisions

1. ~~**`Job` model vs. extension of `CalendarEvent` or `StorefrontOrder`**~~ — **Resolved in §5 / ADR-1: extend `WorkItem`, no new model.**

2. **Mapping API provider**: Google Maps Distance Matrix vs. Mapbox vs. OpenRouteService (OSS). Deferred to Sprint 4. The coworker tool abstracts the provider; the choice does not affect earlier sprints. Recommendation: default to OpenRouteService (OSS, no key cost for low volume) with a provider interface so Google/Mapbox can be swapped per install.

3. **Outbound voice call provider**: Twilio is the default assumption; Vonage and Amazon Connect are alternatives. Deferred to Sprint 6. The notification routing abstraction (per ADR-3) is provider-agnostic. Per ADR-7 conduit framing, the operator supplies the Twilio account — DPF does not hold a centralized Twilio key.

4. **Maintenance agreement billing model**: Recurring job template vs. subscription billing (Stripe recurring). Deferred to Sprint 5. The simplest first version is a recurring `CalendarEvent` template that spawns a `WorkItem` per occurrence; subscription billing layers on later.

5. ~~**Equipment record as its own model vs. extension of `CustomerSite`**~~ — **Resolved in §5: extend `CustomerConfigurationItem` (already FKs to `CustomerSite`) with an HVAC Json sidecar.**

6. **Refrigerant log immutability mechanism**: Append-only Json log on `WorkItem.evidence` vs. dedicated `ComplianceArtifact` rows. Deferred to Sprint 8 design phase. ADR-6 commits to immutability semantics; the implementation choice is open.

7. **Hive contribution allowlist for field service**: The per-signal allowlist in ADR-6 needs operator-facing visibility (a settings page that shows exactly which signals leave the install). Deferred to Sprint 11.

---

## 17. Recommended Next Step

**Immediate:** File `EP-TRADES-FIELD-SERVICE` as a new epic in the backlog, commit this spec to `main`, and feed it to `writing-plans` to produce the Sprint 1 implementation plan covering:
- `hvac-contractor` archetype addition to `packages/storefront-templates/src/archetypes/trades-maintenance.ts`
- `WorkItem.sourceType = "field-service-job"` lifecycle + `evidence` Json schema (no new top-level model per ADR-1 / §5 substrate audit)
- Additive migration on `CustomerContact` for `preferredNotificationChannel` and `phoneType`
- Dispatcher coworker V1 seeding with appointment confirmation + on-my-way SMS skills

**Safe to parallelize:**
- HVAC archetype addition to storefront-templates (zero dependencies, one file change + test)
- `CustomerContact` notification preference fields (additive Prisma migration)

**Do not start yet:**
- GPS ETA calculation (depends on mobile companion GPS permission design)
- TTS outbound calls (depends on persona voice layer spec shipping)
- QB write sync (depends on QB Anchor Slice 6)
- IoT health event intake (deliberately a Sprint 11 architecture hook only; full IoT management is a separate spec — see §15 risks)
- Refrigerant log immutability mechanism (Sprint 8, per Deferred Decision §16.6)
