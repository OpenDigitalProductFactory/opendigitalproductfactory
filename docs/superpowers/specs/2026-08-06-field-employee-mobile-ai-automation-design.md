# Field Employee Mobile — Field Service & HOA Inspections, AI-Assisted (Design / Brainstorm)

**Date:** 2026-08-06
**Status:** Draft — brainstorm for operator review (options not yet decided)
**Epic:** EP-MOBILE-IOS-APP (employee half) · EP-VERTICAL-HOA-PROPERTY (HOA readiness)
**Origin:** Operator direction 2026-08-06 — "the employee aspects of the mobile app… field service, where the tether to their company and activities in the field are highly dependent on the phone app… and HOA inspections. Taking pictures to process, customer/resident detail, invoicing and payments. Many field-based jobs would benefit from AI-assisted automation that takes care of things in the background."

## 1. The decision, in one sentence

How should the mobile app deliver a "tether-to-company + do-the-field-work" **employee** experience for two field-based archetypes — **field service** (dispatched jobs: photo capture → processing, customer detail, invoice, payment) and **HOA inspections** (property/resident-centric inspection capture) — with **AI-assisted background automation** absorbing the busywork, *reusing* DPF's existing substrate rather than rebuilding?

## 2. What the substrate actually is (grounded, 2026-08-06 research)

The single most important finding: **the mobile app is a thin, partly-stubbed shell over a rich but disconnected backend.** The gaps are mostly *connective* and *capture-primitive*, not missing intelligence.

**Field service — mostly built, key primitives stubbed:**
- Generic `WorkItem` (`schema.prisma:13591`) is the job substrate — free-text `status`, `evidence Json?`, assignment triple, **no location/account FK** (account resolved at read-time, `apps/web/lib/api/work-item-account-resolution.ts`).
- The mobile jobs flow is **real and wired** end-to-end: list → detail (status action map) → complete/capture → draft invoice → collect payment (`apps/mobile/app/(tabs)/jobs/*`, real `/api/v1/*` endpoints).
- **Capture is stubbed:** `stubCapture` returns a 1×1 PNG (`imageSource.ts`); `CameraField`/`SignatureField`/`LocationField` are placeholders; **no voice/audio field exists**.
- **Payment is manual-only:** cash/cheque/card-manual, no processor; customer self-pay punts to the web portal (App Store 3.1.3(e) owner-action P0).
- Field service is a **derived "Field Dispatch" capability** (`field-dispatch.ts`), not an archetype; `hvac-contractor` (Dale's HVAC) is the reference vertical; compliance overlays exist (`epa-608`…) but `BUILTIN_PROFILES` is empty.
- **No employee cockpit/home** surface exists — only the persona-gated `jobs` tab.

**HOA inspections — archetype exists as marketing only; execution is greenfield:**
- `hoa-property-management` archetype family exists (`hoa-property-management.ts`: homeowners-association, condo-association, property-management-company) with readiness epic `EP-VERTICAL-HOA-PROPERTY` (open) — but it is **storefront/activation template only; no operational data model**.
- **No `Inspection`/`Checklist`/`Violation` model, no Property/Unit/Resident entity.** `CustomerSite` (`schema.prisma:4021`) + `Address` + `ServiceTicket` are the nearest reusable "site" substrate.
- **Strong reuse win:** the server-driven **dynamic-forms** substrate is real — `DynamicFormSchema` with an **`offlineCapable`** flag (`packages/types/src/dynamic.ts`), `FormRenderer`, and `camera`/`signature`/`location`/`select`/`multi-select` field types — a natural carrier for an inspection checklist. Gap: the portal producer `buildManifest` doesn't yet emit `screens[]`.

**AI automation — the brain exists; the mobile app isn't plugged into it:**
- The **coworker brain** (`summon_coworker` → `spawnWorkThread` → routed inference) and **production-grade scheduled/background automation** (`create_scheduled_agent_task` → Inngest `*/5` cron → `TaskRun` executor, with a proposal/approval gate) are real — but the mobile agent endpoints are **stubs** (persist the user message, never reach the brain; stream is a literal stub).
- **Photo capture → upload → `WorkItem.evidence` is real plumbing; image AI ("to process") is absent** (`analyze_brand_document` is a passthrough stub; no OCR/vision).
- **Offline queue engine is real, tested, wired at startup — but never fed** (`enqueue` has zero callers); offline field work currently *drops*.

## 3. The shared spine vs the two archetype heads

Both archetypes want the same **field-work spine**, then diverge at the head:

| Spine (shared) | Field-service head | HOA-inspection head |
|---|---|---|
| Real capture (camera/signature/location/voice) | Job lifecycle (accept→check-in→complete) | Inspection checklist (per property/unit) |
| Offline-first (feed the queue) | Draft invoice from job + photos | Report + violations, dues/fine invoice |
| Evidence → structured (vision/OCR) | Collect payment (the P0 processor gap) | Property / resident detail |
| AI-assist (coworker + scheduled tasks) | Compliance artifacts at job close | Recurring inspection scheduling |

## 4. Options (architecturally distinct)

### Option A — Wire the existing substrate (thin, reuse-max, connective)
Build nothing new in the data model. Deliver by **connecting what exists**: swap capture stubs for real `expo-*` primitives; route mutations through the offline queue; wire the mobile agent endpoints to the real coworker brain + scheduled tasks; render HOA inspections as **offline-capable `DynamicFormSchema` checklists** over `CustomerSite` (emit `screens[]` from `buildManifest`). AI automation = coworker/scheduled-task **proposals** surfaced in the mobile agent panel (draft invoice, file evidence, notify resident).
- **Wins:** speed, low blast radius, maximal reuse, ships value per slice.
- **Loses:** inspections are form *blobs*, not queryable entities; no violation/property analytics; HOA stays storefront-shaped operationally.

### Option B — First-class field-operations domain (durable rebuild of the domain layer)
Introduce the missing operational models: a real `Inspection`/`Checklist`/`Violation` entity; `Property`/`Unit`/`Resident` (or a generalized `CustomerSite`); a field-service job specialization of `WorkItem` with location/account FKs and evidence-as-relations. Then build mobile + AI on top.
- **Wins:** queryable domain, analytics ("open-aging inspections", violation backlog — the metrics the HOA business-view already names), deep HOA operations, long-term maintainability.
- **Loses:** large blast radius + migrations; slow; risks over-building before demand is proven; duplicates `WorkItem`/`CustomerSite` if not careful.

### Option C — Agent-native field ops (invert the surface)
Make the field worker's primary interface the **coworker**, not screens. The app captures signals (photos, geo, voice); a **field-ops coworker** does the busywork in the background — draft the invoice from the job + photos, auto-file evidence, generate the inspection report, flag violations, notify the resident — and screens become **confirmations of agent proposals**. Leans hard on the real scheduled-task/coworker substrate + fills the vision/OCR gap.
- **Wins:** directly realizes "just take care of things in the background"; differentiation; minimal per-archetype UI.
- **Loses:** depends on the vision/OCR gap being filled and reliable inference; trust/verification burden (the proposal gate matters); the automation substrate isn't mobile-wired yet (so it *needs* A first).

## 5. Tension summary (raw material for the kernel)

| Option | Wins on | Loses on |
|---|---|---|
| A Wire-existing | speed · blast-radius · reuse | shallow domain (form blobs, no analytics) |
| B Domain-rebuild | queryable domain · HOA depth · durability | slow · large blast radius · over-build risk |
| C Agent-native | the actual "background automation" vision · differentiation | needs A first · vision/OCR gap · trust burden |

## 6. Recommendation (kernel-confirmed)

**Sequence A → C, with surgical B only where HOA needs queryable entities.** A is the unavoidable foundation (nothing — including C — works until capture is real, the offline queue is fed, and the mobile app can reach the brain). C is the differentiator that delivers the operator's actual vision, and it *requires* A's wiring. B is not a phase but a scalpel: introduce a first-class `Inspection` (+ minimal `Property`/`Resident`) **only** for the HOA head, because "open-aging inspections" and "violation backlog" are analytics the HOA business-view already promises and a form-blob cannot answer — while field-service stays on `WorkItem` (Option A) where a job blob is sufficient.

**Kernel consultation (WWMD, `principle_decide`, 2026-08-06):** recommends **A-wire-existing** — composite **4.97**, margin **1.52**, confidence **high** (C-agent-native 3.45; B-domain-rebuild 2.76). Decisive positive contributors: *Ground New Work In Existing Platform* (+0.53), *Single Source of Truth* (+0.46). What sank B: the cost axes — *Never wipe the DB* (−0.29), *Outbound/irreversible require explicit go* (−0.31), *All Changes via PR* (−0.24); B's blast radius dominates. No commandment conflict; structured coverage strong. The kernel weights *grounding in existing substrate* as the deciding axis and penalizes a domain rebuild's reach — confirming the A → C sequence with surgical-B-only-for-HOA, not by gut. **Operator ruled field-service (HVAC) leads.**

## 7. Proposed decomposition (candidate BIs — file on approval)

**Spine (shared, Option A foundation):**
1. Real capture primitives — `expo-image-picker`/`expo-camera` (swap `stubCapture`), real `SignatureField` (canvas), real `LocationField` (`expo-location`), **new voice/audio field** (`expo-audio`). (Absorbs BI-B24753FC, BI-8FE69AB2, BI-5EB95B96.)
2. Feed the offline queue — route job/evidence/inspection mutations through `enqueue` so field work survives offline.
3. Wire mobile agent → real brain — point the v1 agent endpoints at `spawnWorkThread`/coworker; surface proposals in the mobile agent panel.
4. Vision/OCR "process the picture" — real image→structured-data handler (replace the `analyze_brand_document` stub pattern) for receipts/nameplates/inspection photos.

**Field-service head (Option A on `WorkItem`):**
5. In-app payment processor (the App Store P0) — tech-side + customer self-pay via each org's processor (ties to the walk-up BI-45189351 wallet work).
6. AI draft-invoice-from-job — coworker drafts the invoice from the completed job + captured photos, tech confirms.
7. Employee field-tech cockpit/home (BI-24150E16) — jobs + schedule + earnings + agent, the "tether to company" home.

**HOA-inspection head (Option A forms + surgical B):**
8. Inspection-as-DynamicForm — emit `screens[]` from `buildManifest`; an inspection = an offline-capable checklist over a site.
9. First-class `Inspection` (+ minimal `Property`/`Resident`) — the surgical-B entity for queryable inspection/violation analytics.
10. HOA operational activation — resident/unit detail, recurring inspection scheduling, dues/fine invoicing on the HOA archetype.

## 8. Open questions for the operator

- **B scope:** do HOA inspections need queryable violation/aging analytics now (→ build `Inspection` entity), or is a form-blob + generated PDF report enough for a first cut?
- **Automation trust:** how much should the field-ops coworker do **autonomously** vs always propose-and-confirm? (The proposal gate exists; the question is default posture.)
- **Two heads, one spine:** confirm the shared-spine framing — build the spine once and specialize, rather than two parallel archetype apps.
- **Priority order** between the field-service head and the HOA-inspection head.
