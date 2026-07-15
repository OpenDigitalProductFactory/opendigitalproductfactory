# Healthcare & Dental Practice Archetypes - Design

| Field | Value |
| --- | --- |
| Status | Proposed; implementation backlog filed |
| Date | 2026-07-15 |
| Epic | `EP-HEALTHCARE-PRACTICE` |
| Program spine | `BI-HEALTHCARE-000` |
| Architecture decision | `DI-444C1424A3F9` - capability overlay, high confidence, no commandment conflict |
| Existing category | `healthcare-wellness` |
| Initial leaves | Deepen `dental-practice`; add `medical-practice` |
| Related work | `BI-75B31594` identity and vocabulary convergence; `EP-4A12A7CB` MDM; `EP-F7E35344` AI coworker capability inputs |

## 1. Executive decision

DPF should become a care-practice operating platform for small ambulatory medical
and dental offices, not attempt a monolithic clone of Epic and not remain a
marketing storefront with a calendar.

The design keeps the existing `healthcare-wellness` archetype category, deepens
the existing `dental-practice` leaf, and adds a `medical-practice` leaf. A shared
**care-practice capability overlay** supplies the patient, practitioner,
appointment, encounter, clinical-document, payer/public-funding,
credentialing, and safety semantics that are absent today. It reuses DPF's
canonical Principal, managed-document, finance, licensing, booking, workspace,
portal, audit, and AI-governance substrate.

DPF owns the small-practice workflow and a safe minimum care record. Stable
adapters connect certified EHRs, laboratories, pharmacies, imaging systems,
payers, clearinghouses, government services, and national health exchanges.
The platform must never make an external vendor the only source of operational
truth, but it also must not casually absorb regulated network functions that
require certification, accreditation, or a licensed code-set agreement.

The legal term is **HIPAA**, not "HIPPA." This design uses HIPAA throughout.

## 2. Problem and target users

Small practices coordinate work across several people and several economic
actors at once:

- a patient, child, guardian, caregiver, or other authorized proxy;
- a receptionist or patient-access coordinator;
- doctors, dentists, nurses, dental hygienists, assistants, technicians, and
  rooms/equipment;
- a public payer, private insurer, employer plan, responsible party, or the
  patient;
- laboratories, imaging providers, pharmacies, referral partners, and dental
  laboratories;
- professional regulators, government enrollment bodies, and payer networks.

The current DPF substrate provides a useful first layer: lightweight dental
booking, appointment checkout, CRM/account concepts, payments, managed
documents, practitioner licensing records, conservative healthcare AI posture,
patient-oriented vocabulary, and a healthcare workspace profile. It does not
yet provide the coherent care journey or data authority needed to safely run a
practice.

### Primary jobs to be done

1. A patient can find care, establish identity and proxy authority, schedule or
   change an appointment, complete intake, communicate securely, see released
   results and records, understand costs, and pay what they owe.
2. Reception staff can work one arrival queue, resolve registration and coverage
   exceptions, confirm appointments, check patients in, collect forms and
   balances, assign rooms, and hand off to clinical staff.
3. A clinician can see the right patient context in the room, record an
   encounter, review allergies/medications/problems, capture findings and
   orders, sign the record, communicate the plan, and complete the handoff.
4. A dental team can chart teeth and periodontal findings, manage imaging,
   treatment plans, estimates, authorizations, dental laboratory cases, recalls,
   and procedure coding.
5. Billing staff can establish entitlement or coverage, estimate responsibility,
   obtain authorization, submit and reconcile claims, post public/private payer
   responses, manage denials, and collect patient balances.
6. Practice leadership can prove that each practitioner is licensed, qualified,
   enrolled where required, in-network where represented, and recredentialed on
   time.
7. AI coworkers can prepare and coordinate this work while preserving clinician
   authority, patient consent, minimum-necessary access, and a complete audit
   trail.

## 3. Market benchmark

The benchmark is a function map, not a commitment to reproduce every incumbent.

### 3.1 Ambulatory medical platforms

| Player | Capabilities emphasized | Design lesson for DPF |
| --- | --- | --- |
| [Epic](https://www.epic.com/software/access-and-revenue-cycle/) | Digital front door, self-scheduling, referrals and authorizations, self-arrival, telehealth, financial experience, and revenue cycle connected to MyChart. | Patient access, clinical work, and reimbursement are one journey even when surfaced through different roles. |
| [Oracle Health Ambulatory EHR](https://www.oracle.com/health/ambulatory-ehr/) and [Revenue Cycle](https://www.oracle.com/health/revenue-cycle/) | Ambulatory documentation, mobile access, patient administration, registration, scheduling, encounters, resource schedules, approvals, charge capture, claims, and financial workflows. | Appointment, encounter, resource, charge, and claim are distinct linked concepts. |
| [athenaOne](https://www.athenahealth.com/solutions/athenaone) | Integrated EHR, practice management, billing, patient engagement, and AI; its [small-practice offer](https://www.athenahealth.com/who-we-serve/small-medical-practices) stresses scheduling, care information, bill pay, and specialty workflows. | The initial product has to reduce staff work across front and back office, not merely store records. |
| [eClinicalWorks](https://www.eclinicalworks.com/products-services/) | EHR/practice management, documentation, telehealth, portal, population health, messaging, RCM, and a [kiosk workflow](https://www.eclinicalworks.com/products-services/patient-engagement/) for insurance confirmation and questionnaires. | Reception and self-service intake must update the same authoritative workflow, with an exception path for staff. |
| [NHS App](https://digital.nhs.uk/services/nhs-app/nhs-app-features) and [GP record access](https://digital.nhs.uk/services/nhs-app/nhs-app-features/gp-health-records-in-the-app) | Appointments, prescriptions, messages, notes, medicines, allergies, vaccines, documents, and test results over public-health infrastructure. | A useful patient interface is not intrinsically tied to US claims; public entitlement and nationally mediated records are first-class profiles. |
| [EMIS-X GP](https://www.emishealth.com/emis-x/emis-x-gp) and [Doctolib Connect](https://connect.doctolib.com/connect-messenger) | Point-of-care primary-care records, NHS interoperability, verified-professional messaging, and cross-provider coordination. | National interoperability and verified-practitioner coordination belong behind regional adapters, not hard-coded into the core. |

### 3.2 Dental platforms

| Player | Capabilities emphasized | Design lesson for DPF |
| --- | --- | --- |
| [Curve Dental](https://www.curvedental.com/feature-overview) | Scheduling, patient engagement, files/forms, charting, periodontal charting, imaging, e-prescribing, treatment planning/e-signature, insurance, billing, payments, and ambient AI. | Dental is not a cosmetic label over medical workflows; it needs tooth/surface/perio and treatment-plan semantics. |
| [CareStack](https://carestack.com/) | Scheduling, reminders, portal, kiosk, forms, clinical/perio charting, imaging, prescriptions, lab cases, eligibility, claims, financing, statements, payments, and analytics. | The dental long tail joins clinical, laboratory, benefit-plan, and financing workflows. |
| [Open Dental modules](https://www.opendental.com/site/0_modules.html) and [features](https://www.opendental.com/site/features.html) | Appointment, patient/family and insurance, account/claims/payments, treatment plan, chart, imaging, confirmations, arrivals, texting, portal, web forms, and web scheduling. | Household/responsible-party relationships and recall/confirmation loops are central to small offices. |
| [Henry Schein practice management](https://www.henryscheindental.com/us-en/dental/practice-management-software/about-practice-management-software.aspx?id=1) | Dentrix/Ascend practice management around scheduling, charting, treatment, imaging, billing, and claims. | DPF must support both native workflows and connector-led coexistence with established dental systems. |

### 3.3 Market synthesis: required module families

Every leading suite converges on these families:

1. patient access and engagement;
2. appointment, resource, and arrival management;
3. clinical documentation and orders/results;
4. specialty workflows, especially dental charting and imaging;
5. coverage, authorization, coding, claims, and patient responsibility;
6. practitioner, location, and organization administration;
7. secure communication and referrals;
8. analytics, quality, recall, and population work;
9. interoperability and migration;
10. privacy, security, audit, availability, and regulatory evidence.

## 4. Standards and regulatory baseline

This is an architecture baseline, not legal advice. Each launch jurisdiction
requires counsel, security review, contracts, and certification analysis.

### 4.1 United States

- The [HHS HIPAA Security Rule](https://www.hhs.gov/hipaa/for-professionals/security/index.html)
  requires administrative, physical, and technical safeguards for electronic
  protected health information and protection of its confidentiality,
  integrity, and availability.
- The [HHS minimum-necessary standard](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/minimum-necessary-requirement/index.html)
  makes purpose- and role-limited access a product requirement, not a policy
  document alone.
- The [ONC Certification Program regulations](https://healthit.gov/certification-health-it/certification-program-regulations)
  and Cures Act rules establish expectations for standardized APIs, patient
  access, USCDI exchange, and information-blocking controls. DPF must explicitly
  decide whether a release is certified health IT, interoperates with it, or is
  outside that claim.
- [CMS Administrative Simplification](https://www.cms.gov/priorities/key-initiatives/burden-reduction/administrative-simplification/hipaa)
  governs standard transactions, identifiers, code sets, and operating rules.
  Eligibility commonly uses X12 270/271; dental claims use 837D and medical
  professional claims use 837P.
- [PECOS](https://www.cms.gov/medicare/enrollment-renewal/providers-suppliers/chain-ownership-system-pecos)
  manages Medicare enrollment and revalidation. [CAQH Provider Data Portal](https://www.caqh.org/hubfs/Fact%20Sheets/Provider_Data_Portal_Fact_Sheet.pdf)
  is widely used to maintain a reusable credentialing profile for health plans.
  These are separate from state licensure and from a payer's network contract.
- The [FDA clinical decision support guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/clinical-decision-support-software)
  distinguishes some non-device clinician decision support from functions that
  remain regulated as devices. The first AI release therefore remains
  administrative and documentation-assistive, not diagnostic or autonomous.

### 4.2 European Union and public/private systems

- [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj) treats health data as a
  special category; jurisdiction profiles must carry lawful-basis, purpose,
  retention, residency, patient-right, and processor/subprocessor policy rather
  than pretending "HIPAA compliant" is a universal setting.
- [Regulation (EU) 2025/327, the European Health Data Space](https://eur-lex.europa.eu/legal-content/en/LSU/?uri=CELEX%3A32025R0327),
  introduces phased rights and exchange obligations including access, download,
  proxy authority, restrictions, access-log visibility, patient summaries,
  e-prescriptions, laboratory results, and imaging. Its staged application runs
  from 2027 through 2035.
- [Directive 2005/36/EC](https://eur-lex.europa.eu/eli/dir/2005/36/oj) and the
  Commission's [automatic-recognition guidance](https://single-market-economy.ec.europa.eu/single-market/services/free-movement-professionals/recognition-professional-qualifications-practice/automatic-recognition_en)
  cover recognition of doctors, dentists, and nurses meeting harmonized minimum
  training requirements. Professionals still apply to the competent authority
  in the country where they intend to work.
- State-funded care still has eligibility, referrals, tariffs/contracts,
  exemptions, waiting-list rules, and reporting. A private pathway may operate
  beside it. DPF therefore models **funding arrangements**, not a Boolean
  `hasInsurance` flag.

### 4.3 Interoperability and terminology

- Use [HL7 FHIR R4 Appointment](https://hl7.org/fhir/R4/appointment.html) for
  external appointment semantics and its relationship to Encounter.
- Use FHIR resources and profiles for patient, practitioner, organization,
  coverage, claim, service request, observation, diagnostic report, consent,
  provenance, and audit exchange. [DiagnosticReport](https://hl7.org/fhir/R4/diagnosticreport.html)
  links reports to observations, imaging, and orders; [Claim](https://hl7.org/fhir/R4/claim.html)
  distinguishes claim/preauthorization exchanges from eligibility and EOB.
- Use SMART on FHIR/OAuth patterns for delegated application access where the
  target ecosystem supports them.
- Use [DICOM](https://www.dicomstandard.org/about) and DICOMweb for clinical
  imaging; DICOM explicitly covers dentistry and has a dedicated
  [dentistry working group](https://www.dicomstandard.org/activity/wgs/wg-22).
- Use licensed, versioned terminology packages rather than copied constants:
  ICD-10-CM/ICD-10, SNOMED CT where licensed, LOINC, RxNorm/NDC where applicable,
  and local/national code sets.
- The ADA's [CDT code](https://www.ada.org/publications/cdt) is the US standard
  for documenting dental procedures. The ADA notes that commercial use requires
  a license; the product must store licensed versions and provenance rather than
  check proprietary descriptors into source.

## 5. Architectural options considered

| Option | Summary | Outcome |
| --- | --- | --- |
| A. Shallow template | Add healthcare labels, forms, generic booking, and connectors only. | Rejected: fast but cannot safely operate patient, rooming, record, payer, or credentialing work. |
| B. Parallel clinical product | Create a second healthcare category and comprehensive native EHR stack, duplicating identity, booking, finance, documents, and licensing. | Rejected: large blast radius, duplicate authority, slow learning loop. |
| C. Capability overlay | Extend the existing category with a reusable care-practice overlay, minimal care-specific data, stable adapters, and phased safety gates. | **Selected.** Kernel composite 12.355, margin 3.085, high confidence. |
| D. Integration shell | Put a DPF portal and AI layer over an external EHR that remains the sole system of record. | Rejected as the universal model: useful deployment mode, but creates vendor lock-in and cannot serve independent small practices. |

Option C includes integration-led deployments. It rejects only the claim that
every organization must be dependent on one external EHR.

## 6. Product and information architecture

### 6.1 Archetype shape

Keep `healthcare-wellness` as the single category spine.

- `medical-practice`: primary care and small ambulatory/specialty offices;
- `dental-practice`: general dental offices first, extensible to specialties;
- existing physiotherapy, counselling, home-health, phlebotomy, optician, and
  other leaves can adopt selected overlay capabilities without becoming EHRs.

Activation must use the existing canonical axes:

- primary consumer: `patient-and-payer`;
- commercial model: `encounter-based`;
- provisioning model: `episode-of-care`;
- transaction context: `appointment` and `episode-of-care`;
- isolation: patient/clinical data must never use the current shared default.

### 6.2 Surfaces

No new top-level dashboard is introduced.

| User | Existing surface direction | First viewport |
| --- | --- | --- |
| Patient/proxy | External `/portal` experience | Next action: appointment, task/form, message, released result, amount due. Never expose internal status codes. |
| Reception/patient access | Existing workspace/home and work queues | Today's arrivals and exceptions, with confirmation, registration, coverage, balance, room, and handoff state. |
| Clinician/in-room team | Existing workspace shell with a care encounter profile | Patient safety banner, reason for visit, allergies/medications/problems, pending tasks, rooming data, note/order/result workflow. |
| Billing/authorization | Finance/work queue surface | Eligibility, authorization, claim/response, denial, and patient-balance exceptions. |
| Practice administrator | Existing Storefront/configuration and workforce/admin surfaces | Services, locations, schedules, practitioners, credentials, funding profiles, forms, rules, and connectors. |

The workspace-profile resolver remains the source of role/archetype composition.
Cards and summaries use the report-kit primitives. Empty states explain the
missing data or configuration and the direct next action.

### 6.3 Capability domains

1. **Patient identity and authority** - identity matching, household/responsible
   party, guardian/proxy, emergency contact, communication preference, consent,
   privacy restriction, accessibility and language need.
2. **Patient access** - discovery, scheduling, rescheduling, cancellation,
   waitlist, reminders, confirmation, check-in, forms, messages, released
   results, record requests/export, prescriptions/refills, bills, estimates,
   payments, and access history.
3. **Practice flow** - practitioner/room/equipment availability, visit types,
   recall, arrival queue, identity/coverage exceptions, copay/deposit, rooming,
   handoff, checkout, follow-up, and no-show recovery.
4. **Clinical record** - care episode, appointment, encounter, problems,
   allergies, medications, observations, notes, orders, results, procedures,
   care plan, referral, provenance, amendment, signature, and release policy.
5. **Dental record** - dentition and tooth/surface state, odontogram,
   periodontal chart, images, diagnosis/findings, treatment plan, case
   acceptance, estimate/preauthorization, procedure completion, lab case,
   recall, and dental codes.
6. **Funding and revenue** - public entitlement, private coverage, responsible
   party, benefit/eligibility response, referral requirement, authorization,
   coding/charge capture, claim, remittance/payment, denial, coordination of
   benefits, patient responsibility, statement, payment plan, and refund.
7. **Practitioner qualification** - identity, role/specialty/taxonomy,
   education and license evidence, sanctions/limitations, location privileges,
   government enrollment, payer credentialing, network contract, fee schedule,
   panel status, revalidation/recredentialing, and expiry alerts.
8. **Interoperability** - FHIR/SMART, DICOMweb, laboratory, prescribing,
   clearinghouse/payer, public-service, terminology, import/export, identity,
   and event/subscription adapters.
9. **Safety, privacy, and operations** - policy, purpose-of-use, least privilege,
   break-glass, audit, disclosure accounting, retention/legal hold, encryption,
   backup/restore, downtime, breach response, data residency, and vendor/BAA or
   processor governance.

## 7. Canonical data authority

The implementation data-design item must validate these allocations before a
migration is authored.

| Concept | Authority direction | Constraint |
| --- | --- | --- |
| Human/organization identity | Existing `Principal` and aliases | A patient is not modeled as a second identity in `CustomerAccount`. Coordinate with `BI-75B31594`. |
| Employee/practitioner | Existing `EmployeeProfile` plus Principal identity | Add a care-practitioner profile only for clinical identifiers, specialty/taxonomy, and care-specific state. |
| License evidence | Existing person/organization license records and managed documents | Extend for issuing authority, scope, restrictions, verification, and renewal; do not duplicate documents. |
| Patient role | Narrow `PatientProfile` associated to Principal | Contains care identifiers/preferences, not a second demographics master. |
| Proxy/responsible party | Typed Principal-to-Principal authority/relationship | Must include scope, basis, effective dates, revocation, and evidence. |
| Storefront request | Existing booking/channel substrate | A booking is the patient-access request/channel record, not necessarily the clinical appointment authority. |
| Care appointment | Care domain, with participants and required resources | Must support patient, practitioners, locations, rooms/equipment, status history, and linkage to encounter. |
| Encounter/record | Care domain | Signed and amended clinical facts need provenance; generic documents alone are insufficient. |
| Files and rendered records | Existing managed-document/blob/version substrate | Clinical metadata and access policy remain in care domain; bytes are not copied. |
| Invoices/payments | Existing finance substrate | Add claim/remittance/coverage allocation links, not a second ledger. |
| Coverage/public entitlement/claim | Care funding domain | Separate coverage, eligibility, authorization, claim, adjudication, remittance, and patient responsibility. |
| Audit/evidence | Existing audit/evidence substrate plus healthcare events | Append-only access/disclosure/clinical-signature provenance is required. |

External FHIR is an interface contract, not the internal database schema. DPF
must not create an unbounded generic FHIR JSON store as its only domain model.
Preserve original payload/version/provenance for exchange, map required facts to
typed canonical models, and expose conformance profiles at the adapter boundary.

## 8. Regional funding and provider participation

### 8.1 Funding profiles

Use a versioned `CareFundingProfile` selected by jurisdiction, organization,
service, and patient arrangement.

| Profile | Typical flow |
| --- | --- |
| US commercial | Subscriber/dependent coverage -> eligibility/benefits -> referral or prior authorization -> professional/dental claim -> remittance/denial -> patient responsibility. |
| US Medicare/Medicaid | Program enrollment and revalidation -> beneficiary eligibility -> program-specific coverage/authorization -> claim/remittance -> reporting and audit. |
| State/national health service | Identity/entitlement -> registered/listed practice or referral pathway -> tariff/contract/episode reporting -> exemption or patient charge -> public settlement. |
| European private | Private coverage/guarantee/preauthorization -> invoice/claim or patient reimbursement -> insurer response -> patient balance. |
| Self-pay/membership | Estimate and consent -> deposit/payment plan -> invoice/payment/refund; no fake insurer record. |
| Mixed episode | Public benefit plus private supplement or patient responsibility, with explicit coordination/allocation. |

The core never infers financial coverage from clinical eligibility and never
assumes that state-funded means free at the point of care.

### 8.2 Provider participation lifecycle

Qualification and network participation are separate states:

1. establish the person's verified identity;
2. record education/qualification and professional registration/license;
3. verify scope, specialty, limitations, sanctions, expiry, and continuing
   requirements where applicable;
4. establish organization/location privileges and employment/contract role;
5. enroll in government programs or obtain national practice identifiers;
6. submit payer/network credentialing data and evidence;
7. contract, negotiate fee schedule, set effective dates and panel state;
8. revalidate/recredential and continuously monitor expiries/changes;
9. prevent scheduling, billing, or public representation when required state is
   missing, expired, restricted, or inconsistent.

The UI must distinguish **licensed**, **credentialed**, **enrolled**,
**contracted/in-network**, and **authorized at this location/service**. They are
not synonyms.

## 9. AI coworker model

### 9.1 Initial coworker pack

| Coworker | Assistive scope | Required human boundary |
| --- | --- | --- |
| Patient Access Coordinator | Scheduling, confirmations, intake completeness, waitlist offers, routing, FAQs. | Patient confirms changes; staff handles identity, urgency, and policy exceptions. |
| Reception Coordinator | Arrival queue, missing forms/coverage, room/resource status, checkout tasks. | Staff approves identity merges, coverage attestations, refunds, and exceptional access. |
| Clinical Documentation Assistant | Ambient/transcript-supported draft, structured extraction, after-visit draft, coding suggestions with evidence. | Licensed clinician reviews, edits, signs, and owns the record and code selection. |
| Referral & Authorization Coordinator | Assemble referral/authorization packets, status follow-up, missing-evidence detection. | Staff/clinician approves submission and medical-necessity representations. |
| Revenue Cycle Coordinator | Eligibility exceptions, claim readiness, remittance/denial classification, patient-balance communication drafts. | Staff approves claims, adjustments, write-offs, collections, and payer disputes. |
| Credentialing & Network Coordinator | Evidence checklist, applications, expiry/revalidation monitoring, status reconciliation. | Practitioner/authorized administrator attests and submits binding information. |
| Recall & Care-Gap Coordinator | Recall lists, overdue follow-up, outreach drafts, failed-contact escalation. | Clinician-configured rules; no independent diagnosis or prioritization of urgent symptoms. |
| Privacy & Safety Steward | Access anomalies, missing purpose, disclosure review, risky draft detection, downtime/breach checklist. | Privacy/security officer decides incidents, disclosures, and sanctions. |

### 9.2 Non-negotiable controls

- deny by default; purpose-of-use and minimum-necessary scope on every patient
  and clinical tool call;
- separate patient, proxy, receptionist, billing, hygienist/nurse, clinician,
  administrator, and AI authority bindings;
- approved PHI-capable model/provider routing only, with BAA/processor and
  residency policy where required; DPF's existing federation egress ban remains
  binding;
- no autonomous diagnosis, treatment selection, prescription, result release,
  claim attestation, network application attestation, or chart signature;
- every AI-authored clinical or consequential financial artifact is visibly a
  draft with source/evidence links, confidence/uncertainty where meaningful,
  reviewer identity, and immutable provenance;
- urgent or ambiguous patient messages route to a human-defined safety pathway;
- evaluation sets include wrong-patient, hidden-negation, medication/allergy,
  tooth/surface, coverage, and proxy-access failure modes;
- patient-facing AI says what it can and cannot do and never suggests emergency
  messaging is continuously monitored unless the practice can prove it.

## 10. Critical workflows

### 10.1 Schedule to checkout

1. Patient/proxy selects a service, location, constraints, and preferred time.
2. Policy evaluates identity/proxy, practitioner, room/equipment, visit type,
   funding/referral requirements, and safe scheduling rules.
3. The system holds and confirms the appointment and records notification
   preference.
4. Pre-visit tasks collect only necessary demographics, forms, consent,
   coverage/entitlement, reason for visit, and practice-specific questionnaires.
5. Reception resolves exceptions and records arrival; kiosk/mobile self-check-in
   updates the same queue.
6. Rooming hands the patient to the authorized clinical team and starts or
   associates the encounter.
7. Clinician signs record/orders/treatment plan; release rules determine what
   becomes patient-visible and when.
8. Checkout creates follow-up/recall/referral tasks, calculates charges and
   responsibility, takes payment if appropriate, and sends the visit summary.

### 10.2 Result lifecycle

Order -> specimen/acquisition -> result/report -> reconciliation to patient and
order -> abnormal/urgent routing -> clinician review/release policy -> patient
notification -> patient acknowledgement/question -> follow-up task. Receipt is
not the same as clinical review, and release is not the same as patient
acknowledgement.

### 10.3 Dental treatment lifecycle

Findings/images/perio -> diagnosis by dentist -> treatment plan and alternatives
-> benefit estimate/preauthorization where used -> patient consent/case
acceptance -> scheduled procedures and lab cases -> procedure completion and
signed note -> coding/claim -> recall/maintenance.

## 11. UX-fit requirements

- The patient first viewport presents the next meaningful action, not an EHR
  module menu.
- The receptionist first viewport is a chronological arrival/exception flow,
  not a generic KPI dashboard.
- In-room interaction is keyboard/touch efficient, preserves patient context,
  supports interrupted work, and makes wrong-patient risk conspicuous.
- Clinical warnings are severity-ranked and actionable; avoid undifferentiated
  alert noise.
- Reschedule/cancel, proxy use, result release, consent, payment, refund, claim,
  credential attestation, and clinical signature show a review/confirmation step
  proportionate to consequence.
- Appointment and patient status have text labels and accessible semantics;
  never depend on color alone. Imaging/odontogram controls require text
  alternatives and keyboard-accessible workflows.
- Forms support save/resume, mobile use, plain language, translation hooks,
  accessibility, paper/staff-assisted alternatives, and a clear explanation of
  why sensitive data is requested.
- External patient records never expose internal staff notes, payer work queues,
  or unreleased results through vocabulary or API leakage.

## 12. SysML architecture note

### Scope and boundaries

- **System of interest:** DPF care-practice capability overlay.
- **Inside:** patient access, practice flow, minimum clinical/dental record,
  funding orchestration, credential status, policy/audit, AI coordination.
- **Outside but interfaced:** certified EHRs, national exchanges, laboratories,
  pharmacies, imaging/PACS, payers/clearinghouses, public services, regulators,
  credentialing networks, payment processors.

### Requirements and constraints

- R1: no appointment can allocate an unavailable required practitioner/resource.
- R2: no patient/record access occurs without organization, subject, purpose,
  role, and policy evaluation.
- R3: signed clinical content is immutable; correction creates an attributed
  amendment.
- R4: no claimable service becomes a claim without authoritative service,
  coding, practitioner, location, funding, and attestation context.
- R5: no practitioner is represented or scheduled contrary to verified license,
  privilege, enrollment, or network state required by the configured profile.
- R6: AI cannot cross clinical, financial, privacy, or credential attestation
  boundaries.
- R7: every external exchange is versioned, idempotent where applicable,
  attributable, retry-safe, and reconciled.
- R8: jurisdiction differences are versioned profiles, not tenant-specific
  forks.

### Interfaces and ports

Patient portal; staff workspace; FHIR/SMART; DICOMweb; lab/order/result;
e-prescribing; payer/clearinghouse; national/public service; terminology;
credentialing/enrollment; payment; notification; audit/evidence.

### Allocations and authority

Postgres remains transactional authority. Neo4j and Qdrant remain projections.
Managed-document storage owns bytes/versions. Finance owns invoices/payments.
The care domain owns appointment/encounter/clinical/funding/credential link
semantics. EA mirrors the shipped model; it does not become a second runtime
record system.

### Verification cases

- V1 wrong-patient/proxy/tenant isolation and minimum-necessary authorization;
- V2 concurrent practitioner/room/equipment scheduling and waitlist promotion;
- V3 reception-to-rooming-to-signed-encounter happy path and interruptions;
- V4 result reconciliation, urgent routing, review, release, and acknowledgement;
- V5 dental chart/treatment/837D traceability and licensed terminology handling;
- V6 US eligibility/authorization/claim/remittance and denial correction;
- V7 public-entitlement/private-supplement allocation without fake insurance;
- V8 license/enrollment/network expiry prevents only the configured prohibited
  actions and surfaces a recoverable path;
- V9 AI drafts cannot self-sign, self-release, self-submit, or exceed PHI scope;
- V10 export/access log/amendment/retention and disaster-recovery evidence.

EA/parity impact: the eventual data design, capabilities, interfaces, roles, and
verification allocations must be projected into the existing EA/parity
substrate. This spec is target-state architecture context, not a parallel model.

## 13. Delivery slices and release gates

### Slice 0 - Architecture, threat model, and archetype activation

Add the `medical-practice` leaf, correct care activation axes/isolation, define
the canonical data and jurisdiction profile contracts, complete privacy/safety
threat modeling, and establish conformance fixtures. No clinical claim is made.

### Slice 1 - Patient access and front desk

Deliver identity/proxy, multi-resource appointment, confirmation/waitlist,
digital intake, arrival queue, rooming/handoff, basic secure communication, and
existing-finance patient payment. This is the first useful small-practice
release.

### Slice 2 - Encounter and results foundation

Deliver signed encounters, core clinical facts, orders/results, release policy,
referrals, managed-document linkage, and clinician/reception workspaces. Obtain
formal certification/regulatory scope determination before making EHR claims.

### Slice 3 - Dental depth

Deliver odontogram/perio, imaging, treatment planning/consent, lab cases,
recalls, licensed terminology integration, benefit estimates, and dental claim
traceability.

### Slice 4 - Funding and revenue profiles

Deliver US coverage/eligibility/authorization/claim/remittance/denial flows and
versioned public/private European funding adapters. No payer transaction is
called production-ready without trading-partner certification and reconciliation
evidence.

### Slice 5 - Practitioner participation and governed AI

Deliver qualification/licensure/privilege/enrollment/network lifecycle and the
assistive coworker pack. Clinical AI remains draft-only until separate intended
use, risk, evaluation, monitoring, and regulatory gates approve broader scope.

### Slice 6 - Scale, quality, and ecosystem

Add population/recall/quality measures, bulk import/export, connector ecosystem,
resilience/downtime drills, localization, and jurisdiction expansion.

## 14. Success measures

Measures are segmented by jurisdiction and practice type.

- appointment completion, no-show, cancellation-fill, and time-to-next-available;
- median patient scheduling/intake completion and staff exception touches;
- check-in-to-room and room-to-checkout cycle time;
- unsigned note, unreconciled result, unacknowledged urgent result, and referral
  closure aging;
- dental treatment-plan acceptance, preauthorization aging, and recall recovery;
- clean-claim rate, days in receivables, denial rate, eligibility/authorization
  exception rate, and patient-estimate variance;
- credentialing/enrollment cycle time and expired/revalidation exception count;
- patient portal completion, message response, accessibility, and proxy-use
  success;
- wrong-patient/proxy/privacy incidents, break-glass events, audit completeness,
  AI override rate, and safety-evaluation failures.

Do not optimize throughput metrics in ways that conceal safety, access, equity,
or staff workload.

## 15. Non-goals

- inpatient hospital, emergency department, operating theatre, ICU, bed, or
  inpatient medication-administration workflows;
- autonomous diagnosis, treatment, prescribing, coding, result release, or
  claim/credential attestation;
- a universal global compliance toggle;
- owning a clearinghouse, pharmacy network, laboratory network, or public-health
  exchange in the first program;
- checking licensed terminology content into the repository;
- replacing every incumbent EHR on day one;
- treating patients as CRM leads or clinical records as ordinary documents.

## 16. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Scope expands into an unsafe Epic clone. | Deliver the six gated slices; require a separate BI and intended-use decision for every high-risk clinical capability. |
| Existing identity/booking/finance concepts are duplicated. | Data architecture gate and explicit dependency on `BI-75B31594`; architecture review before migration. |
| HIPAA is mistaken for global compliance. | Versioned jurisdiction, funding, privacy, and professional-participation profiles. |
| Patient portal leaks unreleased or staff-only information. | Separate external projections, release policy, proxy scope, negative authorization tests, and audit. |
| AI creates clinical or financial authority. | Draft state, explicit review/attestation, tool grants, purpose-of-use, provenance, and hard transition guards. |
| Proprietary code sets are copied into source. | Terminology package registry, licenses, version/provenance, and no bundled proprietary descriptors. |
| Connector failures silently lose clinical/payer events. | Idempotency, durable inbox/outbox, reconciliation queues, human-visible exceptions, and replay evidence. |
| Public/private funding differences become tenant forks. | Stable funding contract plus versioned country/program adapters and conformance fixtures. |
| Credentialing status is overclaimed. | Distinct license, qualification, privilege, enrollment, credentialing, contract, and network states. |

## 17. Open decisions delegated to implementation BIs

1. Whether `StorefrontBooking` can be safely generalized as the canonical care
   appointment or should remain the access-channel request linked to a new
   `CareAppointment`.
2. The narrowest typed clinical-record model that supports the first encounters
   without turning Postgres into an unbounded FHIR document store.
3. The first launch jurisdiction and precise certification/trading-partner scope.
4. The first prescribing, laboratory, imaging, payer, and credentialing
   connectors based on partner access and commercial evidence.
5. Whether a separate clinical terminology service is required before dental
   charting, or the existing registry pattern can own licensed packages.
6. Exact break-glass, sensitive-record segmentation, minor/guardian, and result
   release policies for the first jurisdiction.

These are bounded design decisions. They must be resolved through existing
substrate research and the kernel before implementation, not guessed in code.
