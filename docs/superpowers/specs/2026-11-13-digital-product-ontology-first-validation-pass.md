# Digital Product ontology: first validation pass

**Date:** 2026-11-13  
**Status:** Research assessment; proposed CSDM 6 contribution, not an adopted CSDM requirement  
**Scope:** The March 2026 ontology proposal and validation design, read against the current DPF Portfolio Aligned Agent and Workforce (PAAW) candidate standard. This assesses documented semantics. It does not certify runtime behavior or external framework conformance.

## Decision on the earlier design

The March validation design was an agreed test plan, not a completed validation. Its starter rows had no scored verdicts or gap register. The current PAAW candidate also supersedes a central assumption of the March proposal: `BusinessProduct` is the unit of business value; `DigitalProduct` is the linked identity whose offered outcome essentially depends on software. Portfolio decomposition remains a versioned parameter, currently four portfolios. AI coworker product identity and performer identity are linked but distinct.

A CSDM 6 proposal can still make Digital Product first class. Its ontology must preserve the BusinessProduct and DigitalProduct distinction, including non-digital and hybrid offerings, and state which claims are proposed additions rather than current CSDM behavior.

## Method and verdicts

Four checks are used: **R** representable in the documented meta-model; **C** required facts capturable with stated identity, provenance and timing; **O** bounded analysis or operation specified and demonstrated; **I** exchange mapping defined and tested. `P` means the written design supports the check; `?` means evidence or a rule is missing; `F` means the stated structure conflicts with the use case. A row passes only with four `P` scores. **No runtime traversal or import/export was executed in this assessment**; an `O` or `I` score of `?` is an evidence gap, not proof of a broken implementation.

| IT4IT scenario or stress test | Minimum governed path and creation data | R | C | O | I | Finding |
| --- | --- | :---: | :---: | :---: | :---: | --- |
| Evaluate: rationalize investments | BusinessProduct -> DigitalProduct -> portfolio/archetype -> capability -> allocation; stable IDs, allocation basis, effective dates | ? | ? | ? | ? | March product-only anchor needs PAAW business product and cost semantics |
| Explore: refine requirement | outcome/requirement -> conceptual product -> logical capability/design -> accountable actor; stage IDs, version and rationale | P | ? | ? | ? | Refinement exists in prose; cardinality, provenance and actor resolution are unspecified |
| Integrate: assemble release | DigitalProduct -> Product Release -> build units/SBOM -> acceptance evidence; digest, version, approval, time | P | ? | ? | ? | Require immutable release composition and provenance before blast-radius claims |
| Deploy: change actual instance | accepted release -> desired/actual instance -> environment/resource -> validation/rollback; deployment identity and timestamps | P | ? | ? | ? | Separate deployed instance from product and record observed versus desired state |
| Release: publish offer | BusinessProduct -> Offering -> Service Offer -> eligible Product Release; terms, consumer scope, version and publication time | ? | ? | ? | ? | Do not equate IT4IT Product Release with Service Offer publication |
| Consume: fulfill offer | offer -> subscription/entitlement -> actor cohort or named identity -> actual instance; validity and tenant scope | P | ? | ? | ? | Actor-to-persona-to-identity refinement needs typed population and entitlement links |
| Operate: incident impact | observed event -> actual instance/resource -> product -> offer -> affected subscription/consumer; observation and confidence | P | ? | ? | ? | Generic dependency edges cannot establish customer impact |
| M&A and divestiture | business product -> legal owner, contracts, information obligations, shared dependencies; effective dates and separation boundary | ? | ? | ? | ? | BusinessProduct is essential; shared resources cannot imply automatic transfer |
| Vulnerable package version | package **version** -> SBOM/build -> deployed instance -> product -> live offer/subscription; observed inventory and time | P | ? | ? | ? | Require version identity and deployment evidence; a library on a server alone is insufficient |
| Information governance and audit | information object -> classification/obligation -> control -> implemented control -> dated evidence; jurisdiction, retention, owner | P | ? | ? | ? | Policy applicability and evidence freshness must be typed, not inferred from connectivity |
| AI coworker authority | coworker product -> performer identity -> job qualification -> delegated authority -> action -> evidence -> human supervisor | P | ? | ? | ? | PAAW requires distinct product and performer identities; RBAC alone does not prove authority |
| Architecture to operations | conceptual actor/product -> logical persona/component -> actual population/instance -> evidence; refinement type and lineage | P | ? | ? | ? | The March one-way rule needs explicit identity versus realization relationships |

All rows remain **partial**, since no row has demonstrated all four checks. This is a documented-model assessment; it is deliberately not a claim that the live graph fails every use case.

## Typed analysis patterns

A traversal definition must declare its starting type and version, permitted edge sequence and direction, concept/logical/actual stage changes, scope and time window, stop condition, exclusions, and evidence needed before an impact claim is promoted from possible to confirmed.

| Pattern | Allowed reasoning | Exclude |
| --- | --- | --- |
| Vulnerability | Match exact package/version and build composition, then deployed instances valid at the observation time, then served offers and active consumers | Package name only; unused build artifacts; any customer linked to a shared platform |
| Change impact | Changed actual resource -> observed or declared dependency -> serving product instance -> published offer -> active consumer | Unlimited dependency closure; conceptual dependency treated as observed outage |
| Audit | Information classification -> applicable obligation in jurisdiction/time -> implemented control -> required evidence with provenance and freshness | Arbitrary path to a document labeled evidence |
| Divestiture | Product and legal boundary -> owned assets/contracts/data; classify shared dependencies separately; identify retained obligations | Assuming a shared platform or copied data transfers with the product |
| AI authority | Performer identity -> qualified job -> delegated authority ceiling -> scoped grant -> action/evidence -> accountable human | Equating product ownership, qualification, service account and permission |

These are proposed query contracts. They need executable examples and counterexamples before publication as conformance rules.

## Governed data obligations

At creation or discovery, every governed record needs a stable identifier, source system, recorded time, effective time where different, owner or unresolved-owner state, lifecycle state, and confidence/provenance. Every relationship needs a named type, direction, source, validity interval and stage. Product-to-business-product, product-to-offer, package-to-build, build-to-release, release-to-instance, instance-to-resource, and offer-to-consumer links need distinct identities. Regulatory assertions additionally need jurisdiction, applicability reason, evidence due time and retention. Automated ingestion may fill these fields, but missing facts must remain explicit unknowns.

Minimum adoption can begin with product identity, portfolio placement and accountable owner. A maturity profile may require additional links for a named analysis claim. An incomplete profile must not advertise customer blast-radius, audit readiness or interchange conformance.

## Framework mapping and influence inventory

| Native approach | Shared meaning | Disparity that must survive mapping | Influence or exchange opportunity |
| --- | --- | --- | --- |
| CSDM 5 | service/application/CI and lifecycle structure | sold product and product-to-business-value identity need explicit treatment | propose CSDM 6 Digital Product and typed realization/offer links |
| IT4IT 3.0.1 | digital product lifecycle, value streams, releases, offers | functional criteria do not automatically prove an implementation graph | attach durable IDs and evidence contracts to each value-stream handoff |
| PAAW candidate | business product, portfolio, archetype, digital identity, workforce | newer BusinessProduct framing supersedes March product-only language | make this the current internal mapping baseline |
| ArchiMate/TOGAF | architecture viewpoints, actors, requirements and realization | viewpoint element is not an operational identity or observed instance | preserve viewpoint semantics and test ArchiMate model exchange with explicit transformation rules |
| ITIL 5 | product/service management vocabulary | practice guidance does not itself specify this ontology's graph paths | validate the exact edition and terms before claiming direct equivalence |
| COBIT | governance objectives and accountability | control objective differs from implemented control and evidence | trace objective -> applicable obligation -> implementation -> proof |
| DORA | operational resilience and evidence | jurisdictional legal obligations are not universal ontology defaults | record applicability, deadline, reporting scope and evidence provenance |
| TBM/APQC | cost allocation; process/capability taxonomies | allocation and process membership are not product identity | import versioned taxonomy IDs and preserve cost allocation bases |
| TM Forum/BIAN | industry product-service-resource or service landscape distinctions | industry taxonomies and cardinalities differ | retain native IDs and sector profiles; avoid forced one-to-one mappings |

The seven transcript-backed CSDM v3 mapping videos are historical mapping evidence only. Exact current framework labels and exchange capabilities require verification against their current primary specifications. Import/export conformance needs a round-trip fixture: source ID, source version, target class, transform rule, loss classification, and re-export comparison.

## Gap register

| ID | Timing | Type | Required change | Acceptance evidence |
| --- | --- | --- | --- | --- |
| G1 | Now | Meta-model/refinement | Reconcile March DigitalProduct-first framing with PAAW BusinessProduct and software-dependent DigitalProduct; version portfolio cardinality | normative crosswalk, examples for digital, hybrid and physical offerings |
| G2 | Now | Ontology semantics | Define typed, time-bounded traversals and explicit possible versus confirmed impact | Log4j and server-change fixtures with negative paths |
| G3 | Now | Data-creation conformance | Define stable IDs, provenance, valid-time, source, missing-value behavior and relation direction | schema/profile validation fixtures |
| G4 | Now | Governance/evidence | Separate obligation, objective, implemented control and dated evidence; define AI qualification, grant and supervision links | audit and coworker authority fixtures with denied cases |
| G5 | Soon | Interoperability | Inventory ArchiMate exchange and other candidate formats; specify source version, transforms and loss policy | successful round-trip plus documented non-round-trippable case |
| G6 | Soon | Platform implementation | Bind IT4IT functional criteria to actual handoff objects and evidence across seven streams | executable end-to-end trace on a real product |
| G7 | Later | Communication | Publish framework-native mappings after current-edition primary-source review | SME review and source/version register |

## Outcome and next verification

This first pass resolves the research question at the documented-model level: the ontology has a useful category and refinement backbone, but it lacks the data contracts and bounded traversal rules required to assert precise enterprise impact. G1-G4 should be resolved before claiming normative conformance; G5-G6 require exchange and runtime fixtures. The March design remains a design input, not validation evidence.

Sources: [March ontology proposal](2026-03-21-csdm6-digital-product-metamodel-and-ontology-design.md), [March validation design](2026-03-26-csdm6-digital-product-ontology-validation-framework-mapping-and-analysis-patterns-design.md), [current PAAW candidate](../../architecture/four-portfolio-archetype-ai-workforce-operating-standard.md), and [framework playlist index](../../reference/framework-mapping-playlist/index.md).
