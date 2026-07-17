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

1. Extend each requirement snapshot entry with the internal `DynamicForm.id`
   and exact version it belongs to. Reject access or writes when a requested
   form is not pinned by the packet; do not turn the global dynamic-form
   catalog into a patient-visible discovery surface.
2. Issue expiring, revocable `view` / `save` / `submit` resume grants only
   after `PatientAuthority` permits the authenticated patient or proxy. Return
   the high-entropy bearer token once and persist only its SHA-256 digest.
3. Expose `/api/v1/healthcare/intake/:packetId` as a token-scoped,
   minimum-necessary projection: packet lifecycle/readiness plus only the
   pinned form definitions. Never include saved answer values in the packet
   projection or receptionist projections.
4. Save partial responses through
   `/api/v1/healthcare/intake/:packetId/responses/:formId` with an
   idempotency key, optimistic response version, minimum-necessary validation,
   and patient/proxy/staff/paper provenance. Server-owned source keys provide
   retry idempotency; clients cannot choose another source system.
5. Submit through `/api/v1/healthcare/intake/:packetId/submit`; recompute
   completeness inside the same patient-context transaction and reject
   incomplete, expired, revoked, wrong-packet, or under-scoped grants.
6. Keep coverage evidence and consent attestation acceptance as separate
   reviewer-authorized endpoints. They are not part of the patient bearer-token
   write surface and remain staged evidence rather than canonical coverage or
   consent authority.

### Phase 2 delivery slices

- **2A — access and response API:** form-version pinning, tamper-resistant
  resume-token codec, authority-gated grant issuance, minimum packet
  projection, idempotent partial saves, and completeness-gated submit.
- **2B — receptionist review API:** readiness/exception queue with no response
  payloads, assisted/paper disclosure, grant revocation, and immutable audit
  projections.
- **2C — reviewed evidence API:** stage coverage documents and consent
  attestations, then accept/reject them only through explicit human authority.

Phase 2A is delivered as two reviewable checkpoints: the access/read checkpoint
owns grant issuance, patient-context RLS correction, and the minimum packet
projection; the response checkpoint owns retry-safe partial saves, the atomic
`assigned` to `in-progress` transition, and completeness-gated submit. A ready
submit completes current responses and advances the packet with one optimistic,
append-only status event. An incomplete submit returns blocker codes and never
advances packet state.

Rollback for 2A is route and repository removal; it adds no schema migration.
Existing Phase 1 tables remain forward-compatible and contain no raw resume
tokens.

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
