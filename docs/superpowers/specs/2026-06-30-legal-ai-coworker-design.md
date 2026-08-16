# Legal AI Coworker Design

**Date:** 2026-06-30  
**Status:** Draft for review  
**Work capsule:** WC-CEB6DF9B  
**Backlog epic:** EP-8E224C90  
**Owner:** DPF platform  
**Primary dogfood entity:** the operator DPF support and related services

## Summary

DPF should add a Legal Operations / Legal Counsel AI Coworker that helps operators prepare legal-impacting work products without pretending to be a lawyer. The coworker drafts, reviews, classifies, and assembles legal review packets for contracts, purchase agreements, licensing, MOUs, privacy/data documents, support terms, and archetype-specific legal readiness. It must be jurisdiction-aware, source-backed, and approval-gated.

The first slice should dogfood DPF and the operator: create the legal operating packet DPF needs before another business relies on it commercially. The architecture must generalize to customer installs, where business archetype, product type, supplier class, operating jurisdictions, selling jurisdictions, employment jurisdictions, and data-residency jurisdictions change the legal concern set.

## Current-State Findings

DPF already has several pieces this design should reuse:

- Source license exists: root `LICENSE`, `NOTICE`, `package.json`, and README declare Apache-2.0. The missing piece is not an open-source license; it is the commercial/legal operating packet for business use, support, services, hosted use, customer data, partner work, and supplier/customer agreements.
- Existing coworker substrate: `packages/db/data/agent_registry.json` already includes `AGT-905` (`licensing-specialist`) for archetype-aware licensing, permits, legality, posting obligations, and staff credential readiness.
- Existing profession corpus: `docs/professions/registry.json` already has a `legal-compliance` WSID family covering software licensing, AI regulatory compliance, GDPR/privacy, policy lifecycle, and jurisdiction-layered analysis.
- Existing corpus pages: `docs/professions/legal-compliance/wiki/` includes privacy, GDPR, CCPA, COPPA, EU AI Act, EU CADA, SPDX, and open-source license hygiene pages.
- Existing jurisdiction filtering: `apps/web/lib/decision-perspective/profession-corpus.ts` and `install-variant-context.ts` already model multi-dimensional regional context: operates-in, sells-to, employs-in, and data-residency.
- Existing document substrate: Workspace Managed Documents can hold maintained legal documents with lifecycle state, versions, references, and publication status.
- Existing supplier contract substrate: finance/provider work already has `SupplierContract`, `ContractAllowance`, and usage snapshot concepts.
- Existing licensing readiness substrate: `OrganizationLicenseProfile`, license records, and readiness issues already model authority-layer readiness.

Gap: DPF has legal-compliance and licensing readiness, but it does not yet have a bounded legal-document and legal-risk specialist that can produce structured review packets, template drafts, clause issue lists, and local-counsel escalation requests.

## Product Principle

The coworker is a legal operations specialist, not an autonomous lawyer.

It may:

- identify legal concern areas from facts, archetype, jurisdiction, product, supplier, and document type;
- draft templates and review packets for human/legal review;
- cite source-backed corpus pages and official sources;
- flag missing facts and local-counsel questions;
- maintain document lifecycle metadata and review status;
- compare a draft against a playbook or template checklist;
- produce negotiation issue lists and fallback positions when an approved playbook exists.

It must not:

- claim to provide final legal advice;
- represent that a document is enforceable, compliant, or ready to sign without human approval;
- choose a jurisdictional conclusion when facts or source coverage are missing;
- practice law for third parties or customers without an accountable human/legal workflow;
- silently use general model recall where source-backed legal corpus is required;
- publish, execute, or send legal documents without approval.

## Research and Benchmarking

### Standards and legal-AI guardrails

- ABA Formal Opinion 512 says lawyers using generative AI remain responsible for duties including competence, confidentiality, communication, candor, supervision, and fees. DPF should encode this as a supervised legal operations posture rather than a final-answer legal-advice posture. Source: [ABA Formal Opinion 512 announcement](https://www.americanbar.org/news/abanews/aba-news-archives/2024/07/aba-issues-first-ethics-guidance-ai-tools/).
- ABA Model Rule 5.5 is the unauthorized practice of law boundary. DPF should avoid product copy, prompts, and autonomous actions that imply the AI can practice law or make final legal determinations. Source: [ABA Model Rule 5.5](https://www.americanbar.org/groups/professional_responsibility/publications/model_rules_of_professional_conduct/rule_5_5_unauthorized_practice_of_law_multijurisdictional_practice_of_law/).
- NIST AI RMF frames trustworthy AI around characteristics such as validity, reliability, safety, security, accountability, transparency, explainability, privacy, and fairness. DPF should use this as the assurance shape for legal AI: source traceability, bounded autonomy, audit, and human escalation. Source: [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework).

### Open-source leaders

- **docassemble** is a free, open-source expert system for guided interviews and document assembly, using Python, YAML, and Markdown. Pattern to adopt: interview-first document automation with explicit variables and deterministic assembly, not freeform drafting alone. Source: [docassemble](https://docassemble.org/).
- **OpenLaw libraries** provide legal agreement protocol tooling and APIs around legal agreements. Pattern to adopt: contracts are structured artifacts with variables, state, and machine-readable metadata, not just blobs of generated prose. Source: [openlaw-core](https://github.com/openlawteam/openlaw-core), [openlaw-client](https://github.com/openlawteam/openlaw-client).
- **Open source legal-source MCP efforts** point toward grounded legal research against known source corpora. Pattern to adopt cautiously after tool evaluation: external legal-source connectors must pass DPF's tool evaluation pipeline before use; local corpus and official source links remain the first slice. Example reference: [OpenLaw MCP listing](https://mcpservers.org/servers/damankaur-dev/openlaw-mcp).

### Commercial leaders

- **Thomson Reuters CoCounsel** positions legal AI around authoritative content, research, drafting, document analysis, security, zero-retention provider calls, and organization-controlled retention. Patterns to adopt: authoritative content grounding, DMS integration, security posture, and retention controls. Source: [Thomson Reuters CoCounsel](https://www.thomsonreuters.com/en/cocounsel), [CoCounsel Legal](https://legal.thomsonreuters.com/en/products/cocounsel-legal).
- **Lexis+ with Protege** positions legal AI for drafting, research, analysis, transactional agreements, contracts, and legal-professional workflows over trusted LexisNexis content. Patterns to adopt: document drafting as a workflow, trusted-source grounding, and legal-standard task framing. Source: [Lexis+ with Protege](https://www.lexisnexis.com/en-us/products/lexis-plus-protege.page).

### Patterns adopted

- Source-backed drafting and review, not freeform legal answers.
- Guided intake before document drafting.
- Structured document variables, clauses, source citations, lifecycle state, and review packets.
- Retention, confidentiality, and audit controls as product features.
- Explicit human/legal review gates before publication, signature, or external delivery.

### Patterns rejected

- "AI lawyer" positioning.
- One global legal corpus without jurisdiction or archetype filtering.
- Treating a generated document as final because it was produced from a template.
- Adding a new legal document store when Managed Documents already exists.
- Adding a parallel jurisdiction model when BusinessContext already has operates/sells/employs/data-residency axes.

## Proposed Coworker Identity

Add a new specialist, tentatively:

- `agent_id`: `AGT-906`
- `agent_name`: `legal-operations-counsel`
- display name: `Legal Operations Counsel`
- tier: cross-cutting specialist
- value stream: cross-cutting
- profession family: initially `legal-compliance`, with a planned refactor to split `legal-operations` from compliance if the corpus grows beyond compliance and regulated-readiness work.
- human supervisor: `HR-000` or a future `Legal Owner` role; first slice can escalate to `HR-000`.
- HITL default: `0` or `1` depending on operation. Legal determinations and document publication require explicit approval.

This coworker should not replace `AGT-905` licensing specialist. The boundary:

- `licensing-specialist`: whether the business may operate in a jurisdiction/activity and what evidence/readiness gaps exist.
- `legal-operations-counsel`: legal documents, contract packets, terms, data/privacy addenda, review issues, clause checklists, and counsel escalation.

## Core Workflows

### 1. Legal Intake

The coworker gathers:

- organization/entity: DPF, the operator, customer org, supplier, partner, employee/contractor, customer;
- document type: support agreement, SaaS/customer terms, purchase agreement, MOU, DPA, privacy notice, vendor agreement, employment/contractor agreement, license notice, policy;
- archetype and product: software platform, professional services, public sector, healthcare, financial services, field service, retail, nonprofit, etc.;
- jurisdiction axes: operates-in, sells-to, employs-in, data-residency;
- parties, authority, signature posture, effective dates, money/data/IP/indemnity/security/termination terms;
- whether attorney review is required or already assigned.

Output: a `LegalWorkPacket` projection in the spec, likely implemented as Managed Document metadata plus Work Case / Attention Surface items rather than a new table in the first slice.

### 2. Draft Document

Given a known document type and intake, the coworker produces:

- template-based draft document in Managed Documents;
- variables used and missing variables;
- assumptions list;
- source-backed clause rationale where corpus exists;
- review checklist;
- local-counsel questions;
- "not ready to sign" status until approval.

### 3. Review Document

Given a draft/uploaded document, the coworker produces:

- document summary;
- material obligations;
- red flags;
- missing clauses;
- mismatches against approved playbook;
- jurisdiction/archetype risk notes;
- fallback/negotiation points where a playbook exists;
- counsel escalation packet.

### 4. Maintain Legal Operating Packet

For DPF and the operator first:

- Apache-2.0 source license posture and NOTICE review;
- the operator support/services agreement;
- DPF hosted-use/customer subscription terms;
- data processing addendum and privacy/security addendum outline;
- customer support SLA / support policy;
- partner MOU;
- vendor/purchase agreement checklist;
- IP/trademark/copyleft/attribution posture review.

### 5. Customer Archetype Legal Readiness

For later generalized installs:

- legal concern map by archetype category and exact archetype;
- jurisdiction-specific source/corpus slices;
- supplier/customer document needs based on product and commercial model;
- handoff to licensing readiness for permits/authority layers;
- handoff to compliance for regulatory obligations;
- handoff to finance for supplier contracts and billing terms.

## Corpus Strategy

### Baseline corpus

Expand `docs/professions/legal-compliance/` with legal operations pages:

- legal AI boundaries and UPL escalation;
- contract drafting is review-packet work;
- document lifecycle and signature readiness;
- source license vs commercial terms distinction;
- SaaS/customer terms issue map;
- support/services agreement issue map;
- DPA/privacy addendum issue map;
- MOU issue map;
- vendor purchase agreement issue map;
- IP ownership and contribution/license posture;
- jurisdiction-layered analysis page, because the registry currently lists this coverage but the page is not present.

### Corpus shape

Each corpus page should use existing WSID frontmatter:

- `professionJurisdiction`: global, us, eu, ca-us, etc.
- `professionJurisdictionBasis`: global, operating, selling, employing, data-residency.
- `professionArchetype`: universal or a specific archetype category.
- `professionCompetencyLevel`: foundational, practitioner, expert.
- `sources`: official/open or cite-by-reference licensed materials only.

### Customer-specific corpus

When a business setup identifies a local jurisdiction or archetype, the coworker should:

- retrieve baseline pages first;
- identify missing local sources;
- create draft source/material candidates rather than publishing them;
- preserve source provenance;
- use owner/operator review before activating org-local legal material;
- never mutate platform baseline corpus with customer-only counsel advice.

## Data and Architecture

Reuse existing sources of truth:

- `Agent` / `agent_registry.json` for coworker identity and governance.
- `SkillDefinition` for legal quick actions.
- `PromptTemplate` for legal-operating prompt and safety boundary.
- `Managed Documents` for maintained documents, drafts, versions, references, and publication status.
- `BusinessContext` for jurisdiction axes.
- `StorefrontConfig.archetypeId` / archetype category for archetype filtering.
- `OrganizationLicenseProfile` for licensing/permit readiness.
- `SupplierContract` for supplier finance contract records.
- `DecisionPerspectiveProfile` / WSID for profession-scope grounding.
- `CoworkerActionEnvelope` / approval flows for side effects.
- `AttentionItem` / Work Case surfaces for "needs legal review" tasks when those surfaces are available.

Avoid in first slice:

- a separate legal DMS;
- a separate jurisdiction taxonomy;
- autonomous signature/send flows;
- external paid legal database integration before tool evaluation;
- long-form generated legal advice without citations.

## Skills

First slice skills:

- `legal-intake`: gather facts and produce a legal work packet.
- `draft-legal-document`: create a template-based draft in Managed Documents.
- `review-legal-document`: summarize and flag issues in an existing document.
- `prepare-counsel-packet`: assemble facts, source cites, questions, and draft for attorney review.
- `operator-legal-packet`: dogfood flow for DPF and the operator support/commercial readiness.
- `legal-corpus-gap`: create source/corpus gap proposals when jurisdiction/archetype coverage is missing.

Risk bands:

- Read/summarize: low to medium.
- Draft internal review packet: medium.
- Mark ready for signature, publish terms, send externally, or accept a counterparty revision: high/critical and approval-required.

## UX Design

The Legal Coworker should feel like a disciplined legal operations desk, not a chatbot bolted to a document list.

Surfaces:

- Workspace > Documents: legal document badges, lifecycle state, review status, source/citation status.
- Compliance > Licensing Readiness: handoff chips to Legal Ops when an operating-readiness gap implies a legal document or counsel question.
- Customer/Supplier/Finance surfaces: contract issue list and "prepare review packet" action.
- Platform/Setup: the operator/DPF legal operating packet checklist for the platform owner.

UI elements:

- concise legal readiness queue with document, party, jurisdiction, status, owner, next action;
- clause/issue table with severity, source, assumption, recommended action, and counsel-needed indicator;
- jurisdiction chips for operates-in/sells-to/employs-in/data-residency;
- source coverage meter: baseline, org-local draft, missing, stale;
- approval cards for publish/send/signature actions;
- empty states that say what fact is missing, not generic "no documents".

Design constraints:

- Use dense, professional, scan-friendly layout. Avoid marketing-style cards and oversized hero copy.
- Keep legal risk language precise: "needs review", "source missing", "draft only", "approved for use".
- Never bury the jurisdiction or document lifecycle status.
- Use theme tokens and existing document/workspace design patterns.

## Refactoring Allocation

Per user direction, reserve about 20 percent of the implementation budget for refactoring. Targeted refactors that directly serve this feature:

1. Split the current broad `legal-compliance` profession family conceptually into subdomains in the registry/checklist: compliance, legal operations, contracts, privacy/data, IP/licensing, and regulated-archetype readiness. This can remain one `professionKey` until usage proves a data split is needed.
2. Add or repair the missing `jurisdiction-layered-analysis` corpus page so the registry coverage checklist matches actual pages.
3. Consolidate legal document lifecycle metadata around Managed Documents instead of ad hoc document-status fields.
4. Define a shared `LegalReviewStatus` value set for prompts/UI even if the first slice stores it in document metadata.
5. Keep legal quick actions as skills rather than route-specific prompt branches.

## Security, Privacy, and Legal Risk

- Legal documents are confidential by default.
- Retrieval and generation must respect org boundaries.
- Source/corpus pages must be open, official, org-supplied, or cite-by-reference only.
- Uploads should be treated as sensitive documents and should not be used to train models.
- Any use of external legal research providers requires the Tool Evaluation Pipeline.
- Every material side effect writes audit evidence.
- The coworker should default to escalation when source coverage is missing, jurisdiction is unclear, or the action would affect rights/obligations.

## Open Questions

1. Who is the accountable human role for the operator legal work before a formal legal owner exists: HR-000, founder/operator, or an external counsel placeholder?
2. Should DPF ship default document templates, or only issue maps and checklist scaffolds until counsel approves templates?
3. Which jurisdictions should the first the operator packet assume? Current business context should be queried before implementation; do not hardcode from chat.
4. Should customer installs get this coworker enabled by default, or only after business setup captures regional scope?
5. What is the minimum legal packet required before DPF is offered commercially through the operator?

## Acceptance Criteria

The first implementation slice is complete when:

- A Legal Operations Counsel coworker identity exists with narrow grants and HITL posture.
- Legal quick-action skills exist for intake, draft, review, counsel packet, the operator packet, and corpus gap.
- WSID legal corpus includes legal-AI boundary, document drafting/review-packet, source-license-vs-commercial-terms, and jurisdiction-layered analysis pages.
- DPF and the operator legal packet checklist appears as a governed workflow, not loose documentation.
- Draft legal documents are Managed Documents with lifecycle/review metadata.
- Drafts clearly show assumptions, missing facts, source coverage, and counsel-needed status.
- No publish/send/signature action can occur without approval.
- Customer-facing generalized path uses BusinessContext jurisdiction axes and archetype filtering.
- Tests cover profession-corpus filtering, skill assignment/visibility, action envelope gating, and document metadata behavior.
- UX verification exercises the document/legal packet flow on a running portal or leased local-integration environment.

## Non-Goals

- Replacing licensed attorneys.
- Providing final legal opinions.
- Integrating Westlaw, LexisNexis, Practical Law, or other paid legal data in the first slice.
- Signing or sending legal documents autonomously.
- Building a full legal matter management system in the first slice.

## Implementation Phasing

### Phase 0: Spec and backlog

Create this design spec, file/align backlog items, and identify existing epics or create a new one only after live backlog overlap checks.

Backlog records:

- `EP-8E224C90`: Legal AI Coworker epic.
- `BI-97390B0C`: P0 the operator/DPF legal operating packet workflow foundation.
- `BI-62CECF8E`: P1 specialist identity, prompts, skills, and HITL/legal-risk envelope.
- `BI-AB87FA66`: P1 legal operations WSID corpus expansion and jurisdiction-layered analysis repair.
- `BI-23292DD5`: P2 managed legal document metadata and approval-gated review packets.
- `BI-D95D6CF2`: P3 customer archetype and jurisdiction generalization.

### Phase 1: Dogfood DPF and the operator

Add coworker identity, skills, corpus pages, legal packet checklist, Managed Document metadata, and safe draft/review flows for DPF and the operator.

### Phase 2: Generalize to customer installs

Use business setup, archetype, and regional profile to drive customer legal concern maps, corpus gaps, and review packets.

### Phase 3: Advanced legal operations

Add clause playbooks, negotiation issue tracking, local counsel assignments, document comparison, richer source ingestion, and optional evaluated legal-source connectors.

## Verification Plan

Source-local verification:

- targeted tests for profession corpus and variant filtering;
- seed/invariant tests for agent registry, skills, and corpus sources;
- document-store tests for legal metadata and references;
- action-envelope tests for high-risk legal actions.

Runtime verification:

- use the governed live-install or shared local-integration lease, not an ungoverned dev server;
- drive the the operator legal packet flow;
- create a draft document;
- review a draft;
- attempt a high-risk publish/send/signature action and confirm approval is required;
- verify audit evidence is recorded.

## Bootstrap Note

This spec was authored from the isolated worktree `D:/DPF-worktrees/legal-coworker` on branch `doc/legal-coworker`. `scripts/dpf-bootstrap-agent-toolchain.ps1` copied `.mcp.json` but failed before writing `.dpf-worktree-readiness.json` due to a JSON parse error at script line 206. This is a worktree bootstrap issue to record separately if it persists; it is not product evidence for the Legal Coworker feature.
