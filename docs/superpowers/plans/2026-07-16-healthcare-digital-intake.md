# Healthcare Digital Intake Delivery Plan

**Backlog item:** BI-HEALTHCARE-012  
**Epic:** EP-HEALTHCARE-PRACTICE  
**Status:** In progress  
**Standards:** HL7 FHIR R4 QuestionnaireResponse, Consent, and Coverage; HIPAA minimum-necessary guidance

## Goal

Deliver one tenant-safe intake workflow used by patient mobile/web, proxy,
kiosk, receptionist-assisted, and paper-transcription channels. Reuse
`DynamicForm` as the form-definition authority and the existing mobile
`FormRenderer`; add the healthcare assignment, response, attestation, evidence,
and exception records that those generic surfaces do not own.

## Authority boundaries

- `Organization`, `Principal`, `PatientProfile`, `PatientAuthority`, and
  `PatientConsentDirective` remain authoritative for tenant, identity, proxy,
  and access/consent decisions.
- `DynamicForm` remains the form-definition/rendering authority. A healthcare
  response pins the exact `DynamicForm.id` and version it answered.
- `CareAppointment` owns the scheduled visit. Intake may link to it but never
  copies or advances its lifecycle.
- Coverage captured here is staged evidence for review. BI-HEALTHCARE-030 will
  establish canonical coverage/entitlement and responsible-party records.
- A consent signature is evidence for a versioned
  `PatientConsentDirective`; it does not replace that directive.
- Raw resume tokens and signatures are never stored. Persist a token digest and
  immutable signature/document evidence references and digests.

## Phase 1 — intake authority and lifecycle

1. Add typed contracts for:
   - packet and questionnaire-response lifecycle;
   - patient, proxy, staff-assisted, kiosk, and paper-transcribed source modes;
   - completeness/exception classification;
   - minimum-necessary validation;
   - optimistic packet transitions.
2. Add tenant-owned relational models:
   - `CareIntakePacket`;
   - `CareIntakeResponse`;
   - `CareIntakeAccessGrant`;
   - `CareConsentAttestation`;
   - `CareCoverageEvidence`;
   - `CareIntakeException`;
   - append-only `CareIntakeStatusEvent`.
3. Enforce composite tenant/subject foreign keys and patient-context RLS on
   every PHI-bearing intake table.
4. Add a repository that:
   - creates a packet linked to patient/appointment;
   - saves partial answers against a pinned form version;
   - computes readiness without exposing answer payloads to reception;
   - transitions with an optimistic version precondition;
   - records append-only status and exception evidence.

## Phase 2 — patient/proxy and receptionist APIs

1. Issue expiring, revocable resume grants after identity/proxy authorization.
2. Expose minimum-necessary packet metadata and form definitions.
3. Save partial responses idempotently and submit only after completeness
   validation.
4. Support staff-assisted and paper-transcribed provenance.
5. Stage coverage/entitlement evidence for human review and bind accepted
   consent attestations to `PatientConsentDirective`.

## Phase 3 — user experience

1. Add the patient/proxy next-action intake flow using the existing dynamic
   mobile renderer.
2. Add a receptionist readiness/exception projection with no unrestricted
   clinical answers.
3. Add accessible save/resume, plain-language/translation hooks, signature
   confirmation, assisted-entry disclosure, and offline reconciliation.
4. Verify mobile, kiosk, receptionist, and paper fallback paths in the shared
   nonproduction environment.

## Verification

- Red/green contract tests for lifecycle, minimum-necessary collection,
  completeness, proxy/staff provenance, and terminal-state behavior.
- Prisma model/migration tests for tenant keys, version pinning, append-only
  evidence, PHI classification, and RLS.
- Repository tests for partial save, optimistic transition, readiness
  projection, and exception creation.
- Prisma format/validate/generate, DB and web typecheck, affected unit tests,
  migration apply, full production build, and UX verification for Phase 3.

## Non-goals

- Canonical payer eligibility/coverage adjudication (BI-HEALTHCARE-030/031).
- Clinical encounter/note authority (BI-HEALTHCARE-016).
- A second form-definition system or a second mobile form renderer.
- Autonomous consent, coverage acceptance, or clinical interpretation by an AI
  coworker.
