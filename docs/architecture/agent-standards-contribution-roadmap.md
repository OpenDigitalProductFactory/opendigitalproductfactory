# Trustworthy AI Agent Standards Family — Contribution Roadmap

## Status

This document is an informative contribution and submission roadmap for the Trusted AI Kernel
(`TAK`), Global AI Agent Identification and Governance (`GAID`), and Job-Specific Intelligence
(`TAK-JSI`) standards family.

It does not authorize a submission, establish an intellectual-property policy, claim endorsement,
or make any external specification normative. The canonical technical relationship to external
work remains in
[External Standards Alignment](agent-standards-external-alignment.md). Normative requirements
remain in the three standards identified by
[Trustworthy AI Agent Standards Family](agent-standards-family.md).

Venue and process information was verified against primary sources on 2026-07-26. It must be
rechecked before an external contribution is filed.

## 1. Purpose

This roadmap answers four operational questions:

1. What additional evidence is required before the standards family is credible outside DPF?
2. Which part of the family belongs in which standards or pre-standardization venue?
3. What package should be contributed to each venue without duplicating its existing work?
4. What evidence permits progression from public incubation to a formal standards proposal?

The roadmap deliberately separates **incubation**, **technical contribution**, and **formal new
work**. Publication by DPF is not consensus. Participation in a community group is not adoption.
Acceptance of a contribution is not certification. A formal standard is not justified until there
is demonstrated need, implementer diversity, and a viable consensus community.

## 2. Contribution Thesis

The family should not be positioned as another general AI governance framework, agent identity
protocol, model benchmark, badge format, or authorization protocol.

Its distinct contribution is the assurance chain connecting those established layers:

```text
enduring agent identity
  -> materially versioned operating profile
  -> job- and context-specific qualification
  -> bounded runtime authority and autonomy
  -> attributable action evidence
  -> surveillance, change review, and revalidation
```

The contribution should be accepted only where the receiving venue can preserve this distinction:

- identity is not operating state
- capability is not qualification
- qualification is not authorization
- requested proactivity is not permitted autonomy
- qualification does not silently survive material change
- a badge or manifest does not grant live authority

## 3. Readiness Levels

| Level | Meaning | Required evidence | Permitted claim |
|---|---|---|---|
| `R0 — Working draft` | DPF-originated concepts are being normalized | Normative drafts, ownership map, terminology, internal conformance review | “Working draft” |
| `R1 — Candidate specification` | The family is stable enough for independent implementation | Versioned candidate release, changelog, issue process, schemas, examples, security/privacy analysis | “Candidate specification” |
| `R2 — Public incubation` | External participants can evaluate and improve a bounded contribution | Neutral contribution paper, venue crosswalk, open issues, contribution/IP terms, public test material | “Submitted for community consideration” only after filing |
| `R3 — Interoperability demonstrated` | More than one implementation can exchange and verify the defined artifacts | Two independent implementations or pilots, executable assertions, test vectors, interoperability report, issue dispositions | “Interoperability demonstrated” within the tested profile |
| `R4 — Formal new-work ready` | A standards committee can make an informed new-work decision | Market-need case, stakeholder coalition, project leader/editor commitment, initial draft, work plan, conformity/IP analysis | “Proposed new work” only after authorized submission |

The family is presently at `R0`, with substantial publication-quality material already available.
It must not be represented as `R1` until machine-readable schemas, release governance, and
independent implementation instructions are complete.

## 4. Venue Allocation

The family should progress through coordinated, bounded contributions rather than one monolithic
submission.

| Contribution subject | Initial venue | Contribution form | Boundary |
|---|---|---|---|
| `GAID` identity versus operating-state semantics, AIDoc claims, status, and qualification references | W3C Agent Declaration and Assurance Community Group and Agent Identity Registry Protocol Community Group | Use cases, requirements, JSON-LD/Verifiable Credential profile, lifecycle test vectors | Reuse identifiers, credentials, proofs, and manifest carriers selected by the communities |
| `TAK` runtime authority, proactivity, oversight, evidence, and earned-autonomy controls | IEEE P3709 Agentic AI working group | Requirements clauses, use cases, conformance assertions, reference control flow | Do not replace the broader agentic-AI framework |
| `TAK-JSI` job-specific qualification and revalidation | NIST AI Consortium | Measurement proposal, job-profile model, evaluation protocol, multi-sector pilot | Treat NIST work as measurement and pre-standardization, not formal adoption |
| `TAK-JSI` trustworthiness and conformity-assessment model | INCITS/Artificial Intelligence, then ISO/IEC JTC 1/SC 42 | Study contribution, use cases, working draft, and eventually a preliminary or new-work proposal | Enter ISO/IEC through the applicable national-body and committee process |
| Workload identity, delegated authority, and signed authorization evidence | IETF WIMSE and related OAuth work | Focused requirements, problem statements, implementation feedback, or protocol-profile text | Do not bring the complete `GAID` or `TAK-JSI` information model into an authentication protocol |
| Portable qualification claims | W3C Verifiable Credentials and 1EdTech Open Badges communities | Credential profile, context, status rules, and verification tests | Reuse credential containers; do not define a competing badge transport |
| Agent identity and authorization use cases | OpenID Foundation AIIM | Requirements, relying-party scenarios, and lifecycle gaps | Preserve OpenID and OAuth ownership of identity-management protocols |

### 4.1 W3C incubation

The [Agent Declaration and Assurance Community Group](https://www.w3.org/community/adacg/)
expressly covers cryptographically verifiable agent declarations, an Open KYA JSON-LD manifest,
graduated conformance profiles, runtime bindings, and verification ecosystems. The
[Agent Identity Registry Protocol Community Group](https://www.w3.org/community/agent-identity/)
covers verifiable agent identity, credentials, trust negotiation, protocol integrations,
revocation, and lifecycle management.

Both are strong incubation venues for `GAID`. A first contribution should provide:

- the enduring-subject versus operating-profile distinction
- the minimum AIDoc semantic model
- qualification and claim-status references
- material-change and revalidation requirements
- examples showing why possession of a claim does not grant runtime authority
- mappings to the communities' selected manifest, identifier, and credential carriers

W3C Community Groups are community initiatives and do not represent W3C endorsement. Joining
requires a W3C account and the Community Contributor License Agreement; W3C membership is not
required. DPF must review those contribution terms before contributing text.

### 4.2 IEEE contribution

[IEEE P3709](https://standards.ieee.org/ieee/3709/12159/) is an active project for a framework and
technical requirements for Agentic AI and provides an “Express Interest” path.

The first `TAK` contribution should be a neutral requirements packet rather than the complete DPF
document. It should contain:

- authority intersection and fail-closed action eligibility
- separate proactivity and autonomy controls
- oversight floors and action-specific approval
- delegation narrowing
- data stewardship and model-route eligibility
- evidence-earned autonomy and regression
- attributable receipts and post-action evidence
- conformance assertions for both permitted and prohibited behavior

### 4.3 NIST measurement partnership

The [NIST AI Agent Standards Initiative](https://www.nist.gov/artificial-intelligence/ai-agent-standards-initiative)
centers industry-led standards, community-led protocols, authentication and identity research, and
security evaluation. Its listed 2026 RFI and comment deadlines have passed, so those calls must not
be represented as open submission routes.

The [NIST AI Consortium](https://www.nist.gov/artificial-intelligence/nist-ai-consortium) is open
to letters of interest from organizations on an ongoing basis, subject to periodic review. Its
measurement, evaluation, test-system, and prototype remit is the strongest current fit for
`TAK-JSI`.

The proposed research question should be:

> How can a materially versioned AI agent operating profile be evaluated and revalidated for a
> bounded job under representative data, tool, authority, oversight, and autonomy conditions?

The proposal should offer DPF artifacts and pilot access, not ask NIST to endorse the standard.
Prospective participants should account for the consortium agreement and collaboration
requirements before applying.

### 4.4 IETF and OpenID protocol contributions

[IETF WIMSE](https://datatracker.ietf.org/group/wimse/documents/) has active work on workload
architecture, identifiers, credentials, HTTP signatures, proof tokens, AI-agent applicability,
cross-organizational delegation, execution-context tokens, and signed authorization-evidence
records.

This activity makes a new universal `GAID` transport or parallel workload identifier especially
inappropriate. Contributions should instead identify semantic requirements that existing WIMSE,
OAuth, or OpenID artifacts need to carry:

- enduring subject and current operating-profile references
- issuer and responsible-organization bindings
- delegation parentage and narrowed authority
- action, policy-decision, and qualification-status references
- material-change, expiry, suspension, and revocation status

Protocol syntax remains with the receiving protocol community.

### 4.5 INCITS and ISO/IEC progression

[INCITS/Artificial Intelligence](https://www.incits.org/committees/ai) is the United States
Technical Advisory Group to ISO/IEC JTC 1/SC 42. It is the appropriate United States route for
building a national position and introducing `TAK-JSI` use cases or study material into SC 42.

DPF should first seek discussion with the relevant INCITS participants and SC 42 work allocation:

- WG 3 for trustworthiness and continuing validity
- WG 4 for representative cross-sector use cases
- JWG 2 for software/system lifecycle and configuration identification
- JWG 6 for conformity assessment of AI systems

The [ISO standards-development process](https://www.iso.org/stages-and-resources-for-standards-development.html)
requires a new-work proposal to be submitted for committee vote, nominate a project leader, and
raise copyright, patent, and conformity-assessment issues early. ISO/IEC Directives also expect a
first working draft or at least an outline and evidence of active participation.

Therefore, DPF should not pursue a formal new-work proposal until the `R4` gate is satisfied.
A preliminary work item, study contribution, or contribution to existing work is preferable while
the coalition and implementation evidence are still developing.

## 5. Candidate-Specification Package

One neutral, publicly reviewable package should be assembled before external incubation:

| Artifact | Minimum content | Readiness evidence |
|---|---|---|
| Executive gap brief | Two pages: problem, affected stakeholders, existing-work boundary, unique assurance chain, requested collaboration | Reviewed by a non-DPF standards participant |
| Candidate specifications | Versioned `TAK`, `GAID`, and `TAK-JSI` text with changelog and stable clause identifiers | `v0.9` release and issue/disposition log |
| Clause crosswalk | Every proposed clause mapped to related external work and marked `adopts`, `profiles`, `augments`, or `out-of-scope` | No unsupported conformance or endorsement claims |
| Machine-readable models | AIDoc, operating-profile fingerprint, job profile, qualification record, material-change record, and runtime evidence schemas | JSON Schema validation; JSON-LD/VC profiles where portability requires them |
| Conformance suite | Executable assertions, positive/negative test vectors, and examples | Repeatable public test run |
| Reference verifier | Resolution, signature/status, schema, scope, and authorization-separation checks | Independent implementation can run it |
| Threat and privacy package | Threat model, evidence minimization, redaction/selective-disclosure profiles, retention, and verifier access | Security and privacy review dispositions |
| Pilot reports | At least two materially different jobs and operating contexts | Reproducible scenarios, thresholds, results, limitations, and change/revalidation event |
| Interoperability report | At least two independently controlled implementations | Exchange and verification results, failures, and resolved ambiguities |
| Governance/IP package | Specification license, code license, contribution agreement, patent posture, editor roles, issue process | Owner and legal approval |
| Formal-work packet | Scope, purpose, justification, market need, stakeholder map, project leader, work plan, initial draft | National-body or committee sponsor support |

## 6. Pilot and Evidence Program

### 6.1 Required pilot diversity

The minimum pilot set should contain:

1. **Software-development qualification.** Use DPF's existing development coworker work as the
   technically rich initial implementation. Exercise repository authority, tools, data
   sensitivity, model routing, approval gates, receipts, and operating-profile change.
2. **Data-sensitive non-development qualification.** Select a job such as accounts-payable
   exception handling, regulated service intake, or insurance administration. It must include
   data classification, purpose constraints, escalation, prohibited actions, and lower autonomy
   ceilings than the development pilot.

At least one pilot must be implemented or assessed by an organization independent of DPF.

### 6.2 Evidence each pilot must preserve

- enduring identity and exact operating-profile fingerprint
- job and activity scope, exclusions, and critical failures
- representative data, tools, authority, and deployment conditions
- model/provider eligibility and route selection evidence
- evaluation plan, thresholds, results, uncertainty, and limitations
- approved autonomy ceiling and runtime enforcement evidence
- consequential-action receipts and exception handling
- one material-change event and its impact decision
- surveillance result and revalidation, restriction, suspension, or revocation outcome

### 6.3 Pilot acceptance

A pilot does not pass merely because the agent completes the job. It passes only when:

- critical failures are absent or handled as the scheme declares
- the evidence proves the tested operating profile and conditions
- disallowed actions fail closed
- the qualification does not widen principal authority
- the runtime does not exceed the qualification or regulatory ceiling
- a material change produces the declared review or revalidation response
- another party can understand and verify the result

## 7. Phased Engagement

Time horizons begin when an owner authorizes external engagement.

### Phase A — Candidate release and incubation (`0–3 months`)

Actions:

- freeze a `v0.9` candidate family with stable clause identifiers and changelog
- publish the neutral gap brief and machine-readable schema drafts
- convert the prose conformance rubrics into an executable minimum suite
- secure contribution-license, patent-posture, and editor-role decisions
- join the two W3C Community Groups and contribute the bounded `GAID` requirements/profile
- express interest in IEEE P3709 and offer the bounded `TAK` requirements packet
- prepare a NIST AI Consortium letter of interest around `TAK-JSI` measurement and pilots
- begin the second, data-sensitive pilot and recruit an independent implementer

Exit gate:

- `R1` evidence is complete
- every external package has a named owner and venue-specific scope
- no package claims certification, endorsement, or authority from a badge
- at least one external participant has agreed to technical review

### Phase B — Evidence and coalition (`3–9 months`)

Actions:

- complete both pilots and publish limitations and negative results
- run the first independent interoperability event
- disposition ambiguities discovered by implementers
- contribute focused delegation and authorization-evidence requirements to IETF/OpenID discussions
- bring `TAK-JSI` use cases and conformity questions to INCITS/Artificial Intelligence
- seek SC 42 study or existing-project contribution opportunities before proposing new work
- revise the candidate family without breaking stable identifiers silently

Exit gate:

- `R3` evidence is complete
- at least two independently controlled implementations exist
- at least two sectors or materially different job contexts are represented
- a neutral stakeholder coalition supports continued standardization
- the proposed formal scope no longer duplicates active W3C, IEEE, IETF, OpenID, or ISO work

### Phase C — Formalization (`9–18 months`)

Actions:

- select the smallest formal deliverable supported by the coalition
- nominate a project leader and committed editors
- assemble the market-need, stakeholder, work-plan, IP, and conformity-assessment package
- seek INCITS sponsorship for ISO/IEC work when the scope belongs in SC 42
- alternatively progress bounded `TAK` material within IEEE if P3709 is the accepted home
- maintain liaison and crosswalks so parallel venues do not create conflicting definitions

Exit gate:

- `R4` evidence is complete
- the receiving committee supports the scope and has active expert commitments
- the initial draft is implementation-backed
- DPF leadership approves the submission and its contribution/IP obligations

## 8. Governance Decisions Required Before Filing

The following decisions require explicit owner approval:

- specification copyright holder and license
- patent and essential-claims disclosure posture
- contributor agreement or community contribution terms
- reference implementation and test-suite licenses
- trademark and acronym usage
- neutral editor, steering, appeal, and issue-disposition roles
- public repository and release authority
- which organization may speak for the specification
- which claims DPF may make while work is under consideration

No agent or implementation team should infer these decisions from the technical documents.

## 9. Go/No-Go Gates

### 9.1 Public incubation go/no-go

Proceed only when:

- the contribution is narrower than the complete standards family
- the receiving venue's current scope and participation terms have been rechecked
- the package identifies adopted work and non-duplication boundaries
- draft schemas and examples are public and versioned
- open questions are explicit
- owner approval covers the contribution terms

### 9.2 Formal proposal go/no-go

Proceed only when:

- two independent implementations or pilots exist
- an executable conformance suite exists
- a market need and affected stakeholder set are evidenced
- a project leader and active experts are committed
- the proposal has a first draft or substantial outline
- IP, conformity assessment, security, privacy, accessibility, and internationalization impacts
  have been addressed
- committee leadership or the applicable national body has confirmed the route

Do not proceed when the primary argument is merely that existing standards are “not specific
enough.” The proposal must show the exact missing assurance relationship, real implementation
consequences, and why contribution to existing work cannot adequately resolve the gap.

## 10. Submission Package Template

Every venue-specific package should use this structure:

1. **Title and status.** “Contribution for discussion”; no adoption language.
2. **Problem statement.** One operational gap expressed without DPF product terminology.
3. **Scope and exclusions.** The smallest contribution the venue can own.
4. **Stakeholders and harms.** Relying parties, operators, affected people, assessors, and
   regulators.
5. **Existing work.** Clause-level crosswalk and non-duplication statement.
6. **Proposed requirements.** Testable normative text with stable identifiers.
7. **Information model.** Schemas, examples, status, lifecycle, and extension rules.
8. **Conformance.** Assertions, positive and negative vectors, and verifier behavior.
9. **Implementation evidence.** Pilots, interoperability results, limitations, and open issues.
10. **Security and privacy.** Threats, evidence disclosure, retention, and failure behavior.
11. **Governance and IP.** Contribution terms, licenses, editors, and change process.
12. **Requested action.** Review, adopt use cases, open a work item, or collaborate on a pilot.

## 11. Immediate Next Actions

The next standards work should prioritize proof over additional normative breadth:

1. designate a standards-family owner and external-contribution editor
2. approve the specification, code, and contribution-license posture
3. freeze `v0.9` clause identifiers and publish a changelog
4. define the AIDoc, operating-profile, job-profile, qualification, material-change, and receipt
   schemas
5. turn the existing conformance rubrics into executable assertions and test vectors
6. select and recruit the independent, data-sensitive pilot
7. prepare the W3C `GAID`, IEEE `TAK`, and NIST `TAK-JSI` packages independently
8. recheck each venue immediately before filing

The first recommended external sequence is W3C incubation for `GAID`, IEEE contribution for `TAK`,
and NIST measurement collaboration for `TAK-JSI`. A formal ISO/IEC proposal should follow—not
precede—independent implementation, pilot, and coalition evidence.

