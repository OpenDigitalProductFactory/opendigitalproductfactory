# Greenhouse ATS — Absorption Scoping & Design (bridge → absorb → replace)

- **Status:** Design / scoping (research + backlog only; no code, no customer-data change).
- **Date:** 2026-08-05
- **Anchor BI:** BI-E5561DC9 — *Greenhouse ATS integration → convergence-to-native recruiting* (epic EP-ECOSYSTEM-ABSORPTION-ARCH).
- **Native-models BI:** BI-F3AEBF68 — *Recruiting / ATS — requisition to hire, converting into the worker record* (epic EP-PEOPLE-HCM-CORE). This design **defines the models that BI already needs**; it is not a duplicate.
- **Doctrine:** BI-COP-005 (edge-adapter-to-native convergence, *done*), BI-COP-007 (ecosystem absorption loop). Generic primitives to reuse, **not duplicate**: BI-ECO-003 (canonical external-entity crosswalk registry), BI-ECO-004 (unified integration event/action/receipt bus), BI-ECO-002 (native graduation gates).
- **Driving customer:** Infinitum — Austin electric-motor OEM, ~200 employees + ~75 planned hires. US corporate/engineering hiring **plus high-volume hourly plant hiring in Mexico** (Tijuana, BC + Ramos Arizpe/Saltillo, Coahuila). Runs Greenhouse today. (Source of intent: `docs/test-plans/2026-08-05-infinitum-manufacturer-archetype-testplan.md` — research artifact, not committed to main; customer context restated inline so this doc stands alone.)

---

## 1. Executive summary

DPF has **no native recruiting capability** — verified absent: `^model` grep for Requisition/Candidate/Application/Offer/Interview/Scorecard/Opening returns zero, and BI-F3AEBF68 records "Verified absent 2026-08-05… a person can only enter DPF already hired" via `createEmployeeProfile`. There is a pipeline-shaped hole in front of `EmployeeProfile`.

The absorption doctrine (BI-COP-005) says: don't stop at an adapter. **Bridge** Greenhouse (read its pipeline, land its hires), **absorb** it (surface the funnel natively), then **replace** it (native parity + cutover). This document maps every Greenhouse object to a native DPF recruiting model, lays out the three phases with a dual-run cutover, records the kernel's connector-architecture decision, and sequences which ATSs come after Greenhouse.

**Headline decisions:**
1. **Connector architecture: direct-native connectors** (kernel-decided, high confidence — §5). Greenhouse native first, Fountain native second. A unified-API adapter (Merge/Kombo) is **deferred and separately gated**, not baked in.
2. **Native recruiting model** (§3) splits Greenhouse's overloaded "Job" into `JobRequisition` + `JobPosting`, models `Candidate` as a first-class pre-hire entity that **converts** to `EmployeeProfile` (one worker object, no re-key), and makes demographic capture **jurisdiction-gated** (US OFCCP requires it; Mexico restricts it).
3. **Reuse, don't rebuild:** the ADP native-connector paved road, the `IntegrationImportBatch`/`IntegrationImportStagedRecord` staging pipeline, the Postmark inbound-webhook kernel (`verifyInboundSignature` + `executeCallbackTransaction`), and the onboarding roster→`EmployeeProfile` landing are all already built. Two **net-new seams** remain: a recruiting-domain crosswalk and an idempotent external-source key on the hire landing.

---

## 2. Substrate verification (what already exists)

All paths relative to the repo root. Verified 2026-08-05 in this worktree.

| Capability | Verdict | Location / evidence |
|---|---|---|
| Native recruiting models | **ABSENT** (definitive) | `schema.prisma` — no Requisition/Candidate/Application/Offer/Interview/Scorecard/Opening model; BI-F3AEBF68 confirms |
| Native-connector paved road | **EXISTS** (live mTLS+OAuth2, not mock) | `apps/web/lib/integrate/adp/` (`connect-action.ts`, `token-client.ts`, `cert-parse.ts`, `redact.ts`) + `apps/web/components/integrations/AdpConnectPanel.tsx` + `app/api/integrations/adp/connect/route.ts` |
| Per-install connection state | **EXISTS** | `IntegrationCredential` (`schema.prisma:2646`) — unique on `integrationId`, encrypted `fieldsEnc`/`tokenCacheEnc` via `@/lib/govern/credential-crypto` |
| Import staging pipeline | **EXISTS** (reusable as-is) | `IntegrationImportBatch` (`schema.prisma:2748`) → `IntegrationImportStagedRecord` (`:2765`): `sourceProvider`, `entityFamily`, `externalId`, `proposedLocalEntityType`, `reviewStatus="candidate"`, `proposedLocalConfidence`, `sourceFingerprint` |
| Redaction before LLM context | **EXISTS** (shared) | `packages/integration-shared/src/redact.ts` — SSN/bank/DOB masking + jailbreak scrub; re-exported by `adp/redact.ts` |
| Inbound-webhook kernel | **EXISTS** (connector-agnostic) | `app/api/integrations/email-postmark/inbound/route.ts` → `verifyInboundSignature` + `executeCallbackTransaction({deliveryKey, performDomainWrite})` from `@/lib/integrations/kernel/audit`; durable audit + queue fallback |
| Catalog registration | **EXISTS** (three surfaces) | (a) portfolio manifest `packages/db/src/portfolio-sources/supported-integrations-manifest.ts` → projected `int-${slug}` id; (b) native descriptor `apps/web/lib/tools/native-integration-catalog.ts` (`NATIVE_INTEGRATIONS`, closed union `NativeIntegrationId`); (c) runtime merge `apps/web/lib/actions/connection-catalog.ts` (`getConnectionCatalog`) |
| Onboarding hire landing | **EXISTS** | `apps/web/lib/onboarding/roster-import-actions.ts:36` `importRoster(confirmed, db)` → `EmployeeProfile` (`schema.prisma:410`); dedupes on lowercased `workEmail`, create-only, fail-soft (BI-9B1E403D, EP-ONBOARDING-INTAKE) |
| MDM crosswalk | **EXISTS** but **not for workers** | `MasterDataSourceRef` (`schema.prisma:12245`) soft-ref `(domain, sourceSystem, sourceEntityId) → canonicalId`; typed FKs only for `CustomerAccount`/`Supplier`. Helpers in `apps/web/lib/mdm/` (`crosswalk.ts`, `domain-registry.ts`). **No employee/worker domain.** |

**Correction to prior context:** `int-fishbowl` does **not** exist; `int-jira`/`int-quickbooks`/`int-xero` are real. The `int-*` ids are *projected* (`int-${slug}`) from the manifest, not hand-authored rows. Fishbowl appears only as an incumbent name in `apps/web/lib/tools/integration-coverage-matrix.ts`.

### 2.1 The two net-new seams

Everything else is reuse. These two are genuinely new work:

- **Seam A — recruiting crosswalk.** `MasterDataSourceRef` has no `employee`/`worker` domain and no `EmployeeProfile` FK; employees are *identity-bearing* and resolve through `PrincipalAlias`, not `MasterDataSourceRef`. Mapping a Greenhouse candidate/application to a DPF native record uses the **existing soft-ref** (`domain="recruiting-candidate"|"recruiting-application"`, `sourceSystem="greenhouse"`, `sourceEntityId=<gh id>`, `canonicalId=<dpf id>`) — **no schema change needed for the candidate/application crosswalk**. Mapping a Greenhouse *hire* to a DPF *worker* needs either a new `worker` MDM domain + `employeeProfileId` FK, **or** a `PrincipalAlias` entry — decision in §7. Ties to BI-ECO-003.
- **Seam B — idempotent hire landing.** `importRoster` dedupes on `workEmail` only and is create-only; `EmployeeProfile` has **no external-id / source-system column**. A Greenhouse hire re-delivered by webhook would create a duplicate or silently skip on email. The landing path needs an external-source key (Greenhouse `candidate_id` + `application_id`) to be idempotent. Ties to Seam A.

---

## 3. Greenhouse object → DPF native-recruiting model mapping

This section **defines the native models BI-F3AEBF68 needs**. Naming follows HR Open Standards (HR-JSON Recruiting/Candidate) where practical, and splits Greenhouse's conflated objects into DPF-canonical shapes.

### 3.1 Object mapping

| Greenhouse object | DPF native model (new) | Notes / transformation |
|---|---|---|
| **Job** | **`JobRequisition`** (+ `JobPosting`) | Greenhouse conflates the internal req and the public posting. DPF splits: the req (headcount, approval, hiring team) vs the posting (public content, syndication). |
| **Opening** (requisition slot) | **`RequisitionOpening`** (child of `JobRequisition`) | Each opening = one headcount slot, tied to `Position`; a hire fills a specific opening (`application_id` binds the filled slot). |
| **Candidate** | **`Candidate`** | First-class pre-hire person. **Not** an `EmployeeProfile` until hired. Carries contact info, source, attachments. |
| **Prospect** | `Candidate` with `kind="prospect"` | Greenhouse models prospect vs candidate as `application.prospect: bool`; DPF keeps one `Candidate` with a `kind` discriminator + prospect→candidate conversion. |
| **Application** | **`Application`** | The pipeline join (candidate ↔ requisition). `status ∈ {active, rejected, hired, withdrawn, converted}`. Exactly one requisition for a candidate application; 0+ for a prospect. |
| **Job Stage** | **`PipelineStage`** | Ordered stages per requisition (or per template). `Application.currentStageId` points here. |
| **Scheduled Interview** | **`ScheduledInterview`** | `applicationId`, `stageId`, `start`/`end`, `interviewers[]`, `location`, `videoUrl`, `status`. |
| **Scorecard** | **`Scorecard`** | `applicationId`, `interviewId?`, `submittedById`, `overallRecommendation`, `attributes` (json rows), ratings. Read-only from Greenhouse (Harvest exposes GET only). |
| **Offer** | **`Offer`** | `applicationId`, `version`, `status ∈ {draft, approved, sent, accepted, declined, rescinded}`, `startDate`, `compensation` (json), approval chain. Harvest exposes GET-list + PATCH-current only. |
| **User** (hiring team) | Link to `EmployeeProfile`/`User` | Recruiter/coordinator/hiring-manager references resolve to DPF workers via crosswalk; unmatched Greenhouse users staged for review. |
| **Department** | **`Department`** (existing) | Reuse existing model; crosswalk by name/external id. |
| **Office** | **`WorkLocation`** (existing) | Reuse existing; Greenhouse offices → DPF work locations. |
| **Source** | **`RecruitingSource`** | `name`, `type` (referral/job-board/agency/internal). Required for OFCCP applicant-flow. |
| **Job Post** | **`JobPosting`** | schema.org/JobPosting-aligned: `title`, `description`, `locationText`, `employmentType`, `datePosted`, `validThrough`, `remote`, comp range, `live`, `locale` (EN/ES), `channels[]`. |
| **EEOC / Demographic data** | **`DemographicResponse`** (jurisdiction-gated) | `applicationId`, `jurisdiction`, race/ethnicity/gender/veteran/disability, `consentGiven`, `collectedAt`. **US:** solicited per OFCCP. **Mexico:** restricted/optional/consent-bound (§6). |
| **Rejection/disposition** | **`DispositionReason`** | Enum/table for applicant-flow disposition (OFCCP recordkeeping: hired/withdrew/rejected + reason). |
| **Custom Fields** | `customFields` JSON on each model | Greenhouse custom fields (incl. currency/compensation) → typed JSON columns. |
| **Activity Feed** | (defer) `RecruitingActivity` | Not required for bridge/absorb; model in replace phase if native parity needs the audit trail. |
| **Hire event** (`hire_candidate`) | `Application.status → hired` **⇒ conversion to `EmployeeProfile`** | The absorption handoff. Offer Packet carries `starts_at` → `EmployeeProfile.startDate`. One worker object, no re-key (§4.1, Seam A/B). |

### 3.2 Status mapping (Application)

| Greenhouse `application.status` | DPF `Application.status` |
|---|---|
| `active` | `active` |
| `rejected` | `rejected` (+ `DispositionReason`) |
| `hired` | `hired` (triggers `EmployeeProfile` conversion) |
| `converted` (prospect→candidate) | `converted` |

### 3.3 The conversion contract (candidate → worker)

BI-F3AEBF68 §11 flags an open question: model a candidate as a distinct entity that converts, or as a worker in a pre-hire state? **This design chooses the distinct-entity-that-converts model**, because (a) it matches Greenhouse's own object graph, (b) most candidates never become workers (a worker-in-pre-hire-state pollutes `EmployeeProfile` with rejected candidates), and (c) it keeps `EmployeeProfile` semantics ("a person the company employs") clean. On hire, `Candidate` + accepted `Offer` produce an `EmployeeProfile`, and the identity link is recorded via `PrincipalAlias` (candidate identity → worker identity) so there is one durable person thread and no re-keying. This should still be ratified through the kernel as a schema-shape decision when BI-F3AEBF68 is built (it is a `dpf-decision-via-kernel` candidate).

---

## 4. Phased absorption plan

### Phase 0 — Foundations (shared prerequisites)
- Catalog entry for Greenhouse (§ child BI 2): one-line portfolio manifest add (`slug:"greenhouse"`, `portfolioSlug:"for_employees"`, `credentialProvider:"greenhouse"`) + a `NATIVE_INTEGRATIONS` descriptor (extend the `NativeIntegrationId` closed union) + connect page/panel/route mirroring ADP.
- `IntegrationCredential` for `greenhouse` (Harvest API key, encrypted). Harvest uses HTTP Basic (`base64(token:)`); store the token in `fieldsEnc`.

### Phase 1 — BRIDGE (integrate: read pipeline + land hires)
**Goal:** connect a (sandbox) Greenhouse, import requisitions + candidates + a hire; the hire lands as an onboarding `EmployeeProfile` idempotently. This is BI-E5561DC9's acceptance criterion.

- **Harvest client** (`apps/web/lib/integrate/greenhouse/`): Basic auth, `Link`-header pagination, rate-limit handling (~50 req/10s, honor `Retry-After`), `On-Behalf-Of` for any writes, redaction via the shared `redact` before any LLM context. **Attachment URLs are S3-signed with ~7-day expiry — download inline, never persist the URL.**
- **Import into staging:** jobs/openings, candidates, applications, stages, scorecards, offers → `IntegrationImportBatch` + `IntegrationImportStagedRecord` (`sourceProvider="greenhouse"`, `entityFamily`, `externalId`, `proposedLocalEntityType`, `reviewStatus="candidate"`). Read-only staging first; operator reviews before landing.
- **Inbound webhook** (`app/api/integrations/greenhouse/inbound/route.ts`): copy the Postmark pattern — read raw body once, `verifyInboundSignature` (Greenhouse signs HMAC-SHA256 over the JSON body with the webhook secret; **Unicode-escaped body** is the usual verification gotcha), parse, then `executeCallbackTransaction({ deliveryKey: <Greenhouse event id>, performDomainWrite })`. Subscribe at minimum to `hire_candidate` (+ `candidate_stage_change`, `offer_created/updated` for the absorb phase). Ties to BI-ECO-004.
- **Crosswalk (Seam A):** register `MasterDataSourceRef` for each imported candidate/application (soft-ref, no schema change). Hire → worker link via `PrincipalAlias`.
- **Hire → worker landing (Seam B):** extend the onboarding landing with an external-source key so a re-delivered `hire_candidate` is idempotent against `(greenhouse, candidate_id, application_id)`; map the Offer Packet fields (name, email, start date from `starts_at`, department, office/location, title) into `ProposedEmployee` → `EmployeeProfile` via the existing `importRoster` path.

### Phase 2 — ABSORB (make it native-visible)
**Goal:** the operator sees one funnel, not two systems.

- **Build the native recruiting models** (§3) — this is BI-F3AEBF68's scope, informed by this mapping. Requisition → posting → candidate → application → stage → interview → scorecard → offer.
- **Surface Greenhouse-sourced pipeline natively:** render staged/crosswalked Greenhouse candidates and applications as native `Candidate`/`Application` rows tagged `source=greenhouse`, on the DPF recruiting/People surface. Greenhouse remains system-of-record; DPF is the unified read.
- **Dual-read reconciliation** via the crosswalk so a candidate mirrored from Greenhouse is never double-counted against a natively-created one.

### Phase 3 — REPLACE (native parity + cutover)
**Goal:** Infinitum can retire Greenhouse.

- **Native parity:** requisition open → approve → post → apply → advance → offer → hire fully native; native `JobPosting` syndication via schema.org/JobPosting (Google for Jobs / LinkedIn / Indeed) and an optional native job-board.
- **Historical migration:** full Harvest extraction of Jobs + Openings + Candidates + Applications + Offers + Scorecards + attachments (incremental via `updated_after`; attachments downloaded inline within the 7-day window). Land into the native models via the crosswalk.
- **Cutover / dual-run** (§4.2).
- **Retire** under BI-ECO-002 native graduation gates.

### 4.1 Hire handoff detail

The `hire_candidate` webhook / Offer Packet is the single programmatic trigger. Fields that cross the boundary: name, work/personal email, `starts_at` → `startDate`, department, office/location → `WorkLocation`, job title, employee status, offer/comp data. Landing is idempotent on `(sourceSystem, candidate_id, application_id)` (Seam B), and the candidate↔worker identity is recorded via `PrincipalAlias` (Seam A) so there is one person thread across recruiting and HCM.

### 4.2 Cutover / dual-run approach

**Recommended: drain-and-new-native, not big-bang.**

- **New requisitions open natively** from the cutover date.
- **In-flight Greenhouse requisitions continue in Greenhouse** and mirror read-only into DPF (Phase-2 absorb) until they close — candidates mid-pipeline are never disrupted.
- **Reconciliation** through `MasterDataSourceRef` prevents double-counting during the overlap.
- **Rollback:** Greenhouse stays connected read-only during the dual-run window; cutover is **per-requisition and reversible** until the operator explicitly disconnects Greenhouse (a destructive action requiring explicit go).
- **Exit gate:** all in-flight Greenhouse reqs closed + historical extraction reconciled + native parity acceptance passed (BI-ECO-002) → disconnect Greenhouse.

---

## 5. Decision: build-direct vs unified-API (kernel-scored)

**Method:** `dpf-brainstorming` → `dpf-decision-via-kernel` (WWMD). `principle_decide`, `callingPopulation: in_platform_coworker`, structured feature vectors on 9 dimensions. Full ledger is the audit trail in the MCP response; summary below.

**Options:**
- **A — direct-native-only:** replicate the ADP paved road per vendor (Greenhouse → Fountain → Workday). High fidelity, fully in-platform, no middleware.
- **B — unified-api-only (Kombo/Merge):** one integration wraps 50–100+ ATS incl. Greenhouse, at the cost of routing candidate PII through a third-party middleware and flattening scorecards/custom fields to passthrough.
- **C — hybrid:** native Greenhouse + Fountain now; unified adapter as a deferred breadth lane for the enterprise/long-tail.

**Result:** **A (direct-native) — composite 6.56, margin 0.74, confidence high, no commandment conflict.** (C 5.82, B 4.28.)

- **Top positive contributors:** Research and Use Standards (+0.70), Never Assume–Verify (+0.69), Single Source of Truth (+0.60), Architecture Over Shortcuts (+0.58), Ground New Work in Existing Platform (+0.51), and the core principle **"One data model, not two integrated"** (+0.20, strongest on the native option).
- **Why it flipped the market-research default:** the landscape research favored hybrid on speed/breadth. Under the founder kernel, **operational independence, data privacy (candidate PII staying in-platform), and schema grounding outweigh speed-to-value**, and the unified adapter's `vendor_lock_in` (0.9) + low `operational_independence` (0.15) + low `data_privacy` (0.25) sink both B and the hybrid's tail-lane. The kernel also aligns with Mark's fully-local-by-choice posture.

**Committed decision:** **direct-native connectors.** Greenhouse native first (the driving customer's system, deserves full fidelity — scorecards, structured-hiring stages, HMAC webhooks, Offer Packet). Fountain native second (§6/§7). The **unified-API adapter is deferred and conditional** — captured as its own BI, gated on a future `tool-evaluation` (privacy/lock-in review of PII-through-middleware) **and** a fresh kernel re-decision before any adoption. It is *not* part of the committed architecture.

---

## 6. ATS market landscape & standards (context for §7)

**API/webhook maturity of the relevant set:** Greenhouse, Lever, SmartRecruiters, Ashby, Workable, Fountain are **event-driven (real webhooks)**. **Workday and iCIMS are polling-only** (no native outbound webhooks) — the two that most need a wrapping layer.

**Unified-API coverage:** Merge ✅ (ATS category, ~50 ATS, Merge Link, normalizes scorecards), Kombo ✅ (100+ ATS, rich write-back, flat per-connection pricing), Apideck ✅ (11+ ATS), **Finch ❌ (no ATS category — HRIS/payroll only).** All three ATS providers cover Greenhouse; Finch does not.

**Standards to align the canonical model to:**
- **HR Open Standards (HR-JSON Recruiting/Candidate)** — the canonical Candidate/Application/Requisition backbone (a Candidate models education/experience/contact **plus** candidacy for positions).
- **schema.org/JobPosting** — the external representation + syndication format for `JobPosting` (Google for Jobs, LinkedIn, Indeed).
- **US EEO/OFCCP** — federal contractors must solicit race/ethnicity/gender and tie source → stage → disposition with applicant-flow status. Drives `DemographicResponse`, `DispositionReason`, `RecruitingSource`.
- **Mexico** — **no EEO-1/applicant-flow analog**; the framework is anti-discrimination (LFT) + NOM-035 (post-hire psychosocial) + recent prohibitions on misuse of personal data in hiring. **⇒ demographic capture must be jurisdiction-gated: required/solicited for US OFCCP, restricted/optional/consent-bound for Mexico. Do not apply one global schema blindly.** Ties to EP-MULTICOUNTRY-HR.

---

## 7. Which ATSs to support, and in what order

Decision rule (from §5 + landscape): **native where fidelity/differentiation lives; unified only where breadth/long-tail is the goal — and only after a separate privacy/lock-in gate.**

1. **Greenhouse — native, now.** The driving customer's system; flagship fidelity. (This document.)
2. **Fountain — native, next.** The single most defensible second build for Infinitum: purpose-built **high-volume hourly** for the Mexico plant workforce, with **SMS/WhatsApp apply**, native I-9/E-Verify, real webhooks, documented REST API. Its high-volume semantics (slots, labels, stage-triggered webhooks) don't normalize cleanly through a unified model — native captures value a generic adapter loses. Sequenced after Greenhouse; filed as a deferred child BI.
3. **Unified-API adapter (Kombo preferred, Merge alternative) — deferred & conditional.** For the enterprise/long-tail (Lever, SmartRecruiters, Ashby, Workable, iCIMS, Workday, SAP SF) where breadth-per-effort wins and the data need is the common model. **Gated on `tool-evaluation` (candidate-PII-through-middleware) + kernel re-decision.** Filed as a separate BI; not committed.
4. **Workday Recruiting — native only on enterprise demand.** Polling-only, high per-tenant OAuth config cost; let the unified lane carry it first if adopted.
5. **Paradox / Olivia — a bilingual conversational *layer*, not an ATS.** Strongest EN/ES high-volume front-end; rides on top of the ATS of record. Out of scope for the connector initiative; note for a future recruiting-experience epic.

---

## 8. Backlog decomposition

Anchor **BI-E5561DC9** decomposes into the following. Adapter-side children link to **EP-ECOSYSTEM-ABSORPTION-ARCH**; the native-models work is **BI-F3AEBF68** under **EP-PEOPLE-HCM-CORE** (referenced, **not duplicated**). Generic primitives (BI-ECO-002/003/004) are **referenced**, not re-filed.

| # | Child BI (title) | Phase | Epic | Size | Refs |
|---|---|---|---|---|---|
| 1 | Greenhouse bridge adapter — Harvest client + import staging | Bridge | EP-ECOSYSTEM-ABSORPTION-ARCH | L | ADP paved road; `IntegrationImportBatch` |
| 2 | Greenhouse catalog entry — manifest `int-greenhouse` + native descriptor + connect panel/route | Bridge | EP-ECOSYSTEM-ABSORPTION-ARCH | S | `supported-integrations-manifest.ts`, `native-integration-catalog.ts` |
| 3 | Greenhouse inbound webhook + recruiting crosswalk (Seam A) | Bridge | EP-ECOSYSTEM-ABSORPTION-ARCH | M | Postmark kernel; BI-ECO-003, BI-ECO-004 |
| 4 | Hire → worker handoff — idempotent `EmployeeProfile` landing (Seam B) | Bridge | EP-ECOSYSTEM-ABSORPTION-ARCH | M | `importRoster`, EP-ONBOARDING-INTAKE / BI-9B1E403D |
| 5 | Absorb — surface Greenhouse pipeline on the native recruiting/People surface | Absorb | EP-ECOSYSTEM-ABSORPTION-ARCH | M | depends on native models (BI-F3AEBF68) + #3 |
| 6 | Replace — Harvest extraction + dual-run + per-requisition cutover + Greenhouse retirement | Replace | EP-ECOSYSTEM-ABSORPTION-ARCH | L | BI-ECO-002 native graduation gates |
| 7 | Unified-API ATS adapter (Kombo/Merge) — **deferred/conditional** breadth lane | (later) | EP-ECOSYSTEM-ABSORPTION-ARCH | L | gated on `tool-evaluation` + kernel re-decision |
| 8 | Fountain native connector — Mexico high-volume hourly | (after GH) | EP-ECOSYSTEM-ABSORPTION-ARCH | L | §7; jurisdiction-gated demographics (EP-MULTICOUNTRY-HR) |
| — | Native recruiting models (requisition→hire) | Absorb | EP-PEOPLE-HCM-CORE | XL | **BI-F3AEBF68 (existing)** — this doc defines its models |

**Open questions for build time:**
- Candidate→worker identity: `PrincipalAlias` vs a new `worker` MDM domain + `employeeProfileId` FK on `MasterDataSourceRef` (§3.3, Seam A) — kernel-decide when BI-F3AEBF68 is built.
- Harvest v3 migration / Aug-2026 v1/v2 deprecation is secondary-sourced — verify against official docs before committing extraction code to a version.
- Native recruiting home: BI-F3AEBF68 sits in EP-PEOPLE-HCM-CORE, but EP-TALENT-SKILLS-PERFORMANCE also scopes "recruiting" — confirm the epic home before build.

---

## 9. Coordination with the Workday / HCM parity build

**Principle:** absorbing adjacent functionality is the platform's compounding benefit (BI-COP-007). The Greenhouse adapter must therefore build its ingest seams as **shared HCM primitives** that the next connector (Fountain, ADP, Workday) reuses — never Greenhouse-specific one-offs. This is the recruiting-domain instance of BI-ECO-005 (shared company primitive refactor). The recruiting/ATS work is a live **Workday-parity capability (13)** under EP-PEOPLE-HCM-CORE, and the parity scorecard **BI-COP-001 was reopened 2026-08-05** for full-parity tracking — so this initiative must register as evidence there, not run parallel to it.

**Touchpoints — build against the shared owner, do not fork:**

| Greenhouse seam / model | Shared HCM owner (epic) | Coordination rule |
|---|---|---|
| Seam A — external worker crosswalk | BI-HCM-001 worker model (done) + BI-ECO-003 crosswalk registry | Build **one** "external worker-source ref" (PrincipalAlias-based) consumed by every HRIS/ATS connector; no `greenhouse`-specific table. |
| Seam B — idempotent hire landing | BI-HCM-003 onboarding/offboarding lifecycle | The hire lands via the **shared onboarding-intake path** and triggers the HCM-003 workflow — not a parallel onboarding. |
| `JobRequisition` → `RequisitionOpening` | BI-41901810 position/headcount/vacancy | A recruiting **opening = a Position vacancy**. The requisition consumes Position + headcount from HCM position management; no parallel vacancy concept. |
| `Candidate` → `EmployeeProfile` conversion | BI-36FEECC4 effective-dated worker spine | The conversion writes an **effective-dated hire event** into the dated spine; effective date = offer `starts_at`. |
| `DemographicResponse` (jurisdiction-gated) | BI-390B2EBB statutory identity + EP-MULTICOUNTRY-HR | Mexico hires: RFC/CURP/NSS come from BI-390B2EBB's fields; demographic capture gated per jurisdiction (US OFCCP requires vs MX restricts). |
| `Offer` compensation | BI-6770ADCD per-entity currency | Mexico offers denominated in **MXN** via per-entity currency, not the single base currency. |
| `JobPosting` locale | BI-7E54AA3A i18n / es-MX | Mexico postings render **es-MX** via the i18n framework (also gates the Fountain SMS/WhatsApp Spanish apply flow). |
| Native recruiting models (§3) | BI-F3AEBF68 (priority 7) | Design §3 defines them; sequenced **after** the worker spine / onboarding / position work. |

**Sequencing consequence:** the **BRIDGE** phase (Harvest client + staging + land into the *existing* `EmployeeProfile`) can start **now** — it does not depend on the native recruiting models. The **ABSORB** phase does depend on BI-F3AEBF68. The two shared ingest seams (A/B) should be **co-designed with the HCM owners before coding** so they land as reusable primitives, not retrofitted later. The Fountain connector (§7) then reuses seams A/B verbatim, proving the absorption pattern compounds.

## 10. Sources

Greenhouse: developers.greenhouse.io (Harvest, Job Board, Webhooks), support.greenhouse.io (candidate-hired webhook documents, bulk import, HRIS integrations), github.com/grnhse/greenhouse-api-docs. Landscape: merge.dev, kombo.dev, tryfinch.com, apideck.com, fountain.com, icims.com, paradox docs, hropenstandards.org, developers.google.com/search (JobPosting), OFCCP/EEOC guidance, leglobal.law (Mexico anti-discrimination / personal-data). Substrate: verified in-repo 2026-08-05 (paths in §2).
