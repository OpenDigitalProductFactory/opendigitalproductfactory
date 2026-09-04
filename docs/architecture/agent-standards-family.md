# Trustworthy AI Agent Standards Family

## Purpose

This page is the navigation and ownership map for the DPF-originated AI agent standards family.
It does not add normative controls. The individual standards remain authoritative for their own
subjects.

## Standards map

| Standard | Canonical source | Question answered | Normative owner |
|---|---|---|---|
| Trusted AI Kernel (`TAK`) | [trusted-ai-kernel.md](trusted-ai-kernel.md) | May this agent act, under whose authority, through which tools and data, with what oversight and evidence? | Runtime harness, authority, action gating, memory, audit, safety, and earned-autonomy enforcement |
| Global AI Agent Identification and Governance (`GAID`) | [GAID.md](GAID.md) | Who is this agent, which operating profile is active, what claims are advertised, and how can a relying party verify their status? | Identity, AIDoc, claims, badges, receipts, lifecycle, and cross-boundary verification |
| Job-Specific Intelligence profile (`TAK-JSI`) | [job-specific-intelligence.md](job-specific-intelligence.md) | Is this identified operating profile qualified for this job, activity, data scope, and risk context, and what evidence keeps that qualification current? | Job definition, qualification scheme, evidence, surveillance, revalidation, and qualification-to-autonomy boundaries |

The family's relationship to NIST, ISO/IEC, IEEE, W3C, IETF, OpenID, 1EdTech, and adjacent
protocol work is maintained in the informative
[External Standards Alignment](agent-standards-external-alignment.md) companion. That document is
the single source of truth for cross-standard gap analysis, synergy, augmentation boundaries, and
venue allocation. The informative
[Standards Contribution Roadmap](agent-standards-contribution-roadmap.md) owns engagement
sequencing, readiness gates, contribution packages, and go/no-go criteria.

### Enterprise operating-model bridge

The
[Portfolio Aligned Agent and Workforce Operating Standard](four-portfolio-archetype-ai-workforce-operating-standard.md)
is an adjacent enterprise standard, not a fourth member of the agent-assurance family. It owns where
AI coworkers sit in the four portfolios, how business Products and industry value streams relate to
DigitalProducts, how human/AI work is allocated, and how the resulting trace and gaps are assessed.
It composes this family whenever an AI coworker is realized as both a managed DigitalProduct and an
identity-bearing Performer; it does not redefine TAK, GAID, or TAK-JSI controls.

## Composition rule

The standards compose around one governed action:

1. `GAID` resolves the enduring AI Coworker identity and the versioned operating profile.
2. `TAK-JSI` determines whether that profile is qualified for the requested job/activity scope.
3. `TAK` intersects the principal's authority, the coworker's grants, the route/workflow policy,
   the data constraints, and the applicable qualification/autonomy ceiling at execution time.
4. `GAID` binds the resulting action receipt and current qualification status back to the
   identifiable subject.

No document widens another document's authority:

- a `GAID` claim is not live authorization
- a `TAK-JSI` qualification is not permission to act
- a `TAK` permission is not evidence of job competence
- a model card, system card, or generic benchmark is not a job qualification

## Adjacent DPF concepts

| Concept | Relationship to the standards family |
|---|---|
| AI Coworker | DPF's managed dual-aspect concept: a DigitalProduct owns lifecycle, release, component, and deployment truth; BusinessProductOffering owns commercial terms, OperationalServiceOffering owns service commitments, and CoworkerOffer/CoworkerEngagement own coworker-service terms and acceptance. An AgentSubject/Performer carries a `GAID`, operating profile, job qualifications, assignments, and runtime authority under `TAK` |
| Portfolio Aligned Agent and Workforce Operating Standard | Owns enterprise portfolio, Product, industry-flow, work-allocation, human/AI composition, conformance, and gap semantics around the agent-assurance family |
| WSID | Owns profession and craft doctrine: the knowledge, techniques, evidence practices, and decision axes a job requires |
| JSI | Composes job requirements, WSID material, data/tool/model constraints, evaluations, and outcome evidence into a qualification lifecycle |
| Proactivity | Expresses how readily a coworker should initiate or continue work; it cannot widen authority, qualification, or a regulatory/data ceiling |
| Earned autonomy | The runtime permission level justified by evidence for a specific `(coworker × activity × risk)` scope |
| Golden Triangle | Compiles human cost/quality/time posture into effort, model tier, verification depth, review depth, and retries; it allocates assurance resources but does not prove competence |
| Data stewardship | Establishes the classification, quality, provenance, use, retention, residency, and accountable ownership constraints that both qualification and runtime routing must honor |

## Source-of-truth rule

Normative requirements belong in exactly one standard:

- runtime controls go in `TAK`
- identity and claim-envelope controls go in `GAID`
- job qualification controls go in `TAK-JSI`
- enterprise portfolio, Product/value-flow, work-allocation, and dual-aspect controls go in the
  [Portfolio Aligned Agent and Workforce Operating Standard](four-portfolio-archetype-ai-workforce-operating-standard.md)

White papers, conformance rubrics, diagrams, DPF assessments, and generated Word files are derived
companions. They may summarize the standards but must link back to the canonical normative source.

External crosswalks are derived companions and belong in
[agent-standards-external-alignment.md](agent-standards-external-alignment.md). Submission
execution guidance belongs in
[agent-standards-contribution-roadmap.md](agent-standards-contribution-roadmap.md). Specific
technical requirements remain with the normative owner named above.
