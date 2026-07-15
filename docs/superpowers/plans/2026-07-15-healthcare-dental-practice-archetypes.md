# Healthcare & Dental Practice Archetypes - Implementation Plan

> **Backlog anchor:** `BI-HEALTHCARE-000` under `EP-HEALTHCARE-PRACTICE`
>
> **Design:** `docs/superpowers/specs/2026-07-15-healthcare-dental-practice-archetypes-design.md`
>
> **Decision:** `DI-444C1424A3F9` selected the care-practice capability overlay with high confidence.

## Goal

Deliver a standards-aligned, jurisdiction-aware operating platform for small
ambulatory medical and dental practices by deepening DPF's existing
`healthcare-wellness` category. The implementation reuses canonical identity,
documents, finance, licensing, booking, workspace, portal, and AI governance;
it adds care-specific data only where the verified substrate is insufficient.

This is a program plan. Each child backlog item still requires a Build Studio
implementation plan or Work Capsule at execution time. No phase may interpret
this document as pre-authorization to make a regulated product claim.

## Program dependencies

- Coordinate identity authority with `BI-75B31594`; never introduce a parallel
  person/customer master.
- Use `EP-4A12A7CB` MDM identity and match/merge substrate where available.
- Use `EP-F7E35344` for reusable coworker capability inputs and tool grants.
- Use the managed-document, finance, licensing, workspace profile, and
  storefront-archetype registries already present.
- Before every migration, run the data-architecture impact workflow and the
  fleet-safe migration gate. Tightening constraints require same-migration
  remediation, expand/contract, `NOT VALID`, or the data-safe attestation.
- Runtime-bound verification uses `local-integration-ci` or the canonical local
  install through the governed path, never an improvised worktree runtime.

## Dependency flow

```text
architecture + threat model + jurisdiction contract
              |
              v
identity/proxy + privacy/policy + archetype activation + adapters
              |
              v
appointment/intake/reception/patient portal
              |
              v
encounter/clinical facts/orders-results/referrals
              |                         |
              v                         v
dental depth                         funding/revenue
              \                         /
               v                       v
          credentialing + governed AI coworkers
                       |
                       v
        quality, migration, resilience, localization
```

## Phase 0 - Establish the safe architecture

### BI-HEALTHCARE-001 - Canonical care data model and authority map

**Outcome:** an approved Prisma/EA impact design for patient role, proxy,
appointment, encounter, clinical facts, coverage/funding, claims, practitioner
extensions, provenance, and audit.

**Work:**

1. Inspect `Principal`, `CustomerAccount`, `EmployeeProfile`, Storefront booking,
   managed documents, finance, licenses, audit, and policy models.
2. Resolve the `StorefrontBooking` versus linked `CareAppointment` decision.
3. Resolve the minimum typed clinical-record boundary and original FHIR payload
   retention.
4. Define identifiers, tenancy, lifecycle enums, append/amend rules, source keys,
   idempotency, retention, and deletion restrictions.
5. Produce Prisma-to-EA target mapping and parity/conformance expectations.

**Gate:** Enterprise Architect + Data Architect review; no migration before it.

### BI-HEALTHCARE-002 - Medical and dental archetype activation profiles

**Likely files:**

- `packages/storefront-templates/src/archetypes/healthcare-wellness.ts`
- `packages/storefront-templates/src/types.ts`
- `packages/storefront-templates/src/capability-registry.ts`
- `packages/storefront-templates/src/operational-value-stream.ts`
- `apps/web/lib/workspace-home/profiles.ts`
- `apps/web/lib/storefront/archetype-vocabulary.ts`
- `apps/web/lib/onboarding/archetype-business-context.ts`

**Outcome:** add `medical-practice`, deepen `dental-practice`, and correctly set
`patient-and-payer`, `encounter-based`, `episode-of-care`, appointment/care
context, conservative trust posture, and patient/clinical isolation.

**Gate:** registry unit tests, onboarding/profile tests, production build, and
UX verification of both leaves.

### BI-HEALTHCARE-003 - Healthcare privacy, security, and safety threat model

**Outcome:** executable control matrix for HIPAA, GDPR/EHDS, minor/proxy access,
sensitive records, minimum necessary, break-glass, audit/disclosure, retention,
availability, breach/downtime, model routing, BAA/processor, and jurisdictional
configuration.

**Gate:** security/privacy review and negative authorization test catalogue.

### BI-HEALTHCARE-004 - Patient identity, household, proxy, and consent authority

**Outcome:** Principal-based patient role and typed guardian/caregiver/responsible
party authority with evidence, scope, expiry, revocation, and communication
preferences.

**Gate:** wrong-person, duplicate, minor, expired/revoked proxy, cross-tenant,
and staff override tests.

### BI-HEALTHCARE-005 - Care interoperability and terminology foundation

**Outcome:** versioned adapter contracts for FHIR R4/SMART, DICOMweb,
lab/order/result, e-prescribing, payer/clearinghouse, public services, and
licensed terminology packages.

**Gate:** conformance fixtures, idempotent replay, provenance, failure
reconciliation, and license review. Do not bundle proprietary CDT/SNOMED content.

### BI-HEALTHCARE-006 - Jurisdiction and funding profile registry

**Outcome:** a versioned registry that composes privacy, patient rights,
professional qualification, public entitlement, private coverage, referral,
tariff/claim, retention, residency, and connector requirements.

**Gate:** US commercial, US public program, EU public/private mixed, and self-pay
fixtures prove there is no `hasInsurance` shortcut or tenant fork.

## Phase 1 - Patient access and front-desk minimum lovable product

### BI-HEALTHCARE-010 - Multi-resource care appointment engine

Add visit types, patient, practitioners, location, room/equipment, duration,
preparation, buffers, status history, holds, recurrence/recall, encounter link,
and collision/overbooking policy. Preserve the existing booking channel and
checkout paths where valid.

### BI-HEALTHCARE-011 - Confirmation, reminder, waitlist, and no-show recovery

Add preference-aware notifications, two-way confirmation, safe cancellation,
waitlist offers with expiring holds, no-show recovery, escalation, and complete
delivery/action audit.

### BI-HEALTHCARE-012 - Digital intake, forms, consent, and coverage capture

Add mobile save/resume forms, signatures, questionnaires, document/card capture,
versioned consent, staff-assisted/paper fallback, completeness rules, and
exception work queues. Sensitive information is purpose-limited and never used
as generic CRM enrichment.

### BI-HEALTHCARE-013 - Patient and proxy portal

Compose an external `/portal` care experience for appointments, tasks/forms,
secure messages, released records/results, medications/refills, referrals,
estimates/bills/payments, record export, access history, and proxy switching.
The first viewport shows the next action, not module navigation.

### BI-HEALTHCARE-014 - Reception, arrival, rooming, and checkout workspace

Create an archetype/role-resolved workspace profile over the existing home
shell: chronological arrivals, registration/coverage/balance exceptions,
check-in, room/resource state, handoff, checkout, follow-up, and downtime mode.

### BI-HEALTHCARE-015 - Secure patient and care-team communication

Add patient threads, staff pools, verified-practitioner communication,
attachments, urgency disclaimers, response expectations, routing/escalation,
consent/preferences, and record linkage without turning all messages into
clinical facts.

**Phase 1 release gate:**

- patient/proxy -> book -> intake -> confirm -> arrive -> room -> checkout works;
- receptionist can recover every self-service failure;
- concurrent booking/resource and negative access suites pass;
- portal/reception accessibility and mobile verification pass;
- recovery evidence proves no lost appointment or intake state.

## Phase 2 - Clinical encounter and results foundation

### BI-HEALTHCARE-016 - Episode, encounter, note, signature, and amendment

Add care episode and encounter lifecycles, participants, reason, structured and
narrative note sections, provenance, clinician signature, cosignature, lock,
late entry, correction/amendment, and patient release projection.

### BI-HEALTHCARE-017 - Core clinical facts and patient safety banner

Add typed problems/conditions, allergies/intolerances, medications, observations,
procedures, care plans, alerts, source/provenance, status, and reconciliation.
The in-room view is designed around patient safety and the current encounter.

### BI-HEALTHCARE-018 - Orders, laboratory/imaging results, and release workflow

Add service requests, specimens/acquisition, observations/diagnostic reports,
reconciliation, abnormal/urgent routing, clinician review, configurable release,
patient notification/acknowledgement, follow-up tasks, and DICOM links.

### BI-HEALTHCARE-019 - Medication, refill, and e-prescribing coordination

Add medication list/reconciliation, refill request, controlled authorization
boundaries, formulary/coverage context where available, prescription status,
pharmacy communication, and a certified network adapter strategy.

### BI-HEALTHCARE-020 - Referral, consultation, and telehealth coordination

Add referral orders, receiving organization/practitioner, evidence packet,
authorization dependency, appointment/result closure, consultation response,
telehealth consent/session link, failed connection recovery, and closed-loop
status.

**Phase 2 release gate:** formal intended-use and certification scope decision;
signed-record immutability/amendment tests; wrong-patient and result-release
negative tests; clinical downtime and restore drill; clinician UX verification.

## Phase 3 - Dental depth

### BI-HEALTHCARE-021 - Odontogram and periodontal chart

Deliver dentition, tooth/surface, condition/finding, mobility, probing/recession,
bleeding and other configured measures, history, comparison, keyboard/touch
workflow, clinician attribution, and accessible text representation.

### BI-HEALTHCARE-022 - Dental imaging and laboratory cases

Deliver DICOM/DICOMweb study/order linkage, image metadata and viewing boundary,
acquisition status, interpretation/signoff, radiation/audit context as required,
and dental laboratory case/specification/shipping/receipt/remake tracking.

### BI-HEALTHCARE-023 - Dental treatment plan, consent, estimate, and case acceptance

Link findings/diagnoses to alternatives, phased treatment, tooth/surface,
licensed CDT package versions, estimates, benefits/preauthorization, consent,
case acceptance/decline, appointments, completed procedures, claims, and recall.
The treating dentist remains the authority for diagnosis, service, and code.

### BI-HEALTHCARE-024 - Recall, hygiene, and continuing-care workflows

Add recall interval/policy, hygienist availability, overdue segmentation,
patient outreach/preferences, unscheduled treatment follow-up, periodontal
maintenance rules, failed-contact escalation, and case closure.

**Phase 3 release gate:** full dental chart -> treatment plan -> authorization/
estimate -> consent -> appointment -> completed procedure -> claim trace; DICOM
conformance evidence; terminology license and annual-version update runbook.

## Phase 4 - Funding, insurance, and revenue operations

### BI-HEALTHCARE-030 - Coverage, public entitlement, and responsible-party model

Represent subscriber/dependent coverage, public entitlement, plan/program,
coordination/order, effective periods, benefit source, responsible party,
verification provenance, and mixed funding without conflating eligibility with
guaranteed payment.

### BI-HEALTHCARE-031 - US eligibility, benefits, referral, and prior authorization

Add X12/clearinghouse-led 270/271 eligibility and benefit reconciliation,
referral rules, authorization requests/evidence/status, service/date/unit limits,
expiry, peer-to-peer/appeal work, and appointment/estimate readiness.

### BI-HEALTHCARE-032 - Claims, remittance, denial, and reconciliation

Add charge/coding readiness, professional and dental claim assembly, scrubbing,
attestation, batch/submission/acknowledgement, 835/remittance posting,
adjustments, denials, corrected/void claims, appeals, unapplied responses, and
finance-led reconciliation. No second ledger.

### BI-HEALTHCARE-033 - Estimates, patient responsibility, payments, and plans

Extend existing finance/checkout with good-faith or local estimates,
coverage/public allocation, deposits, copays/charges, statements, online and
in-room payment, payment plans/financing boundary, refunds, disputes, and clear
variance explanation.

### BI-HEALTHCARE-034 - European public/private funding adapters

Implement the first selected country profile: entitlement/identity, referral,
practice/provider contract, tariff/episode reporting, patient exemption/charge,
public settlement, private guarantee/claim or reimbursement, and mixed funding.
Do not label a generic form as a national-service integration.

**Phase 4 release gate:** trading-partner certification where required; exact
submission/acknowledgement/remittance reconciliation; no silent orphan events;
patient estimate and final responsibility trace; country-specific counsel and
contract review.

## Phase 5 - Practitioner participation and AI coworkers

### BI-HEALTHCARE-040 - Practitioner qualification, license, and privilege lifecycle

Extend existing license/document substrate with specialty/taxonomy, restrictions,
sanctions/verification, organization/location privilege, effective dates,
continuing requirements, EU recognition evidence, expiry/revalidation, and
action gates.

### BI-HEALTHCARE-041 - Government enrollment, payer credentialing, and networks

Add NPI/national identifier context, PECOS/Medicaid or selected public-program
enrollment, CAQH/payer application evidence, credentialing status, network
contract, fee schedule, product/panel/location state, recredentialing, roster,
and directory reconciliation. Never display "in network" from licensure alone.

### BI-HEALTHCARE-050 - Patient Access and Reception AI coworkers

Deliver governed scheduling, confirmation, intake completeness, waitlist,
arrival exception, room/resource, checkout, and FAQ assistance using explicit
patient/staff confirmations and safety escalation.

### BI-HEALTHCARE-051 - Clinical Documentation AI coworker

Deliver transcript/import boundary, source-linked draft note, structured
extraction, after-visit draft, and code suggestion. The clinician must review,
edit, sign, and own every clinical artifact. Complete intended-use/FDA and local
regulatory analysis before launch.

### BI-HEALTHCARE-052 - Revenue, referral, and credentialing AI coworkers

Deliver evidence-packet assembly, completeness checks, status follow-up,
denial/exception classification, and communication drafts. Human staff approve
submissions, attestations, adjustments, write-offs, appeals, and contracts.

### BI-HEALTHCARE-053 - Healthcare AI policy, evaluation, and monitoring harness

Add PHI-capable provider/model registry, BAA/processor/residency policy,
purpose/tool grants, draft/sign/release/submit guards, test corpora, wrong-patient
and clinical-negation cases, tooth/surface cases, coverage/proxy cases, override
and incident monitoring, rollback, and audit reports.

**Phase 5 release gate:** role/purpose/PHI tool tests; no self-sign/release/submit;
clinician/staff acceptance and override review; evaluation thresholds approved;
monitoring and incident response operational.

## Phase 6 - Long tail, ecosystem, and operating maturity

### BI-HEALTHCARE-060 - Recall, population, quality, and practice analytics

Build operational and clinical cohorts from authoritative facts; support recall,
care gaps, referral/result closure, access, cycle time, revenue, credential
expiry, and selected quality measures with versioned definitions and drill-down.

### BI-HEALTHCARE-061 - Migration, import/export, and connector ecosystem

Add patient/chart/document/appointment/balance imports, FHIR bulk/individual
export, record portability, connector SDK/conformance suite, reconciliation,
dual-run, cutover, rollback, and vendor-specific mapping without contaminating
the canonical model.

### BI-HEALTHCARE-062 - Resilience, downtime, backup, and disaster recovery

Add clinical downtime views/forms, queued work recovery, immutable backup,
restore verification, RPO/RTO evidence, dependency degradation, notification
fallback, incident command, and reconciliation after recovery.

### BI-HEALTHCARE-063 - Accessibility, language, health literacy, and assisted access

Verify WCAG, keyboard/touch, screen reader, cognitive load, plain language,
translation, interpreter need, communication accommodations, patient-assisted
and paper paths, imaging/odontogram text alternatives, and equitable access.

### BI-HEALTHCARE-064 - Certification, conformance, and jurisdiction launch factory

Create a repeatable release package for intended use, regulatory scope,
certification, code-set licenses, privacy/security assessment, trading-partner
tests, country/program profiles, professional participation, clinical safety,
documentation, training, monitoring, and deprecation.

## Verification matrix

| Concern | Minimum evidence |
| --- | --- |
| Source behavior | Targeted web/db/storefront-template Vitest suites and typecheck. |
| Production assembly | `pnpm --filter web build` in the governed shared sandbox/canonical path. |
| Data evolution | Fleet-safe migration guard, real-state/shadow apply when available, rollback/recovery evidence, EA mirror/parity check. |
| Patient UX | Mobile/desktop patient and proxy happy paths plus denial/expired-proxy/empty/error states. |
| Reception UX | Arrival queue, identity/coverage exception, rooming, handoff, checkout, interruption, and downtime. |
| Clinical UX | Wrong-patient guard, signed/amended record, result review/release, dental chart, accessibility. |
| Security/privacy | Tenant/subject/purpose/role negative matrix, break-glass, audit/disclosure, export/restriction, PHI egress. |
| Interoperability | Versioned conformance fixtures, idempotent replay, reconciliation, partial failure, duplicate/out-of-order event. |
| Funding | Eligibility is not payment, claim/remittance trace, mixed public/private allocation, estimate variance. |
| Practitioner | License versus enrollment versus network states and expiry/action-gate behavior. |
| AI | Draft-only transition guards, evaluation sets, attribution, human review, override/incident telemetry. |

## Definition of done for each child item

1. Existing substrate and live state reverified at execution time.
2. Open architectural choices kernel-scored and recorded.
3. Data authority, privacy, jurisdiction, and regulatory intended use stated.
4. Tests fail first for behavioral/regression work and then pass.
5. Targeted tests and typecheck pass; production build passes for the delivery
   unit; UI/workflow changes are functionally verified.
6. Runtime-bound evidence comes from the shared convergence sandbox or governed
   canonical install.
7. Documentation, help, configuration, migration/import, monitoring, and
   rollback/downtime needs are handled in the same delivery concern.
8. EA/parity and durable learning are updated where the source contract changed.
9. DCO-signed commits, pushed branch, ready PR, zero unresolved review threads,
   and `pnpm pr:health` green before merge-ready is claimed.

## Sequencing recommendation

Fund Phase 0 and Phase 1 as the first product increment. They create immediate
value without claiming to be a complete EHR: practices can safely manage patient
access, resources, intake, arrival, and checkout. Phase 2 is the regulatory and
clinical authority inflection point and must not begin migrations until its
intended-use and data-architecture gates are approved. Dental depth and funding
can then proceed in parallel where independent, while credentialing and the AI
pack reuse the stable authority boundaries established below them.
