# Healthcare canonical data authority design

**Backlog item:** BI-HEALTHCARE-001
**Epic:** EP-HEALTHCARE-PRACTICE
**Status:** Approved foundation design; implementation authority only after the downstream migration backlog items are separately approved
**Scope:** Medical and dental practice archetypes, including US commercial/public payer and European public/private funding profiles

## 1. Decision and boundaries

DPF will extend its existing organization, identity, scheduling, workforce, document, finance, policy, audit, and licensing authorities. It will not create a parallel healthcare application with a second person table, appointment calendar, document store, payment ledger, authorization engine, or audit log.

This document defines ownership, lifecycle, isolation, interoperability, and verification contracts. It authorizes **no database migration**. Any schema implementation must use a separate backlog item and the fleet-safe expand → backfill → validate → contract process.

The initial interoperability boundary is HL7 FHIR R4-compatible. Every connector pins its FHIR release and implementation guide; adapters preserve source version and payloads. R5-only semantics remain adapter projections until deliberately adopted.

## 2. Canonical authority matrix

| Concern | Canonical authority | Healthcare extension/projection | Forbidden parallel authority |
|---|---|---|---|
| Universal person/service identity | `Principal` + `PrincipalAlias` | `PatientProfile`, `PractitionerProfile` | A second PatientPerson, Doctor, or Contact identity |
| Workforce relationship | `EmployeeProfile` | `PractitionerRole`, qualification/privilege references | A healthcare-only employee roster |
| Public appointment request and slot | `StorefrontBooking` | Healthcare booking vocabulary and intake status | A separate public booking calendar |
| Accepted care appointment | `CareAppointment` | Participants, location, room/equipment, care status, lineage | Treating StorefrontBooking as the clinical encounter |
| Care episode | `Encounter` | Arrival, rooming, participants, diagnosis/procedure links | Mutable notes as the episode authority |
| Clinical fact | Typed `ClinicalRecord` envelope and version entries | Observation, report, condition, procedure, medication, note, care plan, questionnaire, dental artifact | Overwriting signed facts or storing facts only in blobs |
| Managed document/blob | Existing document/blob authority | Clinical classification, subject/encounter link, immutable source payload reference | A second attachment store |
| Consent/restriction/proxy | Healthcare consent and authority records linked to Principal | Purpose, scope, effective period, revocation, jurisdiction | Free-text consent flags on PatientProfile |
| Coverage/public entitlement | `Coverage` / eligibility evidence | US payer and EU/public/private funding profiles | Using Invoice as insurance entitlement |
| Claim/remittance | `Claim` / `ClaimResponse` workflow | Submission, adjudication, denial, remittance reconciliation | Treating the GL as payer workflow |
| Invoice/payment/accounting | Existing `Invoice`, `Payment`, `PaymentAllocation` | Patient responsibility and claim reconciliation links | A healthcare-only payment ledger |
| Provenance | Append-only clinical provenance/version events | Author, performer, source, signature, amendment lineage | Last-writer-wins clinical mutation |
| Authorization | Existing policy engine | Healthcare ABAC inputs and purpose-of-use decisions | Route-local role checks or a universal HIPAA toggle |
| Audit/evidence | Existing audit/evidence authorities | PHI access, disclosure, export, break-glass, release, claim actions | A second healthcare audit log |
| Qualification/license/network | Existing licensing/credential substrate | Practitioner qualifications, privileges, enrollments, network participation | Duplicated credential spreadsheets as authority |

## 3. Identity and role lifecycle

### 3.1 PatientProfile

`PatientProfile` is an organization-scoped role extension of the universal Principal, not a replacement identity.

- Unique key: `(organizationId, principalId)`.
- A Principal may hold patient roles in multiple practices without duplicating the person.
- Identifiers are typed, issuer-scoped, effective-dated aliases; raw identifiers are never global join keys.
- Merge and identity reconciliation use existing Principal lifecycle controls.
- Retention/legal-hold prevents destructive cascade from Principal or organization lifecycle.
- Household, responsible party, guardian, proxy, and consent are explicit relationships with scope and dates; they are not fields on the person.

### 3.2 PractitionerProfile and PractitionerRole

`PractitionerProfile` carries person-level professional identity. `PractitionerRole` is organization/location/specialty/license/privilege scoped and may reference EmployeeProfile.

The existing `ServiceProvider` remains the scheduling projection of PractitionerRole. Scheduling provider IDs reference the role/projection; ServiceProvider is not a second clinician authority.

### 3.3 Lifecycle matrix

| Aggregate | Required scope and keys | Lifecycle | Mutability | Provenance and sensitivity | Retention/deletion |
|---|---|---|---|---|---|
| PatientProfile | organization, principal, source identifiers | active, inactive, merged, entered-in-error | Demographics are versioned; identity merge is governed | source/version, recorder, sensitivity labels | retain per jurisdiction; no cascade through Principal |
| PractitionerProfile | principal, credential identifiers | draft, verified, suspended, retired | append qualification evidence; corrections retain history | issuer and verification evidence | retain credential history |
| PractitionerRole | organization, practitioner, location, specialty | pending, active, suspended, ended | effective-dated versions | privilege/license/network provenance | retain for audit and claims |
| CareAppointment | organization, subject, source, booking lineage | proposed, pending, booked, arrived, fulfilled, no-show, cancelled, entered-in-error | optimistic version; reschedule creates lineage | actor, channel, source version, correlation ID | retain operational/legal period |
| Encounter | organization, subject, appointment | planned, in-progress, finished, entered-in-error | closure/signature creates immutable version | participants, location, recorded/effective time | clinical retention/legal hold |
| ClinicalRecord | organization, subject, type, source ID/version | preliminary, final, amended, corrected, entered-in-error | append/amend only after signature/finalization | author, performer, source payload, sensitivity | jurisdiction profile; deletion normally tombstone/restriction |
| Consent/ProxyAuthority | organization, subject, grantee, purpose/scope | proposed, active, expired, revoked, entered-in-error | new version for scope or revocation | witness/source/legal basis | retain decision evidence |
| Coverage | organization, subject/responsible party, payer/funder ID | draft, active, inactive, cancelled | effective-dated version | eligibility source and verifiedAt | financial/legal retention |
| Claim/ClaimResponse | organization, coverage, encounter/services | draft, submitted, accepted, denied, paid, voided | append submission/adjudication versions | transmitter, payer, payload digest | payer and accounting retention |
| Access/Disclosure event | organization, actor, subject, purpose, action | immutable | append-only | full decision evidence | immutable per audit policy |

Every identifier-bearing aggregate includes `organizationId`, typed source system, source ID, source version, effective/recorded timestamps, status/version, provenance, sensitivity, retention class, legal-hold state, and a deletion/tombstone rule.

## 4. Booking-to-care transition

### 4.1 Authority transition

1. StorefrontBooking owns the public request and reserved slot.
2. Acceptance creates or links a CareAppointment using idempotency key `organizationId + bookingId`.
3. External EHR/PMS input uses `organizationId + sourceSystem + sourceId`.
4. An append-only `AppointmentSyncEvent` outbox records source version, target version, correlation ID, actor/channel, requested transition, result, and conflict classification.
5. CareAppointment owns healthcare workflow after acceptance; StorefrontBooking remains the customer-facing projection.

### 4.2 State mapping

The deterministic state machine supports:

`proposed → pending → booked → arrived → fulfilled`

Terminal/exception transitions are `no-show`, `cancelled`, and `entered-in-error`. A reschedule creates a new slot/version while retaining predecessor/successor lineage. Cancellation never silently erases the original reservation.

### 4.3 Concurrency and reconciliation

- All updates require an optimistic version precondition.
- Existing StorefrontBooking overlap quarantine and operator review patterns are extended, not replaced.
- Parallel booking, double booking, stale cancellation, reschedule collision, or conflicting external versions enter a human reconciliation queue.
- No channel (web, phone, receptionist, connector, or AI coworker) silently wins or orphans another record.
- Retries are idempotent and outbox delivery is at-least-once with consumer deduplication.

## 5. Tenant, subject, and sensitivity isolation

Isolation is enforced twice.

### 5.1 Relational constraints

Every patient, clinical, consent, coverage, claim, and access-event table includes `organizationId`. Composite foreign keys require the related organization to match. Cross-tenant relationships are impossible at the database constraint layer.

### 5.2 PostgreSQL RLS

RLS is enabled on PHI-bearing tables. The healthcare repository opens one transaction and uses `SET LOCAL` for validated organization, subject/patient set, purpose of use, sensitivity allowance, and service-principal context.

- Missing, malformed, or expired context denies all rows.
- Context never persists after transaction completion or connection-pool reuse.
- Background jobs and connectors use explicit service Principals and the same scoped transaction.
- Break-glass is a separate human-only policy decision, never an RLS bypass.
- Generic Prisma access to clinical models is prohibited by package-boundary and guard tests.

### 5.3 ABAC and projections

Before repository access, the existing policy engine evaluates actor, organization, role, purpose, patient subject, proxy/consent authority, care-team assignment, location/device/session risk, record sensitivity, requested action, and jurisdiction profile.

Sensitivity labels drive RLS/security-barrier predicates plus field projection/masking. They are not decorative metadata.

Representative projections:

- Receptionist: scheduling, contact preference, minimum intake completion; no unrestricted clinical facts.
- Billing: coverage, claim, coding and minimum necessary service data; no unrelated notes/results.
- Patient/proxy: authorized subject data and released results only; proxy scope and dates enforced.
- Care team: assignment, purpose, sensitivity, and privilege constrained.
- Administrator/support: metadata and operational health by default; PHI access requires explicit governed purpose.
- AI coworker: least-privilege tools, minimum-necessary payloads, and the same policy/repository path.

## 6. Clinical record, signature, and payload integrity

The relational schema models queryable canonical clinical facts. FHIR remains the integration boundary rather than becoming the database schema.

Each record carries:

- organization and subject Principal;
- appointment/encounter links;
- author, performer, recorder, verifier, and signer;
- type, status, version, effective and recorded time;
- sensitivity/security labels;
- source system/ID/version and correlation ID;
- provenance and amendment/supersession lineage;
- retention class, legal hold, and tombstone/restriction state;
- immutable original payload reference.

Original payload references store SHA-256 digest, byte length, media type, FHIR release, implementation guide/profile, immutable object version, source signature when supplied, and `verifiedAt`. Reads verify integrity; mismatches are quarantined and generate security evidence.

Final/signed clinical facts are never overwritten. Correction creates an amended version linked to the prior version with reason, author, and time. Entered-in-error preserves the record and audit trail while excluding it from ordinary clinical projection.

## 7. Residency and cross-border processing

Each organization has a residency zone and jurisdiction profile. The zone applies to:

- relational rows;
- clinical blobs and original payloads;
- backups and recovery copies;
- search/vector indexes;
- logs, traces, and audit evidence;
- inference prompts, outputs, caches, and evaluation artifacts.

Connectors cannot choose storage regions implicitly. Cross-zone replication/export is deny-by-default and must pass an audited minimum-necessary gateway containing legal basis/consent, purpose, recipient, processor/controller relationship, BAA/DPA or equivalent contract, destination adequacy/safeguard, data classes, expiry, revocation, and export digest.

## 8. Funding and jurisdiction profiles

Core schema does not fork by country or payer type.

### US profile

Coverage and payer/funder workflow support commercial plans, Medicare/Medicaid and other public programs, responsible party, eligibility/benefits, referral and prior authorization, claim/claim response, remittance, denial, and reconciliation. Coverage/Claim remain separate from Invoice/Payment but link deterministically to patient responsibility and accounting allocations.

### European profile

Profiles support member-state/public entitlement, referral or authorization requirements, statutory reimbursement, co-pay/exemption, cross-border or EHDS obligations, and optional private/supplemental coverage. Country/member-state adapters own identifiers, coding rules, contracts, and certification gates; they do not fork the core patient or clinical model.

### Launch gates

Each jurisdiction profile records counsel/owner approval, privacy basis, processor/DPA/BAA evidence, residency zone, incident-response path, certification requirements, payer/government enrollment requirements, terminology/implementation guides, retention rules, and supported funding workflows.

## 9. Prisma-to-EA allocation

| Proposed model/contract | Canonical package owner | EA allocation | Required review |
|---|---|---|---|
| PatientProfile | packages/db + healthcare repository | Identity / Patient role | Data Architect, Enterprise Architect |
| PractitionerProfile/Role | packages/db + workforce/licensing | Workforce / Clinical capability | Data Architect, Compliance |
| CareAppointment/AppointmentSyncEvent | scheduling + healthcare | Care access / Operations | Enterprise Architect |
| Encounter | healthcare clinical | Care delivery | Clinical safety, Data Architect |
| ClinicalRecord/version/provenance | healthcare clinical + document/blob | Clinical information | Clinical safety, Security, Data Architect |
| Consent/ProxyAuthority | healthcare policy | Authorization / Patient authority | Privacy, Security |
| Coverage/Claim/ClaimResponse | healthcare revenue + finance reconciliation | Funding / Revenue cycle | Finance, Data Architect |
| Residency/Jurisdiction profile | policy/compliance/deployment | Governance / Deployment | Security, Privacy, Enterprise Architect |
| Healthcare repository/RLS contract | packages/db + policy | Security boundary | Security, Data Architect |
| Access/Disclosure evidence | existing audit/evidence | Assurance | Security, Compliance |

The Prisma-to-EA mirror and verification view must be refreshed and reviewed before any migration is approved.

## 10. Fleet-safe implementation roadmap

1. **Expand:** add nullable/scoped authorities, composite candidate keys, repository types, and policy vocabulary without redirecting existing traffic.
2. **Backfill:** derive links from Principal, EmployeeProfile, ServiceProvider, StorefrontBooking, documents, licensing, and finance using idempotent jobs; quarantine ambiguity.
3. **Validate:** run cross-tenant, duplicate identity, booking conflict, signature/amendment, payload-integrity, residency, and reconciliation verification; add constraints `NOT VALID` where appropriate.
4. **Contract:** validate constraints, enable RLS and guarded repository routing, remove temporary dual-read paths only after fleet convergence.
5. **Operate:** continuous evidence, retention/legal-hold enforcement, connector conformance, downtime/recovery drills, and jurisdiction launch certification.

No step in this document authorizes a migration. Migration backlog items must comply with the fleet-safe schema evolution guard and carry same-migration remediation or an approved expand/contract sequence.

## 11. Verification cases

| ID | Verification |
|---|---|
| HC-DATA-01 | Two tenants use identical external patient IDs; neither tenant can query or link the other's row. |
| HC-DATA-02 | Two patients in one tenant share similar demographics; subject context prevents cross-patient disclosure. |
| HC-DATA-03 | A pooled DB connection is reused after commit; prior `SET LOCAL` context is absent and the next unscoped query returns zero rows. |
| HC-DATA-04 | Receptionist, billing, patient, proxy, care-team, administrator, connector, and AI projections each expose only allowed fields. |
| HC-DATA-05 | A revoked/expired proxy cannot view results or amend appointments beyond retained evidence. |
| HC-DATA-06 | Web and phone reschedules race; optimistic concurrency creates a reconciliation item and preserves both requests. |
| HC-DATA-07 | Duplicate outbox delivery does not duplicate CareAppointment or external updates. |
| HC-DATA-08 | A signed clinical record correction creates amendment lineage; the original remains immutable and auditable. |
| HC-DATA-09 | Original FHIR payload digest mismatch quarantines the payload and blocks ordinary projection. |
| HC-DATA-10 | A connector profile supplies the wrong FHIR release/profile; validation rejects it without schema corruption. |
| HC-DATA-11 | Cross-zone export without legal basis/contract/destination evidence is denied and audited. |
| HC-DATA-12 | Coverage adjudication changes patient responsibility; ClaimResponse reconciles to, but does not mutate, Invoice/Payment authority. |
| HC-DATA-13 | Break-glass requires a human declaration, is time-bounded and minimum-view, and produces notification and retrospective-review evidence. |
| HC-DATA-14 | Organization/Principal lifecycle operations cannot cascade-delete retained clinical or audit evidence. |

## 12. Standards boundary

The implementation should profile, not re-invent, the applicable standards:

- [HL7 FHIR](https://hl7.org/fhir/) for interoperability resources, provenance, audit/security labels, and implementation guides.
- [HHS HIPAA Security Rule guidance](https://www.hhs.gov/hipaa/for-professionals/security/index.html) and minimum-necessary policy for US regulated profiles.
- [NIST SP 800-207 Zero Trust Architecture](https://csrc.nist.gov/publications/detail/sp/800-207/final) for deny-by-default, explicit policy decisions, and service identity.
- [European Health Data Space Regulation (EU) 2025/327](https://eur-lex.europa.eu/eli/reg/2025/327/oj) and GDPR/member-state rules for EU profiles.

These references do not replace jurisdiction-specific legal, clinical-safety, payer, or certification review.
