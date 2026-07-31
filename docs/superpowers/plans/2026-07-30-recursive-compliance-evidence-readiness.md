# Recursive Compliance Evidence Readiness Implementation Plan

**Backlog item:** `BI-734BEF5B`
**Epic:** `EP-CF64D652` — Recursive Compliance Assurance
**Governed architecture decision:** `DI-E86653E6475C`
**Status:** Planned
**Scope:** DPF's own organization, every DPF install, and every self-authored change
**Frameworks:** ISO/IEC 27001:2022, SOC 2 Trust Services Criteria, and HIPAA when applicable

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## 1. Outcome

DPF must be able to answer an auditor, customer, regulator, operator, or internal
reviewer with more than a history of decisions:

1. Which criterion applies, to whom, to which system, for which period?
2. Which control is intended to satisfy it?
3. Who owns and approves that control?
4. What procedure or technical mechanism implements it?
5. How was design adequacy assessed?
6. How was operating effectiveness tested over the requested period?
7. What exact, integrity-verifiable evidence supports the result?
8. What exceptions, failures, and corrective actions remain?
9. Which parts are DPF's responsibility and which are the install operator's?
10. Can an independent reviewer reproduce the answer without trusting DPF's prose?

The delivered system is an evidence-backed readiness and assurance system. It
does not self-issue ISO certification, a SOC 2 report, or a universal HIPAA
compliance declaration.

## 2. Architectural rule

Extend the two existing canonical spines:

```text
Regulation -> Obligation -> Control -> ComplianceEvidence

WorkCapsule -> FeatureBuild -> AssuranceRun / RuntimeVerification
            -> exact artifact -> deployment -> runtime observation
```

Do not create a second compliance database, second build pipeline, or
healthcare-only evidence engine. Add the missing typed relationships between the
spines and use DPF's own organization as the first recursive consumer.

The compliance system is inside its own scope. A change to framework mappings,
applicability, evidence collection, evidence validation, authorization,
retention, control tests, gate policy, or readiness calculations must pass the
same impact, evidence, review, deployment, and reassessment lifecycle it
enforces on other changes.

## 3. Evidence claim contract

A decision record, activity log, screenshot, or test output is only a source
record. It becomes compliance evidence only when it satisfies this contract:

| Field | Required meaning | Fail-closed behavior |
|---|---|---|
| Framework criterion | Stable framework, version, criterion/reference, and authoritative source | Unknown version or reference cannot support a claim |
| Applicability | Organization, install, product/service, jurisdiction, role, data class, and rationale | Undeclared scope is `assessment-required`, never pass |
| Responsibility | DPF, install operator, shared, supplier, or external assessor responsibility | An unowned responsibility is a gap |
| Control | Canonical `Control.catalogKey`, implementation statement, owner, reviewer, cadence | A title-only or duplicated control cannot satisfy the criterion |
| Test | Test objective, method, population/sample, expected result, frequency, and independence requirement | An undocumented test is not operating-effectiveness evidence |
| Period | `validFrom`, `validTo`/cutoff, collected time, and freshness rule | Point-in-time evidence cannot imply period coverage |
| Subject | Real foreign-key-backed organization, install, product, build, release, deployment, or control subject | An unresolved polymorphic reference is rejected |
| Provenance | Collector, collector version, policy version, source record, exact source tree/artifact digest, environment, and deployment | Mutable or mismatched provenance is rejected |
| Integrity | Digest/signature/receipt and verification result | Failed or unavailable integrity verification is a finding |
| Result | Pass, fail, partial, not-tested, collector-error, not-applicable, or accepted exception | Collector error is never converted to pass |
| Review | Reviewer, authority, independence requirement, review time, and decision | AI generation alone cannot approve effectiveness |
| Exception | Risk owner, rationale, compensating controls, expiry, and approval | Expired or unapproved exception becomes a failure |
| Retention | Evidence class, legal/contractual basis, retention rule, and disposal/hold state | Evidence cannot be purged while required or on hold |

`ComplianceEvidence` is the durable compliance projection. The originating
records remain canonical for their own domains and are referenced, not copied
as untraceable narrative.

## 4. Claim status vocabulary

Every compliance surface and export must use the same states:

- `applicability-required`
- `not-applicable-approved`
- `applicable-unimplemented`
- `implemented-not-assessed`
- `design-effective`
- `operating-effective`
- `partially-effective`
- `ineffective`
- `evidence-stale`
- `collector-error`
- `exception-active`
- `exception-expired`

An overall posture is a projection of these states. It is not a generic
"compliance percentage." Every posture must name its scope, framework version,
assessment period, evidence cutoff, and unresolved qualifications.

## 5. Framework evidence outputs

### ISO/IEC 27001

The evidence package must include at minimum:

- ISMS scope and interested-party/context records;
- information-security policy and assigned responsibilities;
- risk methodology, risk assessment, and risk-treatment plan;
- Statement of Applicability with inclusion/exclusion rationale and status;
- objectives and measurement results;
- competence, awareness, communications, and controlled-document evidence;
- operational control evidence;
- monitoring, internal audit, management review, nonconformities, and corrective actions;
- Annex A control mappings and evidence as selected by the risk treatment.

Certification remains the authority of an accredited certification body.

### SOC 2

The evidence package must include at minimum:

- system description, boundaries, services, commitments, and subservice organizations;
- applicable Trust Services Categories and criteria;
- management assertions and control descriptions;
- control ownership, frequency, population, samples, exceptions, and remediation;
- evidence of operating effectiveness across the examination period;
- complementary user-entity controls and shared-responsibility statements;
- significant incidents and changes during the period.

The SOC 2 examination and report remain the authority of an independent CPA
firm. The platform may report readiness, not that it has issued or passed its
own SOC 2.

### HIPAA

When the organization is a covered entity or business associate and the scope
creates, receives, maintains, or transmits ePHI, the evidence package must
include at minimum:

- applicability and covered-entity/business-associate role determination;
- current security risk analysis and risk-management actions;
- assigned security responsibility;
- workforce authorization, termination, training, and sanction evidence;
- information-access management and minimum-necessary controls;
- security incident and breach procedures and exercises;
- contingency, backup, restoration, and emergency-mode evidence;
- evaluation records and business-associate/subcontractor agreements;
- facility/device/media controls where they fall inside the deployment scope;
- technical access, audit, integrity, authentication, and transmission controls;
- required Security Rule documentation retention.

HIPAA documentation retention must remain distinct from medical-record
retention. The platform does not expose a universal "HIPAA compliant" switch.

## 6. Delivery graph

| Order | Deliverable | BI | Depends on | Independently shippable |
|---|---|---|---|---|
| 1 | Scope, responsibility, and framework crosswalks | `BI-421DADF5` | — | Yes |
| 2 | Control tests, assessments, and evidence provenance | `BI-2B626F20` | 1 | Yes |
| 3A | Recursive change-impact and evidence gates | `BI-53829B94` | 2 | Yes |
| 3B | Continuous control evidence and drift detection | `BI-51110EA2` | 2 | Yes |
| 3C | DPF organizational compliance operating program | `BI-44B160F5` | 1, 2 | Yes |
| 4 | Readiness UI and auditor evidence packages | `BI-8455D0D3` | 1, 2, 3B | Yes |
| 5 | Conformance drills and external-assessment gate | `BI-7B642587` | 3A, 3B, 3C, 4 | Yes |

`3A`, `3B`, and `3C` may proceed in parallel after the evidence contracts land.

## 7. Phase 1 — scope, responsibility, and framework crosswalks

**Backlog item:** `BI-421DADF5`

### Deliverables

1. Define typed framework/version, scope, applicability, responsibility, and
   disposition contracts.
2. Version the ISO 27001, SOC 2, and HIPAA obligation packs with authoritative
   citations and controlled interpretations.
3. Use `Control.catalogKey` for common controls so one implementation can cover
   several framework obligations.
4. Represent hosted, self-hosted, DPF-supplied, operator-supplied, shared,
   supplier, and independent-assessor responsibilities.
5. Add claim guardrails: `certified`, `SOC 2 report`, and `HIPAA compliant`
   require the appropriate external artifact and scope.
6. Route proposed mapping changes through `ComplianceProposal` and an
   authorized human approval.

### Expected implementation areas

- `packages/db/prisma/schema.prisma`
- `apps/web/lib/compliance-types.ts`
- `apps/web/lib/compliance-library.ts`
- `apps/web/lib/compliance-control-coverage.ts`
- `apps/web/lib/compliance-regulation-version.ts`
- `apps/web/lib/compliance-proposal.ts`
- `apps/web/lib/govern/data-processing-activity-service.ts`
- `apps/web/components/compliance/OnboardingWizard.tsx`
- `apps/web/app/(shell)/compliance/onboard/page.tsx`
- framework data under the existing compliance/GRC content owner selected during implementation

### Verification

- A single common control maps to ISO, SOC 2, and HIPAA obligations without
  duplicate implementation rows.
- Missing organization or install scope yields `applicability-required`.
- A self-hosted installation separates DPF product evidence from
  operator-host evidence.
- HIPAA is not activated from industry name alone.
- An AI-authored mapping remains a proposal until authorized approval.
- Unsupported marketing or readiness claims are rejected.

## 8. Phase 2 — control tests, assessments, and evidence provenance

**Backlog item:** `BI-2B626F20`

### Deliverables

1. Add explicit scope/applicability bindings using referentially sound
   relationships for organization, install, digital product, build, release,
   and deployment subjects.
2. Add control-test definitions with objective, method, expected result,
   cadence, sampling/population rule, evidence requirements, and reviewer
   independence.
3. Add time-bounded control assessments distinct from the mutable
   `Control.effectiveness` summary.
4. Extend `ComplianceEvidence` provenance to source records including
   `AssuranceRun`, `RuntimeVerification`, `ToolExecutionReceipt`, exact-tree
   receipt, release/deployment, and artifact digest.
5. Define evidence freshness, supersession, integrity verification, exception,
   risk acceptance, and compensating-control contracts.
6. Keep source-domain facts in their existing records; store references and
   normalized compliance assertions in the evidence ledger.
7. Add database and service invariants preventing evidence mutation from
   rewriting history.

### Expected implementation areas

- `packages/db/prisma/schema.prisma`
- a fleet-safe migration under `packages/db/prisma/migrations/`
- `apps/web/lib/governance/compliance-evidence.ts`
- `apps/web/lib/assurance/with-assurance-run.ts`
- `apps/web/lib/assurance/assurance-evidence.ts`
- `apps/web/lib/compliance/compliance-core.ts`
- `apps/web/lib/actions/compliance.ts`
- `apps/web/lib/mcp/packs/build-evidence-pack.ts`
- exact-tree receipt interfaces introduced by PR `#3797`

### Verification

Use conformance fixtures for:

- valid evidence;
- missing evidence;
- stale evidence;
- wrong framework version;
- wrong organization/install/build;
- tree or artifact digest mismatch;
- unverifiable integrity receipt;
- superseded evidence;
- collector failure;
- expired exception;
- AI-produced evidence requiring independent review.

The migration must apply to populated legacy installs without wedging the
forward-only chain. Existing evidence is classified as legacy/unverified until
it earns the new provenance contract; it is not silently upgraded to strong
evidence.

## 9. Phase 3A — recursive change-impact and promotion gates

**Backlog item:** `BI-53829B94`

### Deliverables

1. Classify every Work Capsule/FeatureBuild for affected controls using:
   - declared scope claims;
   - changed routes and exported symbols;
   - Prisma/schema and migration impact;
   - data classification and processing activities;
   - identity, authorization, audit, retention, provider, dependency,
     deployment, backup, and network impact;
   - framework/control-plane file ownership.
2. Record an attributable affected-control set or reviewed no-impact
   declaration.
3. Derive an evidence manifest from the applicable controls and change class.
4. Block release/promotion when required evidence is absent, stale, failed, or
   bound to a different tree/artifact/environment.
5. Require independent review for compliance-control-plane changes.
6. Prevent changes to the classifier, evidence validator, or gate policy from
   using their new behavior to approve themselves.
7. Preserve the prior valid gate/collector policy for evaluating the change,
   then reassess under the new policy after governed deployment.

### Expected implementation areas

- `WorkCapsule.scopeClaims` and `verificationState` contracts
- `FeatureBuild` assurance and release relations in `packages/db/prisma/schema.prisma`
- `apps/web/lib/build/release-decision.ts`
- `apps/web/lib/actions/build-release.ts`
- `apps/web/lib/assurance/diff-security-adapter.ts`
- `apps/web/lib/mcp/packs/build-evidence-pack.ts`
- `apps/web/lib/mcp/packs/release-pack.ts`
- code-graph impact and CI policy adapters
- exact-tree evidence receipt discovery and verification

### Verification

- A routine documentation change records a justified no-control-impact result.
- A migration touching PHI or audit data selects the relevant privacy,
  integrity, retention, backup, and change controls.
- A control-mapping change cannot approve itself.
- A collector change is evaluated with the previous trusted collector/policy.
- A deliberately omitted required test blocks release.
- All coding surfaces produce the same gate result for the same exact tree.
- Rollback restores the prior valid policy and evidence interpretation.

## 10. Phase 3B — continuous controls and drift

**Backlog item:** `BI-51110EA2`

### Deliverables

1. Introduce a registry of continuous and periodic control-test adapters.
2. Implement adapters or evidence bridges for:
   - identity/MFA/access and periodic access review;
   - authorization and strongly typed audit events;
   - tamper-evident audit verification and export;
   - vulnerability, dependency, SBOM, and remediation SLA;
   - backup, off-host copy, restoration, recovery, and migration preflight;
   - encryption and key-management posture;
   - provider trust, BAA/subprocessor evidence, and expiry;
   - incident/breach response and exercises;
   - training, policy acknowledgement, and workforce lifecycle;
   - retention, legal hold, and defensible disposal;
   - deployment, observability, and runtime health.
3. Distinguish `collector-error` from control failure.
4. Reconcile stable findings instead of opening duplicates on every run.
5. Track evidence coverage across an assessment period, not only the latest
   result.
6. Escalate stale evidence, missed cadence, expired exceptions, and runtime
   drift into attention and corrective-action workflows.

### Existing work to consume

- `BI-DG-010` — tamper-evident audit
- `BI-0859F45E` — identity/authority audit-event taxonomy
- `BI-7B72F7B5` — access review/certification
- `BI-7009EE55` — audit search, retention, export, and SIEM streaming
- `BI-903F5A94` — sole-platform operational readiness evidence
- `EP-ASSURANCE-LEDGER`
- `EP-FULL-OBS`
- `EP-DR-HARDENING-2026-05-23`
- `EP-DATA-RETENTION`
- `EP-COMPANY-IAM-FOUNDATION`
- `EP-IAM-ADMIN-PORTAL-AUDIT`

### Verification

- A disabled collector becomes visible as `collector-error`.
- A failed backup or restore exercise creates a stable finding and invalidates
  the affected readiness claim.
- Revoked/expired provider trust or BAA evidence invalidates HIPAA-eligible
  routing readiness.
- Access-review evidence covers the defined population and review period.
- Historical assessment-period evidence remains reproducible after later runs.
- A corrected control closes or supersedes the finding without erasing history.

## 11. Phase 3C — DPF organizational operating program

**Backlog item:** `BI-44B160F5`

This is not primarily a software deliverable. It is the recurring organizational
control system whose records DPF projects into its own compliance scope.

### Deliverables

1. Approve DPF's ISMS/service/HIPAA applicability scopes and responsibility
   matrix.
2. Assign accountable owners and independent reviewers.
3. Establish risk assessment and treatment, Statement of Applicability,
   security objectives, policy lifecycle, supplier review, access review,
   training, incident/breach, continuity, backup/restore, vulnerability,
   internal audit, management review, and corrective-action cadences.
4. Establish evidence retention and legal-hold rules by evidence class.
5. Maintain vendor/subprocessor inventory, due diligence, contracts, DPAs, BAAs,
   security attestations, expiry, and review outcomes.
6. Create approved procedures and exercise scripts.
7. Run the first full cycle and record deficiencies honestly.

### Verification

- Each process has an owner, cadence, procedure, inputs, required evidence,
  escalation, missed-control behavior, and retention rule.
- One risk can trace through treatment, controls, test results, evidence,
  residual risk, and management acceptance.
- One employee lifecycle sample traces authorization, training, access review,
  and termination/revocation.
- One supplier sample traces due diligence, contract/BAA, services/data,
  monitoring, renewal, and offboarding.
- Internal audit and management review produce findings and corrective actions,
  not a blanket pass.

## 12. Phase 4 — readiness UI and on-demand evidence packages

**Backlog item:** `BI-8455D0D3`

### Deliverables

1. Replace simplistic posture scoring with the canonical claim states.
2. Provide views by framework, scope, criterion, control, owner, assessment
   period, freshness, exception, and finding.
3. Add drill-through from criterion to obligation, control, implementation,
   test, evidence, exact artifact/source, reviewer, and corrective action.
4. Generate deterministic evidence packages with:
   - package id and generation policy version;
   - scope/framework/period/cutoff manifest;
   - criteria and control matrix;
   - implementation and test descriptions;
   - evidence index and selected samples;
   - exceptions, findings, and corrective actions;
   - shared-responsibility and complementary user controls;
   - artifact digests and package manifest signature/hash.
5. Add time-bounded, read-only, scoped, revocable auditor access.
6. Redact secrets, PHI, personal data, and unrelated tenant/install information
   while preserving verification metadata.

### Expected implementation areas

- `apps/web/app/(shell)/compliance/posture/`
- `apps/web/app/(shell)/compliance/evidence/`
- `apps/web/app/(shell)/compliance/audits/`
- `apps/web/app/(shell)/compliance/gaps/page.tsx`
- new audit-preparation/package surface under `/compliance`
- `apps/web/lib/security/compliance.ts` or its replacement projection
- report-kit and document/export primitives
- `docs/user-guide/compliance/`

### Verification

Exercise four journeys against the running app:

1. Operator confirms applicability and sees owner-readable gaps.
2. Control owner investigates stale evidence and completes remediation.
3. Compliance owner generates and regenerates an identical package.
4. External auditor receives restricted access, verifies a sample, and has
   access revoked.

Package verification must detect any modified artifact or manifest entry.
Accessibility, responsive layout, empty/error/loading states, and large control
sets are part of the UX gate.

## 13. Phase 5 — recursive conformance drills and external gate

**Backlog item:** `BI-7B642587`

### Deliverables

1. Publish assertion matrices for the supported framework profiles:
   criterion → applicability → control → test → evidence → expected result.
2. Build executable fixtures for pass, fail, stale, forged, scope mismatch,
   collector outage, exception expiry, and incomplete-period coverage.
3. Run representative topology drills:
   - DPF organization/hosted service;
   - self-hosted install with shared responsibilities;
   - HIPAA-enabled business-associate or covered-entity scenario;
   - non-HIPAA healthcare-adjacent scenario;
   - compliance-engine self-modification.
4. Conduct an evidence-request dry run with an independent reviewer who did not
   build the feature.
5. Record all failures as findings/corrective actions and rerun after closure.
6. Define the external-engagement gates:
   - ISO internal audit and management review complete before certification body;
   - SOC 2 readiness and evidence-period completeness before CPA examination;
   - HIPAA risk analysis, legal role determination, safeguards, BAAs, and
     exercise evidence before regulated claims.

### Completion test

Select a change to the compliance engine itself and demonstrate this unbroken
chain:

```text
request
-> scope and affected controls
-> approved plan/design
-> exact source tree and build
-> required test evidence
-> independent review
-> governed deployment
-> runtime control verification
-> updated assessment-period evidence
-> reproducible auditor package
-> integrity verification by an independent reader
```

If any link depends on chat history, mutable prose, an unverified screenshot, or
tribal knowledge, the program is not complete.

## 14. Security and privacy requirements

- Least privilege and organization/install isolation apply to every evidence
  query and export.
- Evidence collectors receive only the scopes needed for their test.
- Evidence packages never contain secrets or raw credentials.
- PHI and personal data are minimized; where proof can use metadata, digests,
  counts, or redacted samples, it must.
- Auditor access is time-bounded, read-only, logged, revocable, and cannot be
  reused across scopes.
- Evidence encryption, signing/hashing, key custody, rotation, recovery, and
  verification procedures are explicitly tested.
- Evidence deletion honors retention, legal hold, investigation, and
  supersession rules.
- Export generation is an outbound consequential action and requires explicit
  authorization plus an immutable audit receipt.

## 15. Migration and compatibility strategy

Use expand → backfill/classify → consume → tighten:

1. Add nullable/loose relationships and status fields.
2. Classify legacy evidence as legacy/unverified, preserving every row.
3. Backfill relationships only where provenance is deterministic.
4. Start writing the new contracts while old readers remain compatible.
5. Move readiness and gate consumers to the new contracts.
6. Tighten required relationships only after fleet evidence proves safety.

No migration may infer strong provenance from a title, description, filename,
or timestamp. Uncertain legacy records remain review-required.

## 16. Risks and rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| False assurance from weak evidence | Fail closed; conformance fixtures; independent review | Revert consumer to `not-assessed`, preserve evidence |
| Gate blocks unrelated work | Shadow mode, explainable manifest, stable bypass/risk process | Disable new consumer behind governed policy; keep prior gate |
| Compliance engine approves its own change | Previous-policy evaluation and reviewer separation | Restore last trusted policy/collector and reassess |
| Duplicated framework controls | `catalogKey` crosswalk and migration reconciliation | Retire duplicate mapping; preserve lineage |
| Legacy evidence is overstated | Explicit legacy/unverified classification | Remove it from satisfaction calculations |
| Auditor export leaks protected data | Scoped projection, redaction, package preview, access receipt | Revoke package/access and record incident |
| Collector outage appears as compliance failure or pass | Separate `collector-error` state | Rerun after collector repair; do not rewrite history |
| Copyright/licensing issue in framework packs | Store citations, identifiers, licensed interpretations, not copied standard text | Remove affected content pack without deleting organization evidence |
| Customer assumes product evidence covers host controls | Shared-responsibility matrix and complementary user controls | Withdraw claim and regenerate scoped package |

## 17. Program completion gate

The umbrella BI may close only when:

- all seven mapped BIs are done or explicitly superseded with equivalent evidence;
- open critical/high control deficiencies have no silent waiver;
- DPF's own scoped evidence cycle has run for the required assessment period;
- the recursive self-modification drill passes;
- one hosted and one self-hosted shared-responsibility package pass independent review;
- HIPAA behavior is tested for both applicable and non-applicable scopes;
- package integrity and redaction tests pass;
- user, operations, architecture, security, and external-agent documentation is current;
- the relevant unit tests, production build, migrations, runtime UX verification,
  and live/sandbox evidence gates pass;
- external certification/examination/readiness status is represented accurately.

## 18. Documentation impact

Each implementation BI must update the appropriate sources:

- `docs/user-guide/compliance/` — operator workflows and evidence interpretation;
- `docs/user-guide/security/` — security-control operation;
- `docs/architecture/` — compliance/evidence architecture and responsibility model;
- `docs/testing/ci-evidence.md` — exact-tree and release evidence behavior;
- `docs/operations/` — organizational and install operating procedures;
- public pre-install material — precise certification/readiness claims;
- `AGENTS.md` only for durable contributor doctrine such as recursive
  compliance-impact handling.

## Backlog coverage

- Decision: decomposed
- Parent: `BI-734BEF5B`
- Receipt: `cms8cran40bdd01qo7fd16ois`
- Rationale: Framework scope, evidence contracts, recursive change gates, continuous controls, organizational operations, auditor packages, and conformance drills are independently shippable capabilities with explicit sequencing dependencies.
- Dependencies: evidence contracts depend on scope/crosswalks; recursive change gates and continuous controls depend on evidence contracts; organizational operations depend on scope/crosswalks and evidence contracts; auditor packages depend on scope/crosswalks, evidence contracts, and continuous controls; conformance drills depend on recursive gates, continuous controls, organizational operations, and auditor packages.
- Authoritative compliance scope, responsibility, and framework crosswalks -> `BI-421DADF5`
- Control test, assessment, and immutable evidence provenance contracts -> `BI-2B626F20`
- Recursive control-impact and evidence gates on every self-authored change -> `BI-53829B94`
- Continuous control evidence and compliance drift detection -> `BI-51110EA2`
- Auditor-grade readiness views and on-demand evidence packages -> `BI-8455D0D3`
- DPF organizational ISMS, SOC 2, and HIPAA evidence program -> `BI-44B160F5`
- Recursive compliance conformance drills and external-assessment readiness gates -> `BI-7B642587`

Before implementation or resumption, revalidate this receipt through
`check_plan_backlog_coverage`. If the mapping is stale or a mapped BI is retired,
update live backlog coverage before changing source.
