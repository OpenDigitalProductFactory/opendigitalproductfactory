# Trustworthy AI Agent Standards Family — External Standards Alignment

## Abstract

This document defines the external-standards alignment model for the Trusted AI Kernel (`TAK`),
Global AI Agent Identification and Governance (`GAID`), and Job-Specific Intelligence
(`TAK-JSI`) standards family.

The standards family does not replace organization-level AI governance, model evaluation,
identity and authorization protocols, credential formats, software testing, or conformity
assessment. It composes those bodies of work around an operational assurance subject that is not
consistently represented elsewhere: an enduring AI agent identity operating through a materially
versioned configuration, qualified for a bounded job and constrained at runtime by live authority,
data, oversight, and evidence controls.

The principal augmentation is the end-to-end assurance chain:

```text
enduring agent identity
  -> versioned operating profile
  -> job- and context-specific qualification
  -> runtime authority and autonomy enforcement
  -> attributable action evidence
  -> surveillance, drift detection, and revalidation
```

This document is informative. Normative requirements remain in the three canonical standards.

## 1. Scope

This document:

- identifies the standards and active standards-development work most relevant to the family
- states whether each external work is adopted, profiled, augmented, or merely adjacent
- identifies the specific gap filled by `TAK`, `GAID`, or `TAK-JSI`
- prevents the family from redefining protocols or conformity models that already have
  authoritative owners
- provides a standards-body contribution map for future liaison, incubation, and formal proposals
- establishes terminology for implementation statements and cross-standard conformance claims

This document does not:

- confer endorsement by any cited standards body
- claim conformance to an external standard without the evidence that standard requires
- turn an active draft, community-group report, or project authorization request into a published
  consensus standard
- define a new credential transport, cryptographic primitive, directory protocol, occupational
  taxonomy, or certification-body accreditation model

## 2. Alignment Vocabulary

The following relationship terms are used throughout this document:

| Relationship | Meaning |
|---|---|
| `adopts` | Uses an external standard directly for the control or artifact it already defines |
| `profiles` | Narrows or composes an external standard for an AI-agent-specific use without changing the external standard's core semantics |
| `augments` | Defines an additional control or lifecycle relationship that the external work does not presently specify |
| `maps-to` | Provides a declared correspondence without asserting semantic identity or conformance |
| `adjacent` | Addresses a related layer but is neither replaced nor normatively extended by this family |
| `out-of-scope` | Must remain with the cited external authority and must not be redefined here |

An implementation statement should not use `conforms to`, `certified to`, or an equivalent claim
for an external standard when the implementation has only mapped to or profiled part of that
standard.

## 3. Layered Standards Architecture

The family occupies a composition layer between broad governance and protocol implementation:

| Layer | Primary external work | Family relationship |
|---|---|---|
| Organization governance and risk | ISO/IEC 42001, ISO/IEC 23894, ISO/IEC 42005, NIST AI RMF | `TAK` and `TAK-JSI` operationalize selected controls for identified agent operating profiles; they do not replace the management system or impact assessment |
| AI quality, testing, and data | ISO/IEC 25059, ISO/IEC TS 42119-2, ISO/IEC 42119-3, ISO/IEC 5259 series | `TAK-JSI` composes quality, test, and data evidence into a job-specific qualification decision and continuing-validity lifecycle |
| Agentic-AI framework | IEEE P3709 and related IEEE agentic-AI projects | `TAK` supplies concrete runtime control, evidence, proactivity, and earned-autonomy requirements suitable for framework clauses and conformance profiles |
| Identity, authentication, and delegation | W3C agent identity work, IETF WIMSE, OAuth, GNAP, SPIFFE, OpenID AIIM | `GAID` profiles established identifiers and credentials while adding subject/operating-state separation, assurance claims, and qualification lifecycle semantics |
| Credentials and badges | W3C Verifiable Credentials, 1EdTech Open Badges | `GAID` profiles credential envelopes for AI-agent claims; it does not define new cryptography or a competing badge transport |
| Conformity assessment | ISO/IEC SC 42 JWG 6, ISO/IEC 42006, ISO/IEC 17065, ISO/IEC 17067 | `TAK-JSI` defines the candidate specified requirements and qualification lifecycle for an AI agent operating profile; accredited assessment remains with recognized conformity-assessment schemes |
| Runtime interoperability | MCP, A2A, HTTP, W3C Trace Context, RFC 9421 | `TAK` and `GAID` define governance semantics carried across these protocols rather than redefining the protocols |
| Security and threat knowledge | OWASP Agentic Top 10, MITRE ATLAS, CSA MAESTRO, CoSAI | `TAK` maps threats to runtime controls and evaluation cases; threat catalogs remain externally owned |

## 4. NIST Alignment

### 4.1 NIST AI Risk Management Framework

The [NIST AI RMF 1.0](https://doi.org/10.6028/NIST.AI.100-1) provides the broad
`GOVERN`, `MAP`, `MEASURE`, and `MANAGE` risk functions.

The family:

- `maps-to` `GOVERN` through accountable issuers, owners, data stewards, qualification authorities,
  and runtime policy ownership
- `maps-to` `MAP` through the `TAK-JSI` job, activity, stakeholder, data, deployment, and harm context
- `maps-to` `MEASURE` through qualification plans, representative evaluations, uncertainty,
  evidence provenance, operational surveillance, and regression detection
- `maps-to` `MANAGE` through `TAK` action gates, autonomy ceilings, escalation, suspension,
  revocation, and revalidation
- `augments` the framework by binding those activities to a stable agent identity and a specific,
  fingerprinted operating profile

An AI RMF implementation is organization- and system-oriented. A `TAK-JSI` qualification is
deliberately narrower: it answers whether one identified operating profile has demonstrated
fitness for one declared job and context.

### 4.2 NIST AI Agent Standards Initiative

The [NIST AI Agent Standards Initiative](https://www.nist.gov/artificial-intelligence/ai-agent-standards-initiative)
organizes current U.S. work around industry-led standards, community protocols, agent identity,
and security evaluation.

The family supplies candidate material for the initiative's stated gap-analysis and measurement
work:

- `TAK`: testable runtime requirements for authority, tools, data, oversight, delegation, evidence,
  and autonomous operation
- `GAID`: requirements for identity continuity, operating-profile binding, claim status, and
  attributable receipts
- `TAK-JSI`: comparable evaluation without reducing fitness to a model-wide or context-free
  benchmark score

NIST engagement is treated as pre-standardization, measurement, and implementation-validation
work. Formal consensus text is expected to progress through the relevant standards-development
organization.

## 5. ISO/IEC Alignment

### 5.1 ISO/IEC JTC 1/SC 42

[ISO/IEC JTC 1/SC 42](https://www.iso.org/committee/6794475.html) is the horizontal ISO/IEC
committee for artificial intelligence. The relevant work allocation is:

| SC 42 group | Family contribution |
|---|---|
| WG 2 — Data | `TAK-JSI` data eligibility, quality, provenance, stewardship, evaluation-dataset, and change-control requirements |
| WG 3 — Trustworthiness | `TAK` runtime governance, human oversight, evidence, autonomy regression, and material-change controls |
| WG 4 — Use cases and applications | Cross-sector job qualification use cases demonstrating why model-level benchmarks are insufficient |
| JWG 2 with SC 7 | Operating-profile lifecycle, configuration identification, validation continuity, software testing, and change impact |
| JWG 6 with ISO/CASCO | Conformity-assessment schemes for versioned AI agent operating profiles |

The family is not proposed as a replacement for SC 42's horizontal corpus. It is a compositional
profile and potential new-work contribution spanning trustworthiness, testing, lifecycle, data,
and conformity assessment.

### 5.2 Management, Risk, Impact, and Oversight

| Reference | Synergy | Family augmentation |
|---|---|---|
| [ISO/IEC 42001:2023](https://www.iso.org/standard/42001) | AI management-system policy, roles, objectives, controls, monitoring, and improvement | Binds applicable organizational controls to an agent operating profile and enforces them at action time |
| [ISO/IEC 23894:2023](https://www.iso.org/standard/77304.html) | AI risk-management processes and contextual tailoring | Converts risk treatment into qualification constraints, action gates, oversight floors, and revalidation triggers |
| [ISO/IEC 42005:2025](https://www.iso.org/standard/42005) | Lifecycle impact assessment for affected people, groups, and society | Connects assessed impacts to job scope, prohibited uses, data eligibility, evidence requirements, and autonomy ceilings |
| [ISO/IEC FDIS 42105](https://www.iso.org/standard/86902.html) (under development) | Human control and monitoring of AI systems | Distinguishes requested proactivity from permitted autonomy and makes oversight an enforceable, evidence-dependent ceiling |

### 5.3 Quality, Testing, and Data

| Reference | Synergy | Family augmentation |
|---|---|---|
| [ISO/IEC 25059:2023](https://www.iso.org/standard/80655.html) | AI-system quality characteristics used to select evaluation objectives | Requires each applicable characteristic to be operationalized against job outcomes, failure modes, and acceptance thresholds |
| [ISO/IEC TS 42119-2:2025](https://www.iso.org/standard/84127.html) | Risk-based application of software-testing practices to AI systems | Treats the complete operating profile—not only the model or AI component—as the qualification subject and connects test results to qualification validity |
| [ISO/IEC 42119-3](https://www.iso.org/standard/85072.html) | Verification and validation analysis across the AI-system lifecycle | Adds job/activity scope, representative tool and data conditions, material-change impact, surveillance, and revalidation status |
| [ISO/IEC 5259 series](https://www.iso.org/committee/6794475/x/catalogue/) | Data-quality concepts, measures, management, process, and governance | Makes data classification, permitted use, provenance, residency, quality, and steward approval part of both qualification and runtime eligibility |

### 5.4 Conformity Assessment

`TAK-JSI` qualifies an **AI agent operating profile**. It does not certify a human and does not
appropriate the terminology or accreditation model of personnel certification.

| Reference | Applicability |
|---|---|
| [ISO/IEC 17024:2026](https://www.iso.org/standard/17024) | `adjacent`: useful prior art for scheme definition, assessment, surveillance, recertification, suspension, and revocation, but its object is a person and therefore it is not the direct conformity basis for `TAK-JSI` |
| [ISO/IEC 17065](https://www.iso.org/standard/46568.html) | `profiles`: product, process, and service certification is the closer conformity-assessment model for a deployed agent operating profile |
| [ISO/IEC 17067:2013](https://www.iso.org/standard/55087.html) | `profiles`: scheme-design guidance relevant to evaluation selection, surveillance, attestations, and continuing validity |
| [ISO/IEC 42006:2025](https://www.iso.org/standard/42006) | `adjacent`: establishes credible audit and certification of an organization's AI management system and can participate in broader product/process/service schemes; it does not by itself qualify an individual agent for a job |
| [SC 42 JWG 6](https://www.iso.org/committee/6794475.html) | Preferred ISO/IEC liaison point for an AI-agent operating-profile conformity scheme |

A `TAK-JSI` implementation is expected to preserve the normative distinction among:

- self-assertion
- organization attestation
- independent assessment
- accredited certification

Only the last category implies operation under a recognized accreditation and certification
scheme.

## 6. IEEE Alignment

### 6.1 IEEE P3709

[IEEE P3709](https://standards.ieee.org/ieee/3709/12159) is an active project for a framework and
technical requirements for agentic AI.

`TAK` is suitable as a requirements and conformance contribution addressing:

- the agent harness as a control plane distinct from the probabilistic planner or model
- principal-to-action authority continuity
- least-authority tool invocation and delegation narrowing
- policy-enforced data and provider eligibility
- qualification-aware action and autonomy ceilings
- proactivity that cannot widen authority, competence, or oversight
- evidence-earned autonomy progression and mandatory regression
- material-change detection and validation continuity
- reconstructable, attributable execution evidence

The intended relationship is `augments`, not replacement: P3709 provides the broader agentic-AI
framework, while `TAK` supplies implementable runtime-governance requirements.

### 6.2 IEEE P3833

[IEEE P3833](https://standards.ieee.org/ieee/3833/11922/) addresses proactive AI agents in
multimodal human-computer interaction.

`TAK` contributes the cross-domain distinction that:

```text
requested proactivity != delegated authority != demonstrated qualification != permitted autonomy
```

P3833's multimodal interaction scope remains externally owned. `TAK` augments proactivity controls
by defining the hard ceilings and evidence conditions that a user-experience preference cannot
override.

## 7. W3C and 1EdTech Alignment

### 7.1 Agent Identity Registry Protocol Community Group

The [W3C Agent Identity Registry Protocol Community Group](https://www.w3.org/community/agent-identity/)
is developing verifiable agent identity infrastructure, including agent credentials, trust
negotiation, lifecycle management, and integration with MCP, A2A, OAuth/OIDC, and SPIFFE.

`GAID`:

- `adopts` externally governed credential and cryptographic mechanisms
- `profiles` agent credentials with AIDoc, operating-profile, qualification, and receipt semantics
- `augments` the identity layer by separating the enduring subject from mutable operational state
- `augments` lifecycle status with material-change and revalidation semantics
- leaves DID methods, credential proof formats, and trust negotiation to their owning standards

### 7.2 Agent Declaration and Assurance Community Group

The [W3C Agent Declaration and Assurance Community Group](https://www.w3.org/community/adacg/)
is developing declarations of agent identity, ownership, software versions, models, operating
boundaries, conformance profiles, and runtime bindings.

This is the closest active overlap with `GAID`. The preferred relationship is a coordinated
profile:

| ADACG concern | GAID contribution |
|---|---|
| Agent declaration manifest | AIDoc minimum fields and public/private disclosure profiles |
| Ownership and accountability | Issuer lineage, owner of record, steward, and namespace authority |
| Software/model version disclosure | Operating-profile reference and material-state fingerprint |
| Operational boundaries | Authorization-class references, qualification scope, prohibited uses, and data constraints |
| Graduated conformance profiles | `GAID-Private`, `GAID-Federated`, and `GAID-Public` |
| Runtime assurance | Current claim status, receipt linkage, validation continuity, and verifier behavior |

`GAID` must not create a parallel universal manifest where an interoperable W3C manifest can carry
the same semantics.

### 7.3 Agent Trust Protocol Community Group

The [W3C Agent Trust Protocol Community Group](https://www.w3.org/community/atp/) addresses
verifiable identity, trust scoring, privacy-preserving interaction, and conformance testing.

`GAID` can provide verified inputs to trust decisions, but it deliberately does not define a
universal scalar trust score. Trust remains contextual: a valid identity or qualification for one
job does not imply general trustworthiness or authorization for another.

### 7.4 Verifiable Credentials and Open Badges

The [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model/) and
[1EdTech Open Badges 3.0](https://standards.1edtech.org/open-badges/specifications/standards/v3p0/cert)
already define portable, signed claim envelopes with issuer, subject, evidence, validity, expiry,
status, and verification patterns.

`GAID` is intended to profile those formats for portable qualification and assurance claims rather than
define a competing credential envelope. It augments them with AI-agent-specific semantics:

- enduring agent subject and operating-profile fingerprint
- job/activity/data/risk scope
- qualification scheme and evidence references
- maximum evidence-supported autonomy tier
- material-change and `pending-revalidation` state
- explicit separation of a credential claim from live runtime authorization

## 8. IETF, OpenID, and Workload-Identity Alignment

### 8.1 IETF WIMSE

The [IETF Workload Identity in Multi-System Environments working group](https://datatracker.ietf.org/group/wimse/)
defines workload identity architecture, identifiers, credentials, and authentication mechanisms.
Current AI-agent work includes:

- [WIMSE Applicability for AI Agents](https://datatracker.ietf.org/doc/draft-ni-wimse-ai-agent-identity/)
- [AI Agent Authentication and Authorization](https://datatracker.ietf.org/doc/draft-klrc-aiagent-auth/02/)
- [Signed Authorization-Evidence Records](https://www.ietf.org/archive/id/draft-munoz-wimse-authorization-evidence-00.html)
- [Cross-Organizational Delegation for Workload and Agent Identity](https://www.ietf.org/archive/id/draft-reece-wimse-cross-org-delegation-00.html)

These drafts are works in progress and are not cited as completed standards.

The family relationship is:

- WIMSE, SPIFFE, OAuth, GNAP, mTLS, HTTP Message Signatures, and proof tokens authenticate and
  authorize workloads across protocol boundaries
- `GAID` binds the enduring AI subject and governed operating state to those workload identities
- `TAK` determines whether an authenticated request is permissible under current authority,
  qualification, data, and oversight constraints
- `GAID` and `TAK` add qualification and policy-decision references to attributable action evidence
- protocol-level authorization remains necessary but is not sufficient evidence of job competence

### 8.2 OpenID Foundation AIIM

The [OpenID Foundation AI Identity Management Community Group](https://openid.net/cg/artificial-intelligence-identity-management-community-group/)
provides a venue for AI-agent identity use cases, threat modeling, modular roles and scopes, and
interoperability with open identity standards.

`GAID` is positioned as an AI-agent assurance and operating-state profile for established
OpenID/OAuth deployments. It does not replace OAuth authorization servers, OpenID providers,
tokens, proof-of-possession, or enterprise identity policy.

## 9. Protocol and Evidence Carriers

| External specification | Adopted or profiled use |
|---|---|
| Model Context Protocol | Tool discovery and invocation carrier; `TAK` supplies tool policy, approval, data, and evidence controls behind the transport |
| Agent2Agent Protocol | Agent discovery and communication carrier; `GAID` supplies identity/assurance references and `TAK` supplies delegation narrowing |
| W3C Trace Context | Correlation identifiers across agent, tool, model, queue, and delegate boundaries |
| RFC 9421 HTTP Message Signatures | Message integrity and signer binding for cross-boundary evidence |
| RFC 9449 DPoP | Sender-constrained OAuth token use where bearer-token replay is unacceptable |
| SCITT and transparency-log patterns | Verifiable publication and status history for signed claims and receipts |
| in-toto and SLSA | Attestation and provenance patterns for operating-profile components and release evidence |
| C2PA | Provenance for agent-produced content; not a substitute for agent identity or action authorization |

The family defines the semantics that these carriers transport. Implementations should preserve
the native identifiers and verification material of adopted protocols instead of translating them
into opaque, unverifiable prose.

## 10. Distinctive Augmentation

The family addresses a gap left when adjacent standards are implemented independently.

### 10.1 Identity Is Not Operating State

An agent can retain its enduring identity while its model, instruction bundle, tools, retrieval
sources, memory policy, provider routing, qualification, or autonomy posture changes. `GAID` binds
both without conflating them.

### 10.2 Capability Is Not Qualification

A model benchmark, system card, declared skill, successful demonstration, or broad capability
evaluation can contribute evidence. None alone establishes that the complete operating profile is
qualified for a job under representative tools, data, policy, and consequence boundaries.

### 10.3 Qualification Is Not Authorization

`TAK-JSI` establishes a ceiling on permissible autonomy. `TAK` still requires live principal
authority, route and workflow grants, tool policy, data eligibility, and mandatory oversight for
every action.

### 10.4 Proactivity Is Not Autonomy

Proactivity expresses initiative and interaction preference. Autonomy expresses permitted
execution latitude after hard constraints and evidence have been evaluated. Increasing
proactivity cannot raise the autonomy ceiling.

### 10.5 Validation Does Not Survive Material Change Silently

Qualification and assurance claims are bound to a fingerprinted operating profile. A material
change places affected claims into revalidation unless the applicable scheme contains evidence
that the change is immaterial.

### 10.6 Evidence Closes the Lifecycle

Action receipts and operational surveillance feed subsequent qualification and autonomy decisions.
The standards family therefore connects pre-deployment evaluation to runtime behavior and
post-deployment revalidation rather than treating testing as a one-time gate.

## 11. Standards-Contribution Profile

A contribution derived from this family should contain:

- a neutral problem statement and declared scope
- a gap analysis against the specific committee's published and active work
- normative terminology with explicit exclusions
- a clause-level requirements draft
- a machine-readable information model
- conformance assertions and test vectors
- at least two independent implementation or pilot contexts
- privacy, security, safety, accessibility, and internationalization considerations where applicable
- patent, copyright, contribution-license, and reference-implementation terms

The preferred contribution allocation is:

| Contribution | Primary venue | Form |
|---|---|---|
| Agent harness, authority, proactivity, and autonomy controls | IEEE P3709; ISO/IEC SC 42 WG 3/JWG 2 | Requirements clauses and conformance profile |
| Agent identity, operating-state, and assurance manifest | W3C ADACG and Agent Identity Registry groups; OpenID AIIM | Use cases, schema profile, lifecycle requirements, and test vectors |
| Workload identifier, delegation, and signed action evidence | IETF WIMSE and related OAuth work | Focused protocol requirements or profile contributions |
| Job-specific operating-profile qualification | NIST measurement work; ISO/IEC SC 42 WG 3/WG 4/JWG 6 | Evaluation framework, use cases, and conformity-scheme proposal |
| Qualification badge portability | W3C VC and 1EdTech Open Badges communities | Credential profile, JSON-LD context, and verification tests |

For ISO/IEC, a formal new-work proposal should follow the
[ISO proposal process](https://www.iso.org/stages-and-resources-for-standards-development.html)
through the relevant national body or other authorized proposer and should identify a project
leader, market need, affected stakeholders, relationship to existing work, and an initial draft or
outline.

## 12. Implementation and Claiming Guidance

An implementation using this alignment model should:

- identify the exact version or dated draft of each external specification used
- distinguish published standards from active drafts and community-group work
- avoid implying endorsement by a cited organization
- avoid claiming that a `GAID`, credential, badge, or qualification grants live authority
- avoid representing organization-attested assessment as accredited certification
- publish a crosswalk from family conformance assertions to adopted external requirements
- preserve external identifiers, credential status, proof material, and evidence provenance
- document deviations and the project-specific reason for each deviation
- allow other conforming protocol carriers where the semantic and verification requirements are
  preserved

## 13. Open Standardization Questions

The following questions require multistakeholder resolution:

- which W3C manifest or credential vocabulary should carry the canonical public AIDoc projection
- whether a globally resolvable `GAID` requires a new identifier scheme or can remain a semantic
  layer over existing URI, DID, WIMSE, SPIFFE, and enterprise identifiers
- which material-change classes can preserve qualification without full reassessment
- how qualification schemes establish representative job and data conditions across sectors
- which evidence can be public, selectively disclosed, auditor-only, or prohibited from disclosure
- how independent assessors and certification schemes demonstrate competence and impartiality
- how cross-organizational relying parties discover trusted issuers, schemes, and status services
- how sector regulators constrain autonomy independently of technical qualification
- how interoperability tests demonstrate that badges and manifests are not mistaken for live
  authorization

These questions are intentionally not resolved by unilateral DPF implementation. They identify
where standards-body consensus is required.

## 14. Summary

The family complements a mature but segmented standards landscape. Its contribution is the
composition contract that makes an AI agent's identity, current operating state, job qualification,
runtime authority, autonomy posture, evidence, and revalidation status mutually consistent and
verifiable.

The standards should therefore progress through coordinated contributions:

- `TAK` as runtime-governance requirements
- `GAID` as an identity and assurance semantic profile
- `TAK-JSI` as a job-specific operating-profile qualification scheme

This positioning preserves existing protocol and conformity-assessment authorities while filling
the operational gap between organization-level governance, model evaluation, identity, and
consequential autonomous action.
