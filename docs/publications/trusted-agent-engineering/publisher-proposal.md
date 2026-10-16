---
status: draft
---

# Book proposal: Engineering Accountable Agents

**Working subtitle:** Principles, permissions and evidence across models and runtimes  
**Proposed author:** Mark Bodman  
**Editorial status:** Informative review draft, 16 October 2026  
**Programme:** EP-B932453F · BI-6AC40460  
**Proposed format:** Approximately 75,000–85,000 words, twelve chapters, diagrams, implementation exercises and a separately versioned companion repository.

This is a proposal for review. It neither commits the author to a full manuscript
nor authorizes publisher outreach, a publishing agreement or a rights commitment.
The [packet introduction](README.md) records its source baseline and claims boundary.

## The book in one paragraph

An agent can recommend the correct action and still lack authority to perform it.
It can hold valid credentials and still be unqualified for the job. It can receive
approval, submit a request, lose the response and then repeat an effect that
already happened. *Engineering Accountable Agents* shows architects and engineers
how to model and control these differences. Readers build a versioned chain from
business requirements and scoped principles to decisions, permissions, mediated
effects and outcome evidence. The book explains the DPF-originated TAK, GAID,
TAK-JSI and GPP drafts through two recurring examples: a governed software change
and a synthetic expense approval. It combines systems modeling with practical
harness design, including current-authority checks, bounded loops, revocation,
reconciliation and honest conformance reporting. Readers can apply the method
around different models and runtimes without treating a model's answer, a prompt
or a badge as permission.

## Reader and practical promise

The primary reader is a platform engineer, systems architect or technical lead
responsible for an agent that can change an external system. The reader understands
APIs, service identities, version control and testing. The implementation examples
use language-neutral pseudocode and a small TypeScript reference, with explanatory
diagrams for readers whose work is primarily architectural.

Secondary readers include assurance specialists, enterprise architects, security
engineers and product owners who must explain why an agent is permitted to act and
what evidence supports a claim about its operation.

By the end, readers will have produced:

1. A work model containing stages, decisions, capability envelopes, data boundaries and stop conditions.
2. A versioned agent operating profile that distinguishes identity, competence and authority.
3. A mediated execution loop with durable effect identity and recovery behavior.
4. An assertion-to-evidence report that distinguishes passing tests, failed controls, unsupported controls and unrun assessments.
5. An adapter statement describing what changes when the same definition moves to another harness.

The book teaches the engineering of a solution around a model. It does not teach
foundation-model training, propose custom silicon or promise universal safety.

## Why this book now

Harness engineering has become an explicit engineering discipline. OpenAI's
February 2026 account describes work on the surrounding environment, repository
knowledge, architectural constraints and feedback loops. Anthropic's agent
guidance distinguishes predefined workflows from model-directed execution and
recommends adding complexity only where it helps. These sources support a practical
focus on the complete operating system around inference rather than model
capability alone. They do not establish a safety result for DPF.
[OpenAI](https://openai.com/index/harness-engineering/),
[Anthropic](https://www.anthropic.com/engineering/building-effective-agents).

Open standards also need implementation evidence. The Agentic AI Foundation
provides a current ecosystem for agent interoperability work. This proposal offers
material that could inform such discussions; it does not imply foundation
acceptance, sponsorship or standardization.
[Agentic AI Foundation](https://aaif.io/).

The durable contribution is the method of connecting a requirement to an
observable effect and a qualified claim. Vendor versions and adapter instructions
belong in the maintained companion material.

## Comparable titles and differentiation

| Title | Established coverage | Proposed distinction |
|---|---|---|
| Anjali Jain and Philip O'Shaughnessy, *Architecting for Autonomy*, Manning | Enterprise architecture, delegated autonomy, decision boundaries and oversight; the publisher lists a July 2026 MEAP start and estimated Spring 2027 publication. | Develop a versioned normative-obligation-to-test chain, including negative vectors, incomplete assessments and target-specific portability limits. |
| Chip Huyen, *AI Engineering*, O'Reilly | Foundation-model application engineering, evaluation, model adaptation, inference and architecture. | Concentrate on the relationship between job qualification, current authority, work modeling and the execution boundary. |
| Micheal Lanham, *AI Agents in Action*, second edition, Manning | Practical agent construction, tools, memory, planning, evaluation and agentic loops. | Make the governed effect, its recovery contract and the evidence supporting an assurance claim the organizing units. |

These are comparisons with publisher descriptions and contents, not claims based
on reviewing every chapter. The proposal does not claim that enterprise agent
governance is absent from the market.
[Manning: Architecting for Autonomy](https://www.manning.com/books/architecting-for-autonomy),
[O'Reilly: AI Engineering](https://www.oreilly.com/library/view/ai-engineering/9781098166298/),
[Manning: AI Agents in Action, second edition](https://www.manning.com/books/ai-agents-in-action-second-edition).

## Structure and annotated contents

| Chapter | Reader outcome |
|---|---|
| **1. Engineering the working system** | Define the operating composition and separate a recommendation, qualification, authorization, execution receipt and observed outcome. [Sample supplied](chapter-01-engineering-the-working-system.md). |
| **2. Principles have owners** | Resolve platform, organization and professional questions in their proper scopes. Apply hard constraints before preference ranking; record uncertain facts and unresolved authority. |
| **3. Give work a shape** | Model stages, participants, requirements, decisions, stop conditions and evidence. Compose existing systems, process and decision modeling approaches without asserting automatic interchange. |
| **4. Identify and qualify the operating composition** | Explain GAID identity and operating-profile continuity, JSI job scope, assessment evidence, material change, surveillance and qualification limits. |
| **5. Model permission once; enforce it at use** | Build GPP bindings and map capability vocabulary to reachable effects. Distinguish modeled, enforced and evidenced coverage. |
| **6. A synthetic expense control loop** | Walk a synthetic expense through policy, evidence, scoped judgment, exact-action authorization, dispatch and reconciliation. [Sample supplied](chapter-02-synthetic-expense-control-loop.md). |
| **7. Build the mediated loop** | Implement durable state, reservation, compare-and-swap transitions, trusted time, cancellation, revocation and bounded recovery. |
| **8. Treat data processing as an effect** | Govern retrieval, context assembly, model destinations, account selection, memory, fallback and egress; preserve restrictions through transformations. |
| **9. Recover without changing history** | Use the DPF original-review recovery source case to separate stable work identity from changing execution authority. Explain why observing a completed effect differs from authorizing a new one. |
| **10. Assess the claimed boundary** | Turn normative clauses into falsifiable assertions. Publish denominators, environment, unsupported controls, residual limits and independent-assessment attribution. |
| **11. Move between harnesses** | Build and test adapter contracts for the declared surfaces. Keep imported definitions at Defined status until target evidence supports a stronger claim. |
| **12. Operate and evolve the standard** | Manage revisions, compatibility, incident learning, contribution governance, claims, IP boundaries and adoption decisions. |

The canonical normative sources remain the standards documents. The book explains
them; it does not create another location for requirements. The
[standards family map](../../architecture/agent-standards-family.md) identifies
each owner. The [packet introduction](README.md#source-baseline) pins the initial
source revision.

## Cases, artifacts and evidence policy

The recurring financial example uses entirely synthetic records and a local
approval target. An expense approval is distinct from a payment instruction.
No bank connection, actual payment, customer record or regulated deployment
is required.

DPF cases are restricted to verified, publishable material. Source changes, test
evidence, deployment evidence and operational acceptance are attributed
separately. A passing source test is never described as a successful production
recovery. A planned adapter is never described as an independently reproduced
implementation.

Each factual case entry should retain:

- Source commit and relevant artifact versions.
- Claim and intended scope.
- Observation date and environment.
- Evidence and assessor attribution.
- Known limitations, redactions and reproduction instructions.
- Permission or licensing basis for publication.

Illustrative pseudocode is labeled informative. Invented fixtures are labeled
synthetic. Simulation reports carry no conformance or qualification claim.

The NIST AI RMF is useful context for risk management and is explicitly voluntary.
The book will not infer a universal legal prohibition on AI-assisted development,
or universal compliance, from general guidance. Deployment-specific legal and
professional conclusions require their owning authority.
[NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework).

## Companion material and rights boundary

The companion material should contain the versioned requirements index, reference
contracts, positive and negative fixtures, adapter statements and reproducible
reports. Its availability and license must be approved independently of the prose
publishing agreement.

Proposed contract boundaries for review are:

- Book publication rights apply to the manuscript and specifically agreed illustrations.
- Existing repository material retains its applicable license and attribution.
- Normative standards, schemas, test vectors and reference code remain independently versioned and accessible under their approved terms.
- No exclusive grant to the standards, certification marks, trademarks or future contributions is implied.
- Third-party code, screenshots, logs, endorsements and contributor text require their own applicable permission or license.
- Neither the author nor publisher is represented as a certification or accreditation body by publishing the book.

These are negotiating positions for review, not an executed rights arrangement.
This packet has not performed a legal rights review or obtained third-party
case-study releases. Any proposed use of confidential logs, identifiable people,
customer data or third-party screenshots is excluded until its permission basis
has been established.

## Delivery schedule and submission boundary

The proposed near-term packet is the proposal, these two samples and a
case/evidence inventory prepared for the November 9–11 TBM discussions.
The event does not become a full-manuscript deadline.

A full manuscript schedule is proposed relative to an agreed start and confirmed
author capacity:

| Period | Proposed delivery |
|---|---|
| Weeks 1–4 | Freeze chapter scope, rights register, reviewed specifications and recurring fixtures. |
| Weeks 5–12 | Draft chapters 1–6; complete the first technical review of examples. |
| Weeks 13–20 | Draft chapters 7–12; obtain target-specific adapter and assurance reviews. |
| Weeks 21–24 | Integrate editorial feedback; reproduce examples against pinned versions. |
| Weeks 25–28 | Complete permissions, citations, accessibility and final technical corrections. |

A disputed or unsupported claim is narrowed or removed rather than held out as
an expected result.

Mark Bodman's professional biography, affiliations and permitted institutional
descriptions need author confirmation before publisher submission. Sales forecasts,
endorsements and audience-size claims are omitted because verified figures are
not available.

No publisher has been contacted through this deliverable. Any submission,
interview, endorsement request or contract negotiation requires explicit
authorization.
