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
| Gated Permissions Process (`GPP`) — working draft | [gated-permissions-process.md](gated-permissions-process.md) | Which decision, in which owning authority scope, admits this class of tool use for this stage of this work, and is the model of that envelope complete and actually enforced? | The Gated Permission binding (scope gate × capability set × work-shape stage × subject × validity), the capability vocabulary, co-occurrence constraints, model completeness checks, and efficacy measures. Owns no runtime control. |

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
is an adjacent enterprise standard, not a member of the agent-assurance family. It owns where
AI coworkers sit in the four portfolios, how business Products and industry value streams relate to
DigitalProducts, how human/AI work is allocated, and how the resulting trace and gaps are assessed.
It composes this family whenever an AI coworker is realized as both a managed DigitalProduct and an
identity-bearing Performer; it does not redefine TAK, GAID, or TAK-JSI controls.

## Composition rule

The standards compose around one governed action:

1. `GAID` resolves the enduring AI Coworker identity and the versioned operating profile.
2. `GPP` resolves the envelope: the satisfied Gated Permissions for the actor's Workroom and
   work-shape stage, each traceable to a gate decision in its owning scope.
3. `TAK-JSI` determines whether that profile is qualified for the requested job/activity scope.
4. `TAK` intersects the principal's authority, the coworker's grants, the GPP envelope (the
   route/workflow term of TAK §7.2), the data constraints, and the applicable
   qualification/autonomy ceiling at execution time.
5. `GAID` binds the resulting action receipt, the binding and gate-decision references, and the
   current qualification status back to the identifiable subject.

No document widens another document's authority:

- a `GAID` claim is not live authorization
- a `TAK-JSI` qualification is not permission to act
- a `TAK` permission is not evidence of job competence
- a `GPP` binding is not a grant; it can only narrow what `TAK` would otherwise allow
- a model card, system card, or generic benchmark is not a job qualification

## Principle-directed work and MBSE composition

The working-draft amendment under EP-B932453F makes the governing loop explicit:
scoped principles and evidence inform a recommendation; TAK separately checks
authority and mediates the effect; GAID binds receipts; JSI evaluates the operating
composition and its continuing qualification. Hard constraints precede preference
ranking. The normative owners are [TAK §7.13](trusted-ai-kernel.md#713-principle-directed-decision-contract),
[GAID §10.2.1](GAID.md#1021-principle-directed-execution-binding) and
[JSI §8.4](job-specific-intelligence.md#84-qualification-of-principle-directed-work).

The informative [MBSE composition design](../superpowers/specs/2026-09-27-principle-directed-agent-composition-design.md)
connects requirements, work shapes, decisions, controls and outcome evidence using
existing modeling approaches. It is an implementation profile proposal, not a new
general-purpose modeling language or a claim of full interchange conformance.
These amendments and their proposed assertions still require independent review
and execution evidence. Existing implementations do not become conformant by
publishing the amended text.

## Gated permissions and approval fatigue

Per-call approval fails in practice because people stop reading prompts, and blanket approval
fails because it removes the decision altogether. `GPP` places the decision at the class of work:
one recorded decision by the owning scope admits a bounded capability set for a work-shape stage,
and `TAK` enforces it on every call. The evidence and market context are in the informative
[market and thought-leadership landscape](agent-governance-market-landscape-2026.md).

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

## Word editions

Each standard and the white paper are also published as a Word document, generated from the Markdown
above by `pnpm docs:agent-standards`. The Markdown is the source of truth; the Word file is a
publication snapshot and carries its generation date.

| Document | Word edition |
|---|---|
| Trusted AI agent governance white paper | [Trusted-AI-Agent-Governance-White-Paper.docx](/architecture/Trusted-AI-Agent-Governance-White-Paper.docx) |
| `TAK` — Trusted AI Kernel | [Trusted-AI-Kernel-Architecture.docx](/architecture/Trusted-AI-Kernel-Architecture.docx) |
| `GAID` — Global AI Agent Identification | [GAID.docx](/architecture/GAID.docx) |
| `TAK-JSI` — Job-Specific Intelligence | [Job-Specific-Intelligence.docx](/architecture/Job-Specific-Intelligence.docx) |
| `GPP` — Gated Permissions Process | [Gated-Permissions-Process.docx](/architecture/Gated-Permissions-Process.docx) |

## Source-of-truth rule

Normative requirements belong in exactly one standard:

- runtime controls go in `TAK`
- identity and claim-envelope controls go in `GAID`
- job qualification controls go in `TAK-JSI`
- the gate-to-capability binding model, its vocabulary, completeness checks and efficacy
  measures go in `GPP`
- enterprise portfolio, Product/value-flow, work-allocation, and dual-aspect controls go in the
  [Portfolio Aligned Agent and Workforce Operating Standard](four-portfolio-archetype-ai-workforce-operating-standard.md)

White papers, conformance rubrics, diagrams, DPF assessments, and generated Word files are derived
companions. They may summarize the standards but must link back to the canonical normative source.

External crosswalks are derived companions and belong in
[agent-standards-external-alignment.md](agent-standards-external-alignment.md). Submission
execution guidance belongs in
[agent-standards-contribution-roadmap.md](agent-standards-contribution-roadmap.md). Specific
technical requirements remain with the normative owner named above.
