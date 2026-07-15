# Healthcare privacy, security, and safety threat model

**Backlog item:** BI-HEALTHCARE-003
**Epic:** EP-HEALTHCARE-PRACTICE
**Status:** Approved foundation design; required before patient-data implementation
**Scope:** Medical and dental practices, patient/proxy portals, workforce workflows, integrations, AI coworkers, US payer profiles, and European public/private funding profiles

## 1. Decision and boundary

Healthcare capabilities are deny-by-default. DPF extends the existing Principal, workforce, policy/rule, agent-grant, audit/evidence, compliance-control, notification, document/retention, and sovereignty authorities. It does not create a second authorization engine, healthcare-only audit log, or universal “HIPAA compliant” switch.

Every decision evaluates organization, authenticated principal or service identity, patient subject, workforce/proxy relationship, purpose of use, assignment/care relationship, sensitivity, consent/restriction, requested operation, jurisdiction profile, and session/device/location risk. A role alone never grants clinical access.

This design authorizes no patient-data migration or production launch. The canonical data authorities are defined in `2026-07-15-healthcare-canonical-data-authority-design.md`; implementation remains gated by separate backlog items, security/privacy review, clinical-safety review, and jurisdiction-specific legal confirmation.

## 2. Data classification and sensitivity matrix

| Class | Examples | Default sensitivity | Permitted handling | Release/retention constraints |
|---|---|---|---|---|
| Public practice data | locations, services, public hours, practitioner directory | public | public portal and approved indexes | business retention |
| Patient identity/contact | demographics, identifiers, contacts, preferred language | PHI/personal | verified identity, minimum-necessary operational views | identity provenance; jurisdiction retention |
| Scheduling/intake | appointment reason, questionnaire, accessibility needs | PHI; field labels may elevate | receptionist sees readiness and operational fields, not clinical narrative by default | retain booking and disclosure evidence |
| Clinical routine | notes, diagnoses, observations, images, dental charting | clinical PHI | assigned care team and released patient projection | signed facts append/amend only; legal hold |
| Sensitive segmented | behavioral health, substance-use, sexual/reproductive, genetic, HIV or member-state categories | restricted clinical PHI | explicit purpose, relationship, restriction and release policy | stricter segmentation; no broad admin projection |
| Urgent/safety-critical | critical result, urgent message, allergy, high-risk alert | safety critical | credentialed human routing and acknowledgment | escalation evidence; AI cannot close |
| Coverage/claims | eligibility, benefits, authorization, claim, remittance | financial PHI | billing and minimum clinical substantiation | payer/legal retention; separate from GL |
| Payment/accounting | invoice, patient responsibility, payment/allocation | restricted financial | finance projection and patient account view | accounting retention; no clinical narrative |
| Consent/proxy/restriction | guardian authority, consent, revocation, disclosure restriction | legal authority | policy evaluation and patient-authority workflows | effective-dated, immutable history |
| Audit/disclosure/security | access decisions, exports, break-glass, incidents | highly restricted assurance | security/privacy reviewers; patient disclosure accounting where required | immutable evidence and legal hold |
| Credentials/network | license, qualification, privilege, payer/public network enrollment | restricted workforce | credentialing and authorized scheduling projections | issuer verification and effective history |
| Model/tool context | prompts, retrieved context, outputs, tool arguments | inherits highest input label | approved routes only; minimized and purpose bound | no training/reuse unless explicitly authorized |

Labels are executable policy inputs. Query projections, masking, search/vector indexing, export, notification content, model routing, and logging inherit the highest applicable label. Moving data to a lower classification requires an explicit governed transformation and evidence.

## 3. Actors, purposes, and operations matrix

Legend: A = allowed when all contextual policy inputs pass; H = credentialed human approval required; D = denied by default.

| Actor | Valid purposes | View | Create/draft | Amend | Sign/release | Export | Delete | Key restrictions |
|---|---|---:|---:|---:|---:|---:|---:|---|
| Patient | own care, payment, access request | A | A | A for supplied data | D | A for released minimum set | D | never another subject or unreleased result |
| Minor patient | own care per age/jurisdiction policy | A | A | A | D | H | D | confidentiality rules may differ from guardian scope |
| Guardian/proxy | scoped support for named subject | A | A | A within authority | D | H | D | authority must be effective, verified, unrevoked, and category scoped |
| Receptionist | identity verification, scheduling, intake readiness | A | A | A operational | D | D | D | no clinical narrative/result content by role alone |
| Billing specialist | eligibility, claim, patient responsibility | A | A | A financial | H for submission | A payer minimum | D | no unrelated clinical narrative |
| Nurse/hygienist | assigned care, documentation, escalation | A | A | A within license | H per privilege | D | D | cannot sign/release outside credential and policy |
| Clinician/dentist | treatment, care coordination | A | A | A | A within privilege | H | D | assigned subject, valid credential, supported jurisdiction |
| Practice administrator | configuration, operations, evidence | A masked | A config | A config | D | H operational | D | admin role does not imply clinical-content access |
| Integration service | contracted exchange purpose | A scoped | A scoped | A scoped | D | A scoped | D | service identity, connector profile, replay/idempotency and egress gate |
| Support operator | incident support | D ordinarily | D | D | D | D | D | sanitized diagnostics; exceptional access uses separate controlled procedure |
| AI coworker | reminders, drafting, reconciliation, queue assistance | A minimum | A draft | A draft | D | D unless human-approved tool flow | D | never diagnose, independently triage, sign, release, submit, override consent, or break glass |
| Security/privacy reviewer | assurance, investigation | A evidence | A case | A case | D | H evidence | D | clinical content only when required and audited |

Operations are separately authorized: viewing does not imply amendment; amendment does not imply signature; signature does not imply patient release; release does not imply export; export does not imply deletion. Claim submission, result release, urgent advice, consent override, legal-hold change, and cross-border export are consequential actions requiring an appropriately authorized human.

### 3.1 Deterministic authorization contract

The policy decision input is a versioned object:

`{ organizationId, actorPrincipalId, servicePrincipalId?, subjectPrincipalId, roleIds, relationshipIds, assignmentIds, purposeOfUse, sensitivityLabels, consentAndRestrictionIds, operation, resourceType, resourceId, jurisdictionProfileId, credentialAndPrivilegeIds, sessionRisk, deviceTrust, location, requestedAt }`.

The decision output is:

`{ decisionId, policyVersion, effect, permittedFields, maskedFields, obligations, humanApprovalRequired, expiry, reasonCodes, evidenceClass }`.

Missing, malformed, expired, or contradictory inputs deny access. Application routes, background jobs, connectors, exports, search/vector retrieval, notifications, and AI tool calls use the same decision contract. Route-local role checks cannot substitute for it.

## 4. Patient, guardian, proxy, and restriction safety

- Authority is an effective-dated relationship among subject, grantee, legal basis, permitted purposes/operations, record categories, locations, start/end, verification evidence, and revocation.
- Identity verification for patient and proxy is independent of the authority decision.
- A minor’s confidential-care rights are evaluated using the jurisdiction profile; guardian status is not a universal override.
- Revocation is effective immediately for new requests while historical disclosures remain immutable.
- Restrictions and sensitive segmentation apply before data retrieval, including search, notification previews, AI context assembly, and exports.
- Conflicting guardianship, uncertain identity, suspected coercion, or duplicate-person risk enters a human resolution hold.
- Wrong-patient and duplicate-identity events freeze merge/release actions, preserve provenance, notify designated reviewers, and support reversible unmerge.

## 5. Threat, control, evidence, and residual-risk matrix

| Threat | Preventive controls | Detective controls | Recovery controls | Owner / evidence / test | Residual-risk launch rule |
|---|---|---|---|---|---|
| Cross-tenant or wrong-subject access | composite tenant keys, RLS, subject/purpose ABAC, scoped repository | denied-decision and anomalous-access review | revoke session, contain disclosure, incident workflow | Security + Data; policy/version/query evidence; two-tenant and wrong-subject tests | zero known bypasses |
| Wrong-patient selection/unsafe merge | multi-identifier confirmation, duplicate scoring, merge hold | mismatch and post-merge anomaly alerts | reversible unmerge, provenance restoration | Patient identity steward; merge evidence; near-match tests | unresolved ambiguity blocks release |
| Overbroad workforce/admin access | assignment, purpose, minimum projection, privilege check | access-pattern and sensitive-category review | revoke grant, case review, notification | Privacy/Security; decision evidence; actor-operation negatives | no role-only clinical grant |
| Expired/revoked proxy | request-time effective authority check | denied-access and attempted-use review | immediate revocation propagation | Privacy; authority version; expiry/revocation tests | stale access blocks launch |
| Sensitive-record disclosure | executable labels, segmentation, consent/restriction, masked projection | sensitive access/export alerts | containment, patient/legal review | Privacy + Clinical safety; label decision; category tests | unsupported category is deny-all |
| Improper result release | signed/release state, release policy, credentialed approver | premature-release monitoring | retract projection, notify and review without deleting evidence | Clinical safety; signature/release evidence; unreleased-result tests | no unsigned/unreleased portal exposure |
| Urgent message/critical result missed | severity rules, human queue, acknowledgment/SLA/escalation | overdue and delivery-failure alerts | reroute, supervisor escalation, downtime procedure | Clinical operations; timestamps/acknowledgment; timer/failure tests | AI-only closure prohibited |
| PHI model/tool egress | classifier, route allowlist, minimization, BAA/DPA/residency/processor evidence | denied egress log, payload-free telemetry, destination monitoring | kill switch, token revocation, incident/breach assessment | Security/Privacy/AI governance; decision and contract refs; unapproved-route tests | unknown destination denies |
| AI exceeds authority | typed tools, human approval token, consequence classes, output labels | tool-call audit and unsafe-intent review | cancel/revoke proposal, human correction, incident learning | AI governance + clinical/finance owner; proposal/approval evidence; adversarial tests | no independent consequential action |
| Claim submitted incorrectly | coverage/claim validation, credentialed approval, payer profile | rejection/denial/anomaly reconciliation | void/correct/resubmit with lineage | Revenue cycle; submission version; invalid-code and duplicate tests | AI may draft, never submit |
| Break-glass abuse | human-only, declared reason, minimum view, time-boxed grant, step-up authentication | real-time alert and mandatory retrospective review | auto-expiry, revoke, sanction/incident workflow | Privacy/Security; declaration, scope, views, review outcome; expiry/AI-denial tests | missing review capacity blocks launch |
| Unauthorized amendment/deletion | signature locks, append/amend, legal hold, deny delete | integrity/digest and deletion-attempt alerts | restore version, quarantine mismatch | Clinical records + Data; provenance/digest; mutation tests | signed facts never overwritten |
| Ransomware/downtime/integrity loss | least privilege, immutable backups, segregated credentials, downtime package | health, tamper, backup and restore monitoring | minimum-care mode, restore, reconcile, re-sign/release review | Operations/Security/Clinical safety; restore evidence; recovery drill | untested restore blocks launch |
| Breach or processor incident | contracts, minimization, segmentation, incident plan | SIEM/case intake, disclosure accounting | containment, assessment, notices, regulator/contract actions | Privacy/Security/Legal; timeline and notices; tabletop | jurisdiction clocks and owners required |

## 6. Break-glass emergency access

Break-glass is not a privileged bypass. It is a separately evaluated, human-only emergency purpose with:

1. step-up authentication and a declared patient-specific emergency reason;
2. a time-bounded grant, minimum resource set, and minimum fields;
3. prominent on-screen emergency state and prohibition on bulk/export by default;
4. immediate notification to the designated privacy/security channel;
5. immutable evidence for every viewed resource and action;
6. automatic expiry and a mandatory retrospective review with outcome and corrective action.

AI coworkers, service integrations, batch jobs, support operators, and anonymous sessions cannot invoke break-glass. Break-glass never permits deletion, consent falsification, evidence alteration, unrestricted export, or silent result release.

## 7. PHI egress and AI coworker enforcement

### 7.1 Egress gate

Before any model, tool, connector, email/SMS notification, export, search index, analytics job, or support diagnostic receives context, the egress gate determines data class, subject, purpose, destination, processor identity, contract evidence, residency zone, allowed fields, retention, and logging policy. An unrecognized route or missing contract/residency evidence denies before payload assembly.

Audit telemetry records classification, decision ID, destination identity, field categories, byte count, contract/profile references, and outcome—never raw PHI merely to prove that PHI was protected.

### 7.2 AI consequence classes

| Class | Examples | AI authority |
|---|---|---|
| Informational | summarize released instructions, explain bill fields | may respond within approved projection |
| Administrative draft | reminder, intake follow-up, draft scheduling response | may draft/send only through granted channel policy |
| Clinical/financial support draft | note draft, coding suggestion, claim reconciliation suggestion | draft only; credentialed human reviews |
| Consequential | diagnose, triage disposition, sign note/order, release result, submit claim, urgent advice | prohibited without a purpose-built human approval contract; diagnosis and break-glass remain prohibited |
| Authority override | consent/restriction override, proxy grant, legal-hold change, evidence deletion | prohibited |

A human approval is bound to exact proposal digest, subject, action, destination, approver privilege, policy version, and expiry. Editing the proposal invalidates approval. “Human in the loop” is not satisfied by a generic confirmation click.

## 8. Downtime, restoration, and incident response

- Downtime mode exposes a minimal, locally approved care dataset and records all access/actions for later reconciliation.
- New clinical facts captured during downtime preserve author, subject, timestamps, source, and conflict state; recovery never overwrites signed facts.
- Backups are immutable, encrypted, residency-bound, access-controlled, and restored in recurring drills.
- Restoration verifies database, object, index, queue/outbox, audit, signature, and payload-digest consistency.
- Reconciliation produces human queues for identity, appointment, order/result, message, claim, and consent conflicts.
- Incident runbooks identify detection, containment, clinical-safety escalation, disclosure accounting, breach assessment, notification clocks, processor coordination, patient communication, evidence preservation, recovery, and post-incident learning.

## 9. Jurisdiction, contract, network, and certification launch gates

| Profile/gate | Required determination | Evidence | Accountable approval | Launch blocker |
|---|---|---|---|---|
| US HIPAA applicability | covered-entity/business-associate role and safeguards | counsel memo, risk analysis, policies, training | Legal/Privacy/Security | applicability or safeguards unknown |
| US state/special-category overlay | privacy, minor, reproductive/genetic/behavioral/substance-use rules | jurisdiction rules and policy tests | Counsel + Privacy + Clinical safety | unsupported obligations |
| US payer/provider network | licenses, NPI/taxonomy where applicable, credentialing, enrollment, contracts, prior-auth/claim profile | issuer verification, roster, effective dates | Credentialing/Revenue cycle | inactive credential/enrollment |
| EU GDPR role | controller/processor/joint-controller, legal basis, DPIA need, rights workflow | DPA/DPIA/ROPA/processor records | DPO/Legal/Security | role/legal basis/processor unknown |
| EU EHDS/member state | applicable EHR/interoperability, access, logging, certification and national requirements | conformance profile and authority evidence | Legal/Clinical/Data/Enterprise Architecture | required conformance unavailable |
| Public/private funding | entitlement, referral/authorization, coding, reimbursement and patient-pay rules | funder profile and test cases | Revenue cycle/Finance | unreconciled workflow |
| Residency/cross-border | row/blob/backup/index/log/inference zones and transfer basis | residency map, contract/safeguard, export tests | Privacy/Security/Operations | implicit or unsupported transfer |
| Processor/model/tool | BAA/DPA, subprocessors, retention/training, deletion, incident terms | signed contract and technical route profile | Legal/Security/AI governance | unapproved processor |
| Clinical safety | hazard log, escalation, release, downtime, human authority | verification cases and clinical sign-off | Clinical safety officer | unmitigated serious hazard |
| Security readiness | threat controls, vulnerability findings, recovery and incident drills | control evidence and residual-risk register | Security owner | critical finding or untested recovery |

Profiles configure obligations and policy inputs; they do not fork the core patient/clinical schema. A profile may be active only for supported locations, service lines, practitioners, payers/funders, processors, and integration endpoints.

## 10. Canonical implementation allocation

| Contract | Existing authority extended | Healthcare implementation boundary |
|---|---|---|
| Actor/service identity | Principal, EmployeeProfile, agent/service grants | patient/proxy/practitioner relationships and scoped service principals |
| Policy decision | Policy/PolicyRule and authorization evidence | versioned healthcare context/output contract |
| Clinical sensitivity | document/data classifications | executable labels on records, projections, search and egress |
| Consequential action | action proposal/human approval patterns | exact-digest clinical/financial approval tokens |
| Audit/disclosure | existing audit/evidence authorities | immutable access, deny, release, export, break-glass and disclosure events |
| Jurisdiction/compliance | compliance-control and sovereignty profiles | US/EU/member-state/payer/network launch gates |
| Incident/attention | notification, case and attention patterns | urgent-result/message, breach and retrospective-review queues |

The Prisma-to-EA mirror must allocate these contracts, actors, trust boundaries, evidence flows, and verification cases before implementation. Enforcement belongs in policy/repository/tool boundaries, not only in UI copy or prompts.

## 11. Verification cases

| ID | Case |
|---|---|
| HC-SEC-01 | Every actor, including platform admin and AI, is denied cross-tenant and wrong-subject view/create/amend/release/export/delete. |
| HC-SEC-02 | Receptionist confirms appointment readiness without retrieving clinical narrative or results. |
| HC-SEC-03 | Billing submits no claim without a credentialed human approval bound to the exact claim version. |
| HC-SEC-04 | Revoked/expired proxy immediately loses access while historical disclosure evidence remains. |
| HC-SEC-05 | Minor confidentiality and guardian access change with jurisdiction policy and record category. |
| HC-SEC-06 | Sensitive categories are absent from general search, notification preview, AI context, and broad care-team projection. |
| HC-SEC-07 | Unsigned/unreleased results never appear in patient/proxy projections. |
| HC-SEC-08 | An urgent message cannot be closed by AI and escalates after acknowledgment/delivery failure. |
| HC-SEC-09 | Unapproved model/tool/processor route is denied before PHI payload assembly; evidence contains no raw PHI. |
| HC-SEC-10 | AI cannot diagnose, independently triage, sign, release, submit, override consent, delete, or break glass. |
| HC-SEC-11 | Human approval fails after proposal content, subject, destination, policy version, or expiry changes. |
| HC-SEC-12 | Break-glass requires human step-up/reason/scope, expires, notifies, and creates retrospective review work. |
| HC-SEC-13 | Duplicate/wrong-patient risk freezes merge/release and supports evidence-preserving unmerge. |
| HC-SEC-14 | Downtime restoration reconciles writes without overwriting signed facts or losing provenance. |
| HC-SEC-15 | Backup restore verifies rows, blobs, indexes, outbox, signatures, audit and payload digests. |
| HC-SEC-16 | Jurisdiction profile change alters obligations and launch gates without changing the core schema. |
| HC-SEC-17 | Cross-border transfer without legal basis, processor contract, residency/destination and minimum-necessary evidence is denied. |
| HC-SEC-18 | Incident tabletop proves accountable owners, clinical escalation, evidence preservation and notification clocks. |

## 12. Review and evidence requirements

Before patient-data implementation begins, Security, Privacy/DPO, Clinical Safety, Enterprise Architecture, and Data Architecture must review:

- the four linked matrices and canonical allocation;
- all HC-SEC verification cases and residual risks;
- jurisdiction, processor, provider-network and certification launch evidence;
- break-glass, urgent-message, downtime/recovery and incident procedures;
- deterministic authorization, egress, AI proposal and human-approval contracts;
- retention/legal-hold and immutable evidence design.

Each control records accountable owner, policy/control version, implementation location, evidence source, test method/frequency, latest result, exception/expiry, residual risk, and launch decision.

## 13. Standards boundary

Implementation profiles the applicable standards and authoritative guidance:

- [HHS HIPAA Security Rule](https://www.hhs.gov/hipaa/for-professionals/security/index.html), minimum necessary, and applicable OCR audit guidance.
- [NIST Cybersecurity Framework 2.0](https://www.nist.gov/cyberframework) and [NIST SP 800-207 Zero Trust Architecture](https://csrc.nist.gov/publications/detail/sp/800-207/final).
- [HL7 FHIR](https://hl7.org/fhir/) Consent, Provenance, AuditEvent, security labels, and relevant implementation guides.
- [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj) and [European Health Data Space Regulation (EU) 2025/327](https://eur-lex.europa.eu/eli/reg/2025/327/oj), with member-state requirements.

These references do not replace counsel, regulator, payer/funder, professional-board, clinical-safety, or certification determinations for a specific launch.
