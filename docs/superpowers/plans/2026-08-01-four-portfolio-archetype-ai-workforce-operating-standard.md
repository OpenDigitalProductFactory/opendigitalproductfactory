# Four-Portfolio Archetype and AI Workforce Operating Standard — Implementation Plan

**Date:** 2026-08-01
**Status:** Publication verification in progress after technical hardening
**Backlog:** `BI-C7DFE0F5` under `EP-BOM-WIRING`
**Work Capsule:** `WC-1B88712B`
**Branch:** `doc/four-portfolio-archetype-and-ai-workforce-operat`
**Decision:** `DI-9A3D6BFF8507`
**Backlog coverage receipt:** `cmsarz1mq0qlk01qkrjg9vh4u` (`atomic`)

## Objective

Create an independently expressed DPF standard, comparable in analytical utility and requirement specificity to
IT4IT v3, that connects Mark Bodman's contributor-origin four-portfolio and DigitalProduct concepts to business goods and services, industry value
streams, human and non-human work, AI coworkers, jobs, skills, physical execution, controls,
evidence, and gap analysis across every implemented archetype.

The release must also position the standard as a candidate IT4IT profile or extension without:

- treating every business product as a `DigitalProduct`
- copying external published expression outside a source- and use-specific permission
- duplicating the archetype registry or the TAK/GAID/TAK-JSI standards family
- claiming external certification, endorsement, or standards-body status

## Scope and deliverables

1. Add a normative core standard at
   `docs/architecture/four-portfolio-archetype-ai-workforce-operating-standard.md`.
2. Add a composable industry profile catalog at
   `docs/architecture/four-portfolio-archetype-standard-profile-catalog.md`.
3. Refactor existing architecture documentation so the new standard is discoverable and stale
   DigitalProduct, IT4IT, value-stream, and workforce claims point to their canonical owners.
4. Record the standards research boundary, source versions, mapping semantics, and licensing rules.
5. Verify requirement coverage, links, archetype coverage, terminology, and documentation impact;
   obtain an independent semantic review before PR handoff.

These deliverables are one atomic standards release. The profile catalog cannot be interpreted
correctly without the core, and the core cannot demonstrate all-archetype applicability without the
catalog and convergence edits.

## Research baseline

### Admissible internal sources

- Mark Bodman's four-portfolio, AI-coworker, CSDM-pattern, and DPPM design direction plus his IT4IT
  Reference Architecture contribution attestation under `CA-MB-2026-08-01-IT4IT-PROVENANCE`
- the current DPF commercial catalog, portfolio registry, archetype registry, operational-value-stream
  projection, business-capability corpus, Principal/workforce substrate, and EA conformance substrate
- the TAK, GAID, and TAK-JSI standards family

### Public research sources

- The Open Group C24A and G252 public product pages, for bibliography and high-level scope
- The Open Group W205, for permitted conceptual lineage; Mark Bodman is one of two identified authors and its
  publication permission allows use for any purpose when copies retain the notices
- current Open Group Membership Terms, Standards Process/copyright and licensing pages, Mark
  Bodman's official member profile, and the technical-publications style guide for contributor,
  member, Material, author-credit, and public-provenance distinctions
- public ServiceNow CSDM documentation, resource/video catalog, and AI/AICT pages as
  `reference-only` SourceCitations, not content inputs
- official public pages for the external reference families below

### Source-rights control

The operator's attestation establishes contributor provenance and permits direct contributor-origin
statements to inform original DPF expression. It does not convert a compiled collective publication
into contributor-supplied material. The source/use-specific decisions, permitted-use scopes,
contributor-attestation boundary, independent-review trigger, and restricted artifact inventory are
defined once in Sections 13.1.1 and 20 of the standard. The C24A and G252 compiled artifacts remain
excluded from AI processing under complete prospective decisions; W205 and direct operator
statements have separate permitted decisions. Public ServiceNow pages are citation-only orientation.

### External reference families

- BACM and VDML for business/value semantics
- ArchiMate for architecture views and exchange
- BPMN, CMMN, and DMN for process, case, and decision execution
- NIST AI RMF and ISO/IEC 42001/23894 for AI governance and risk
- ISCO, ESCO, and O*NET for occupation and skill references
- ISA-95, GS1, and ISO 55000 for physical operations, traceability, and assets
- selected industry standards only through versioned archetype profiles

## Architecture decision

Four structures were compared through `principle_decide`:

| Option | Result |
|---|---|
| Patch existing documents only | Too fragmented for normative conformance or minute gap analysis |
| One monolithic standard | Complete but cognitively heavy and immediately drift-prone |
| Layered normative core plus composable profiles | **Selected** |
| Separate full standards per industry | Duplicative, expensive, and inconsistent |

The governed decision recommends the layered structure with high confidence, composite `10.993`,
and margin `3.413`. The strongest pulls were architecture over shortcuts, single source of truth,
research and use standards, and shipping usable functionality. No commandment conflict was found.

The later executable ontology/generator is an implementation evolution, not a prerequisite for this
documentation release. The standard will define the contract and identify the existing DPF substrate
that should implement it.

## Normative architecture to define

The standard will use six traceable resolution levels:

1. enterprise and ecosystem context
2. four-portfolio landscape and business products
3. operational value streams and stages
4. capabilities, work units, jobs, skills, performers, resources, controls, and evidence
5. implementation bindings, including DigitalProducts and IT4IT lifecycle mappings
6. runtime occurrences, measures, conformance evidence, and gaps

The required trace spine is:

```text
Organization → objective/outcome → business Product/Offer → operational value stream → stage
  → capability → work unit → allocation → performer/job/skill + resource
  → control/evidence/measure → gap → primary portfolio/backlog
```

A `DigitalProduct` joins through an explicit `constitutes`, `enables`, `operates`, or `depends-on`
relationship. An AI coworker has two linked aspects: a governed digital-product lifecycle and an
identity-bearing performer operating under GAID, TAK-JSI, and TAK.

## Work plan

### Phase 1 — Research and source control

- Verify the current 24-category/106-leaf archetype inventory from code.
- Capture the four-portfolio rules from contributor-attested operator direction and DPF's owned
  portfolio registry.
- Trace Mark Bodman's authenticated IT4IT Reference Architecture attestation, official public member
  profile, and current Open Group member-rights language; do not use restricted acknowledgement pages
  as admissible proof, and distinguish direct contributor-origin concepts from compiled Material.
- Use authorized public sources and source/use decisions for research; reserve precise IT4IT/DPPM
  published equivalence and conformance for an authorized edition and qualified human review.
- Register public ServiceNow CSDM/AICT pages and video links as reference-only orientation; use only
  the bounded direct operator statement and DPF-owned TAK/GAID/product/work semantics as design inputs.
- Build a source register with SourceUseDecision, version, authority, access, permitted-use scope,
  attestation, reviewer, and mapping status.
- Treat unpublished/operator-supplied material as informative evidence, not public consensus text.

### Phase 2 — Core standard

- Define scope, normative language, terminology, source-of-truth rules, and conformance claims.
- Define SourceUseDecision and ContributorAttestation records so contributor rights do not silently
  expand to a collective publication, another contributor, or another use.
- Define the original metamodel and relationship/cardinality invariants.
- Define four-portfolio placement and dependency rules for digital, physical, service, experience,
  access, entitlement, workforce, production, and foundational aspects.
- Define business value streams independently of IT4IT, then map explicit DigitalProduct touchpoints.
- Define work units, physical work, custody, capacity, human/AI/robot/partner allocation, and
  augmentation/substitution analysis.
- Define the AI-coworker dual role and an original TAK architecture diagram that acknowledges the
  public AICT/CSDM layer-separation inspiration without copying its artwork or data model.
- Define IT4IT, CSDM, architecture, workflow, AI governance, workforce, physical, and industry
  mapping semantics.
- Define normative requirement IDs, conformance profiles, evidence states, and gap records.

### Phase 3 — Archetype profile catalog

- Define reusable commercial, delivery, resource/custody, workforce, trust, digital-enablement,
  outcome, and terminology facets.
- Publish the 24 category baselines and account for all 106 implemented leaf identities/deltas as a
  dated, source-derived catalog; require generated complete manifests for implementation conformance.
- Define shared-versus-specific coworker rules and reusable coworker capability families.
- Include honest worked profile-composition specimens spanning physical/licensed service, regulated
  decision work, physical goods plus service, custody/logistics, public/member value, and a wholly
  digital product; unresolved specialized families remain implementation Gaps, not profile bindings.
- Record the current evidence baseline and quantified gaps without equating template existence to
  operational readiness.

### Phase 4 — Refactor and converge (20% allocation)

Reserve approximately one-fifth of the effort for convergence rather than net-new prose:

- supersede stale claims that every customer offer is a `DigitalProduct` or `ServiceOffering`
- remove the claim that a business operational value stream is merely IT4IT `Consume`
- distinguish IT4IT v3 value streams from legacy functional-group labels and industry stages
- connect the new standard to the TAK/GAID/TAK-JSI ownership map without duplicating their controls
- document the intended widening of Manufacturing and Delivery and Foundational portfolios
- identify, but do not prematurely implement, convergence of performer assignment, job/skill truth,
  product-realization links, and generic gap ledgers
- preserve current code and schema authorities; future typed implementation is routed as explicit gaps

### Phase 5 — Verification and handoff

- Run a requirement-by-requirement audit against the user request and backlog acceptance criteria.
- Retain source-use, contributor, and citation records as bounded provenance guardrails while
  prioritizing semantic, metamodel, profile, and executable-conformance verification.
- Verify all repository-relative links and referenced source paths.
- Check the 24/106 inventory mechanically against `ALL_ARCHETYPES`.
- Check normative key uniqueness, controlled vocabularies, profile coverage, and mapping language.
- Review diagrams for text alternatives, independent expression, and source acknowledgment.
- Run the applicable documentation and source-local gates; report any skipped runtime gates honestly.
- Obtain an independent architecture/semantic review and address actionable findings.
- Commit with DCO, push, open a ready PR, run mechanical PR health, and record capsule/backlog evidence.

## Acceptance criteria

- The standard distinguishes business Product, Offering, DigitalProduct, service, asset, performer,
  job, role, skill, capability, work, and value stream.
- The four portfolios cover goods, services, digital products, workforce, physical/non-digital
  production and delivery, and shared foundations without double counting.
- AI coworkers are represented simultaneously as managed DigitalProducts and governed performers.
- Human/AI synergy and substitution are defined at work-unit granularity with accountability,
  qualification, authority, fallback, and evidence.
- Business operational value streams remain independent from IT4IT; mappings are explicit and
  limited to relevant DigitalProduct lifecycle touchpoints.
- Every implemented archetype identity/delta is covered by a composable profile method and dated
  catalog; the standard defines the complete manifest contract without claiming current realization.
- Shared and industry-specific coworkers have a testable specialization rule.
- Physical tasks, locations, equipment, materials, custody, safety, and completion evidence are
  first-class.
- Conformance and gap analysis operate at minute detail without a misleading single score.
- External standards mappings are versioned, licensed appropriately, and do not imply endorsement.
- Contributor-origin inputs are traceable and permitted at source/use granularity; acknowledgement
  credit never silently authorizes collective expression, coauthor material, or external conformance.
- Existing DPF canonical sources are reused; documented refactors remove or flag parallel truths.

## Verification summary

- Rebased the topic branch onto current `origin/main` immediately before final verification; the
  exact base is retained by the commit graph and PR evidence rather than copied into this living plan.
- Reconciled all 24 canonical category files and all 106 unique `ALL_ARCHETYPES` leaf IDs with zero
  missing or extra catalog entries.
- Verified the 24 × 10 shared-coworker matrix (240 controlled cells), 34 unique leaf deviations, and
  zero inherited-state mismatches.
- Verified 193 unique and sequential `FPAW-*` requirements: 175 core-standard requirements and 18
  companion-catalog requirements.
- Regenerated the 612-page document index and 30-diagram manifest; document-index freshness,
  Mermaid freshness, 80-page user-guide link integrity, prose lint, and whitespace checks pass.
- Added a mandatory FPAW workspace guard with 42 regression tests, including adversarial IT4IT/CSDM
  mapping, cardinality, identity-boundary, and Markdown-content mutations; the repository
  preflight now includes 33 applicable guards.
- Independent semantic and conformance reviews are repeated against the exact committed tree before
  publication gates. This is not an
  adopted-standard claim, external IT4IT conformance statement, or R4/R5 implementation claim.
- Exact committed-tree gate, promotion, and PR evidence remain in the Work Capsule and PR rather
  than being copied into this plan.

## Documentation impact

This is an architecture and external-agent documentation change. It does not alter runtime behavior,
database schema, routes, or user-facing UI in this release. The standard will explicitly identify later
implementation work rather than representing conceptual mappings as implemented substrate.
