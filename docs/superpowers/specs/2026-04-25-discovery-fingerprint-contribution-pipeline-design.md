# Discovery Fingerprint Contribution Pipeline Design

**Date:** 2026-04-25  
**Status:** Proposed  
**Author:** OpenAI Codex with Mark Bodman direction  
**Epic:** Recommended new epic, separate from integration, site-location, and MSP archetype epics

## 1. Problem Statement

DPF already has a discovery attribution foundation: discovered infrastructure can carry taxonomy attribution metadata, low-confidence cases can surface as quality issues, and software normalization can synthesize deterministic rule candidates after heuristic matches are approved.

The remaining gap is the "hive mind" loop. When one install discovers an unknown or ambiguous device, service, software package, protocol signature, or infrastructure pattern, the platform should not keep relearning the same thing forever. Approved discoveries should become reusable project knowledge. When safe, generic, and redacted, they should also be eligible to contribute back into the repo so future installs recognize the same pattern deterministically.

This design defines the contribution pipeline for that loop:

1. preserve rich evidence locally
2. score device identity separately from taxonomy placement
3. auto-accept only high-confidence, low-risk cases
4. route ambiguous or sensitive cases to daily AI coworker triage and human review
5. convert approved observations into deterministic attribution rules
6. version, test, and ship repo-owned fingerprint catalogs
7. redact private estate details before any contribution leaves the install

## 2. Live Backlog Context

Per `AGENTS.md`, live backlog state was queried before recommending a new backlog track.

Live query succeeded against `dpf-postgres-1` on 2026-04-25. The open epics were:

- `EP-CTRL-5E21A4` - Automated Control Utility: Desktop QA and Remote Assist Foundation
- `EP-SITE-7C4D2B` - Customer Site Records & Location Validation
- `EP-LAB-6A91C2` - Integration Lab Sandbox & Private Connectivity Foundation
- `EP-INT-2E7C1A` - Integration Harness: Benchmarking and Private Deployment Foundation

No open discovery fingerprint, discovery contribution, or taxonomy attribution epic was present. This work should therefore be tracked as its own epic rather than folded into site-location, integration, or MSP archetype work.

## 3. Related Existing Designs

This design extends, rather than replaces, these repo designs:

- `docs/superpowers/specs/2026-03-14-discovery-taxonomy-attribution-design.md`
  - establishes deterministic-first taxonomy attribution, heuristic fallback, low-confidence quality issues, software evidence, software normalization, and rule-candidate synthesis
- `docs/superpowers/specs/2026-04-02-infrastructure-auto-discovery-design.md`
  - defines continuous discovery, high-confidence auto-promotion, exception queues, and a `0.90` promotion threshold for attributed inventory entities
- `docs/superpowers/specs/2026-04-14-taxonomy-to-action-v4-v5-design.md`
  - states that taxonomy must become an action model and explicitly support discovery attribution
- `docs/superpowers/specs/2026-04-23-it-service-provider-msp-archetype-design.md`
  - reinforces that customer-managed estate work needs reusable platform architecture, not customer-specific one-offs

Current schema and logic already include useful anchors:

- `InventoryEntity.attributionStatus`
- `InventoryEntity.attributionMethod`
- `InventoryEntity.attributionConfidence`
- `InventoryEntity.attributionEvidence`
- `InventoryEntity.candidateTaxonomy`
- `DiscoveredSoftwareEvidence`
- `SoftwareIdentity`
- software normalization rule candidates
- `PortfolioQualityIssue`
- `ToolExecution`
- `AgentActionProposal`
- `FeaturePack` contribution-review metadata, which is a useful precedent for repo contribution readiness

## 4. Research And Benchmarking

### 4.1 ServiceNow Discovery Patterns

ServiceNow ships Discovery and Service Mapping patterns through Store applications. The official docs describe monthly pattern updates, custom pattern creation for proprietary devices and applications, role separation for pattern administrators and viewers, and a development-instance to production-instance flow through update sets. ServiceNow also preserves upstream preconfigured patterns separately from customized copies; updates refresh the original pattern, not the customized copy.

Patterns to adopt:

- separate shipped catalog content from local customization
- test new patterns in a non-production environment before production use
- use explicit roles for pattern authors, viewers, and runtime interpreters
- ship vendor/platform pattern updates as versioned content
- preserve the upstream original when a customer customizes behavior

Patterns to reject:

- editing canonical shipped patterns in place
- letting local customizations silently block future upstream improvements

Sources:

- [ServiceNow Discovery and Service Mapping Patterns - Customization](https://www.servicenow.com/docs/r/zurich/it-operations-management/discovery-and-service-mapping-patterns/c_MappingPatternsCustomization.html)
- [ServiceNow Store release notes - ITOM patterns](https://www.servicenow.com/docs/r/store-release-notes/store-rn-itom-patterns.html)
- [ServiceNow Store release notes - ITOM Pattern Designer enhancements](https://www.servicenow.com/docs/r/store-release-notes/store-rn-itom-pattern-designer-enhancements.html)

### 4.2 BMC Discovery TKU And TPL Patterns

BMC Discovery uses Technology Knowledge Updates (TKUs), Extended Data Packs (EDPs), and custom TPL patterns. Its public content reference describes monthly TKU/EDP updates, pattern libraries that identify products and configurations, custom pattern authoring through TPL, and a Command/File Matrix that documents commands executed and files retrieved by patterns. Recent TKU release notes also show lifecycle, vulnerability, CPE, storage, cloud, and ServiceNow synchronization content as separately packaged knowledge.

Patterns to adopt:

- treat fingerprint knowledge as packageable content, not only database rows
- include evidence requirements for commands, files, protocols, and source collectors
- version catalogs and data packs separately from application code when useful
- record compatibility and catalog release notes
- support custom local patterns while keeping a path to generalized upstream rules

Patterns to reject:

- opaque recognition rules without evidence provenance
- contribution of a rule that cannot explain which signal caused recognition

Sources:

- [BMC Discovery Configipedia - Getting started](https://docs.bmc.com/xwiki/bin/view/IT-Operations-Management/Discovery/BMC-Discovery/Configipedia/Getting-started/)
- [BMC TKU 2026-Jan-1 release notes](https://docs.bmc.com/xwiki/bin/view/IT-Operations-Management/Discovery/BMC-Discovery/Configipedia/Technology-Knowledge-Updates-TKU/Schedule-and-Roadmap/Technology-Knowledge-Update-TKU-2026-Jan-1/)

### 4.3 Lansweeper And Fing Device Recognition

Lansweeper/Fing recognition emphasizes cross-protocol device fingerprinting. Public docs describe MAC address, DHCP fingerprint, User-Agent, UPnP, Bonjour/mDNS, NetBIOS, SNMP, passive scanning, AI/ML enrichment, and a curated device catalog with product, OS, brand, lifecycle, warranty, and documentation metadata.

Patterns to adopt:

- require multiple evidence families for high-confidence identity when possible
- separate raw observed signals from normalized device/product metadata
- support passive and credential-free evidence as useful but not always sufficient
- enrich recognized identities with lifecycle/support metadata later

Patterns to reject:

- treating MAC/OUI alone as definitive identity
- ignoring protocol-level evidence because it is not credentialed

Sources:

- [Lansweeper embedded device recognition](https://www.lansweeper.com/partners/technology-partners/embed/device-recognition/)
- [Lansweeper credential-free device recognition](https://www.lansweeper.com/product/features/it-network-discovery/credential-free-device-recognition/)

### 4.4 Nmap Unknown Fingerprint Submission

Nmap provides an explicit OS/service fingerprint and correction submission process. Its docs emphasize that unknown fingerprints and corrections improve a shared database, but they also warn contributors to be certain what is running before submitting corrections. The service-detection chapter also recommends updating to the latest version first, generating detailed evidence, submitting fingerprints as well as hand-written matches, and keeping custom-only probes local rather than pushing private signatures upstream.

Patterns to adopt:

- make unknown fingerprint submission an explicit review flow
- submit evidence plus proposed match rules, not only the rule
- require certainty and correction paths
- keep custom-only private services local
- use local catalogs first when global contribution is unsafe or too specific

Patterns to reject:

- contributing private service banners or environment-specific probes upstream
- accepting corrections without operator certainty or supporting evidence

Sources:

- [Nmap submit unknown fingerprints](https://nmap.org/submit/)
- [Nmap service-detection community submissions](https://nmap.org/book/vscan-community.html)
- [Nmap OS-detection fingerprint format](https://nmap.org/book/osdetect-fingerprint-format.html)
- [Nmap fingerprint-strings NSE script](https://nmap.org/nsedoc/scripts/fingerprint-strings.html)

## 5. Design Goals

1. Preserve discovery evidence in an auditable, privacy-aware shape.
2. Score device or software identity separately from taxonomy placement.
3. Automatically apply high-confidence identity and taxonomy placement when evidence is strong.
4. Route low-confidence, missing-evidence, sensitive, or ambiguous cases to human review.
5. Let AI coworkers run daily triage without silently changing durable catalog knowledge.
6. Convert approved observations into deterministic attribution rules.
7. Version, test, and ship repo-owned fingerprint catalogs for future installs.
8. Support local-only custom recognition for private/proprietary services.
9. Contribute only redacted, generic, reusable fingerprints back to the project.
10. Keep internal company infrastructure and customer-managed estate recognition separable.

## 6. Non-Goals

- Implementing the code in this design
- Auto-contributing any fingerprint to GitHub without human approval
- Replacing existing discovery attribution or software normalization modules
- Making every discovered component a Digital Product
- Shipping a full BMC/ServiceNow style pattern language in the first slice
- Sending raw customer inventory or network evidence outside the install
- Solving all MSP/customer-estate discovery modeling in this spec

## 7. Recommended Approach

Adopt a hybrid catalog contribution pipeline:

```text
collector evidence
  -> fingerprint observation
  -> identity scoring
  -> taxonomy scoring
  -> policy gate
  -> auto-accept or review queue
  -> approved deterministic rule
  -> local catalog
  -> redacted contribution candidate
  -> repo catalog PR
```

This approach fits the existing DPF design direction:

- deterministic rules remain the durable operational path
- heuristics and AI help propose mappings, but do not become the long-term source of truth
- low-confidence output becomes managed quality work
- approved local improvements can become shared platform knowledge

## 8. Fingerprint Evidence Schema

Add a logical `DiscoveryFingerprintObservation` concept. The first implementation may use new Prisma models or a carefully structured JSON field, but the design should target first-class persistence because review, redaction, catalog promotion, and audit all need durable state.

Recommended fields:

| Field | Purpose |
| --- | --- |
| `observationKey` | Stable hash of normalized non-private evidence, collector, and signal class |
| `inventoryEntityId` | Link to the local discovered entity when known |
| `discoveryRunId` | Link to the run that observed it |
| `sourceKind` | `host`, `docker`, `prometheus`, `snmp`, `nmap`, `mdns`, `dhcp`, `http`, `upnp`, `netbios`, `manual`, etc. |
| `signalClass` | `service_banner`, `mac_oui`, `dhcp_fingerprint`, `snmp_sysobjectid`, `http_header`, `user_agent`, `package_name`, `process_name`, etc. |
| `protocol` | Protocol or collection mechanism |
| `rawEvidenceLocal` | Local-only raw evidence, encrypted or access-controlled where needed |
| `normalizedEvidence` | Redacted, canonicalized signal used for matching |
| `redactionStatus` | `not_required`, `redacted`, `blocked_sensitive`, `needs_review` |
| `identityCandidates` | Ranked candidate products/devices/software identities |
| `taxonomyCandidates` | Ranked taxonomy candidates |
| `identityConfidence` | Confidence that the thing is what the platform thinks it is |
| `taxonomyConfidence` | Confidence that it belongs in the proposed taxonomy location |
| `evidenceFamilies` | Distinct signal families supporting the conclusion |
| `candidateMargin` | Gap between top candidate and next candidate |
| `decisionStatus` | `pending`, `auto_accepted`, `needs_review`, `accepted`, `rejected`, `local_only`, `contributed` |
| `reviewReason` | Why the policy gate routed the observation to review |
| `approvedRuleId` | Link to deterministic rule once accepted |
| `createdAt` / `lastSeenAt` | Observation lifecycle |

Evidence family examples:

- network protocol: SNMP, mDNS, DHCP, HTTP, TLS, SMB, NetBIOS, UPnP
- runtime: container image, process name, package manager, open port
- catalog: known vendor/product alias, CPE, lifecycle catalog
- topology: monitored-by, runs-on, connects-to, site/customer scope
- human: manual confirmation, vendor docs, operator note

## 9. Confidence Scoring

Use two independent confidence scores:

### Identity confidence

Answers: "What is this thing?"

Examples:

- `Ubiquiti UniFi AP AC Pro`
- `PostgreSQL`
- `OpenSearch`
- `Prometheus node exporter`
- `Custom internal telemetry forwarder`

Signals that increase identity confidence:

- deterministic catalog rule match
- unique SNMP OID plus vendor/product metadata
- package/image/process name with known alias
- service banner with known version pattern after redaction
- multiple independent protocol families agreeing
- human confirmation

### Taxonomy confidence

Answers: "Where should this thing live in the DPF taxonomy/action model?"

Examples:

- `foundational/network_connectivity/...`
- `foundational/platform_services/observability_platform`
- customer-managed CI under an MSP customer estate domain
- local-only internal infrastructure dependency

Signals that increase taxonomy confidence:

- deterministic rule includes taxonomy placement
- product identity has an approved default taxonomy node
- collector context confirms internal vs customer estate
- route, account, site, or portfolio context is known
- taxonomy candidate margin is clear

This split prevents a common error: a device may be confidently identified but still ambiguous in operating context.

## 10. Threshold Policy

### Blast radius classification

Auto-accept thresholds must scale with the operational blast radius of acting on the observation. A high-confidence identity match for a foundational internal log shipper is not the same risk as the same match for a customer-facing payment gateway. A flat threshold misprices both directions: too lax for revenue-path entities, too strict for benign internal infrastructure.

Blast radius is computed per observation from several inputs, none of which is sufficient alone. Initial triage walks these inputs in order and short-circuits as soon as a strong customer-impact signal is found.

Inputs to blast radius scoring:

- **Taxonomy placement** of the candidate entity. `products-sold/*` and other revenue-path subtrees score higher than `foundational/*` or internal observability. Mixed cases - a foundational service that a customer-facing product depends on - inherit the higher tier transitively.
- **Network placement** from collector context. Edge, DMZ, and customer-facing ingress zones score higher than private-management or OOB-only zones. Unknown zone is treated conservatively as `medium`.
- **Entity type and role** from identity scoring. Load balancers, primary databases, identity providers, payment gateways, and signed-traffic ingress score higher than ephemeral log shippers, dev jumpboxes, and internal exporters.
- **Topology dependents**. Entities with many `runs-on`, `monitored-by`, or `depends-on` edges from customer-facing services score higher.
- **SLA / customer linkage**. Entities tied to an active Service, Site, or Customer record with a defined SLA score higher than unlinked ones.
- **Active-change context**. Entities currently under a change window or recently associated with an incident temporarily score one tier higher.

Output a tier per observation:

- `low` - internal foundational; no customer-facing dependents; no SLA linkage
- `medium` - internal but has dependents reaching `products-sold`, or moderate SLA exposure, or unknown context
- `high` - directly customer-facing or one hop from a `products-sold` revenue path
- `customer-critical` - payment, identity, signed-traffic ingress, or named in an active customer SLA

The tier is cached on the observation and recomputed when topology, taxonomy placement, or SLA linkage changes. Auto-accept must read the *current* tier, not the tier at original observation time.

#### Open questions for the research slice

These are not settled in this spec - they should be resolved through investigation against the live install before the auto-accept gate ships:

- the canonical list of taxonomy paths that imply customer-facing impact, likely derivable from IT4IT value-stream alignment plus the `products-sold` subtree
- the source for network-zone classification when topology metadata is sparse, and the conservative fallback when zone is unknown
- whether SLA linkage is read from existing service-contract data or inferred from monitoring policy until contracts are modeled
- the rollout strategy for `high` tier: dry-run only, sample-N-entities, or gradual percentage activation
- whether `customer-critical` is ever eligible for auto-accept, even on a deterministic catalog match - the conservative default is no
- how decay-of-context applies (an entity demoted from `high` to `medium` because dependents were retired should not retroactively reopen prior auto-accept decisions)

### Automatic acceptance

Automatically apply identity and taxonomy placement only when all conditions are true. Confidence thresholds scale with the blast radius tier:

| Blast radius | Identity confidence | Taxonomy confidence | Margin | Rollout |
| --- | --- | --- | --- | --- |
| `low` | `>= 0.95` | `>= 0.85` | `>= 0.10` | direct |
| `medium` | `>= 0.97` | `>= 0.90` | `>= 0.15` | direct |
| `high` | `>= 0.99` | `>= 0.95` | `>= 0.20` | dry-run-first against a sample, then activate |
| `customer-critical` | always route to human review | always route to human review | always route to human review | human approval required regardless of confidence |

Independent of tier, all of these must also hold:

- a deterministic approved rule matched, or identity confidence meets the tier threshold
- at least two evidence families support the identity, unless the rule is deterministic and trusted
- redaction status is not `blocked_sensitive`
- no internal-vs-customer-estate ambiguity exists
- no conflicting existing manual decision exists
- no candidate maps to a deprecated taxonomy node
- activation would not re-attribute more existing entities than the rollout cap for the tier

Automatic acceptance should:

- update `InventoryEntity` attribution fields
- attach the evidence summary
- write an audit event that records the blast radius tier used at decision time
- create or update a deterministic rule only when the source rule lifecycle allows it
- respect the rollout cap for the rule's tier before broad activation
- avoid repo contribution until separate contribution review approves it

### Human review

Route to review when any condition is true:

- identity confidence is `0.70` to `0.96`
- taxonomy confidence is `0.55` to `0.89`
- candidate margin is below `0.15`
- only one weak evidence family is present
- raw evidence contains private strings, banners, hostnames, serials, domains, or customer names
- the identity is proprietary or local-only
- identity and taxonomy decisions disagree
- the same observation generated different outcomes across runs
- blast radius is `customer-critical` (always)
- blast radius is `high` and the rule has not yet been dry-run-validated against a representative sample
- activation would re-attribute more existing entities than the rollout cap for the tier
- blast radius classification itself is unresolved (e.g., topology metadata missing for an entity that may be customer-facing)

### Unresolved / gather more evidence

Keep unresolved when:

- identity confidence is below `0.70`
- taxonomy confidence is below `0.55`
- no useful normalized evidence exists
- redaction cannot produce a useful generic signature

The daily coworker should ask for more evidence rather than guessing.

## 11. Review Queue And Daily AI Coworker Triage

The daily AI coworker should run a scheduled triage pass over observations from the prior day.

Responsibilities:

1. group duplicate or near-duplicate observations
2. summarize evidence families and candidate rankings
3. identify missing evidence needed for acceptance
4. propose one of:
   - auto-accept candidate
   - human review required
   - local-only rule
   - reject as noise
   - gather more evidence
5. draft deterministic rule candidates for accepted observations
6. draft redacted contribution candidates when broadly reusable
7. escalate sensitive or ambiguous cases to humans

Escalation rules:

- human approval required for any repo contribution
- human approval required for local-only proprietary signatures
- human approval required when raw evidence includes private network or customer data
- human approval required when a rule would change existing attributed entities
- human approval required when a taxonomy placement crosses internal/customer estate boundaries

The coworker should be allowed to prepare work, not silently ship catalog changes.

## 12. Privacy And Redaction Rules

Before a fingerprint can become a contribution candidate, it must pass redaction.

Always remove or hash:

- hostnames
- IP addresses
- MAC addresses
- serial numbers
- customer names
- employee names
- internal DNS suffixes
- local URLs
- tenant/account identifiers
- certificate subjects tied to the organization
- bearer tokens, API keys, cookies, and secrets
- file paths that reveal user or customer names
- banners containing environment names such as `prod-acme-sql-01`

Allowed in repo contribution artifacts when useful:

- vendor names
- product names
- public model names
- public SNMP OIDs
- public package names
- public container image names
- public port/protocol hints
- generic regex patterns that avoid private literals
- CPE or lifecycle identifiers
- evidence-family requirements

Contribution readiness statuses:

- `not_reusable` - private or one-off; keep local
- `needs_redaction` - useful but not safe yet
- `redacted_ready` - safe contribution candidate
- `blocked_sensitive` - must never leave the install
- `already_cataloged` - no new contribution needed

## 13. Deterministic Rule Model

Approved observations should become deterministic attribution rules.

Recommended logical model: `DiscoveryFingerprintRule`

| Field | Purpose |
| --- | --- |
| `ruleKey` | Stable catalog key |
| `catalogVersion` | Version of the catalog that introduced or last changed it |
| `status` | `draft`, `active`, `deprecated`, `local_only`, `blocked` |
| `scope` | `global`, `vertical`, `install_local`, `customer_estate`, `internal_estate` |
| `matchExpression` | Structured matcher, not freeform code in the first slice |
| `requiredEvidenceFamilies` | Evidence families required to fire |
| `excludedSignals` | Guardrails to avoid false positives |
| `resolvedIdentity` | Product/device/software identity |
| `taxonomyNodeId` | Default taxonomy placement when context permits |
| `identityConfidence` | Confidence assigned by the rule |
| `taxonomyConfidence` | Confidence assigned by the rule |
| `sourceObservationIds` | Observations used to justify the rule |
| `source` | `repo_catalog`, `approved_local`, `approved_ai_assist`, `manual`, `vendor_import` |
| `redactionReport` | Proof that contribution content is safe |
| `tests` | Fixture references expected to match or not match |

First-slice matcher types should be bounded:

- exact normalized string match
- contains match
- anchored regex match with review
- SNMP OID prefix/exact match
- package/container/process alias
- multi-signal AND/OR clauses

Avoid arbitrary executable pattern code in the first slice. A future pattern-language design can come later once the deterministic catalog proves useful.

## 14. Repo-Owned Catalogs

Repo-owned catalogs should live under a path such as:

```text
packages/db/data/discovery_fingerprints/
  catalog.json
  rules/
    foundational-observability.json
    network-devices.json
    software-identities.json
  fixtures/
    positive/
    negative/
  changelog.md
```

Catalog files should include:

- semantic catalog version
- schema version
- rule keys
- owner/source metadata
- match expressions
- expected identity and taxonomy results
- redaction status
- fixture references
- deprecation/supersession metadata

Required tests before shipping a catalog change:

- schema validation
- positive fixture match
- negative fixture non-match
- no private tokens or local identifiers
- no duplicate rule keys
- no ambiguous top candidate for fixture set
- no deprecated taxonomy node references
- no unexpected change to existing fixture outcomes unless explicitly approved

This mirrors the strongest lessons from ServiceNow and BMC: content updates must be versioned, testable, and separate from ad hoc local customization.

## 15. Audit And Activity Log Requirements

Every important step must be auditable:

- observation created
- redaction performed
- identity scored
- taxonomy scored
- auto-accept applied
- review queued
- reviewer accepted/rejected
- local-only rule created
- deterministic rule activated
- contribution candidate generated
- PR created
- catalog imported or upgraded

Existing `ToolExecution` should record coworker/tool actions. `PortfolioQualityIssue` should continue to surface unresolved attribution work. A dedicated fingerprint audit trail should capture catalog-specific lifecycle events because catalog changes affect future installs and need stronger provenance than a generic quality issue.

Audit records should include:

- actor type: system, AI coworker, human
- actor id when available
- previous decision and new decision
- observation/rule ids
- confidence scores
- redaction status
- reason code
- timestamp
- source run id
- affected inventory entity ids when applicable

## 16. Contribution Pipeline

Contribution should be explicit and reviewable:

1. local observation is accepted
2. deterministic rule candidate is generated
3. redaction report is created
4. coworker marks candidate as `redacted_ready` or `local_only`
5. human approves contribution
6. repo catalog patch is generated
7. catalog tests run
8. PR is opened against `main`
9. CI and human review decide whether the rule joins the shared catalog

The contribution artifact should include:

- redacted rule JSON
- fixture observations with private data removed
- a concise rationale
- source categories, not raw install details
- test cases proving match and non-match behavior

## 17. Data Model Stewardship

This design should not overload `InventoryEntity` with all fingerprint lifecycle detail. `InventoryEntity` should continue to store the current attribution result. Fingerprint observations and rules should store the evidence and rule lifecycle.

Recommended model boundaries:

- `InventoryEntity`: current operational entity and final attribution state
- `DiscoveryFingerprintObservation`: observed evidence and candidate scoring
- `DiscoveryFingerprintReview`: human/AI decision workflow
- `DiscoveryFingerprintRule`: deterministic reusable attribution rule
- `DiscoveryFingerprintCatalogVersion`: imported repo catalog version and upgrade history
- `PortfolioQualityIssue`: unresolved quality work surfaced to operators
- `ToolExecution`: coworker/tool action audit

This separation keeps runtime truth, evidence, and catalog knowledge from collapsing into one table.

## 18. UI And UX Direction

No UI should be implemented yet, but the eventual review surface should be designed as an operator work queue, not a raw JSON editor.

Recommended surface:

- route family: inventory/discovery review area, probably adjacent to `/inventory`
- queue tabs: `Needs identity`, `Needs taxonomy`, `Sensitive`, `Local-only`, `Contribution-ready`
- each row shows entity, source, evidence families, identity confidence, taxonomy confidence, candidate margin, and reason for review
- detail view shows evidence summary, redaction preview, candidate choices, deterministic rule preview, and affected-entity impact
- advanced raw evidence remains behind disclosure and permission controls

Theme-aware styling from `AGENTS.md` and `docs/platform-usability-standards.md` must apply when UI is later implemented.

## 19. Backlog Recommendation

Create a new epic:

`EP-DISC-FP - Discovery Fingerprint Contribution Pipeline`

Recommended backlog items:

1. `BI-DISC-FP-001` - Define fingerprint observation, review, rule, and catalog schema
   - Include redaction status, identity confidence, taxonomy confidence, evidence families, and audit references.

2. `BI-DISC-FP-002` - Add deterministic fingerprint rule evaluator with fixture-based tests
   - Keep matcher types bounded to exact, contains, regex, SNMP OID, package/image/process aliases, and multi-signal clauses.

3. `BI-DISC-FP-003` - Add daily AI coworker triage design and proposal workflow
   - The coworker can group observations, propose decisions, and draft rules, but human approval gates contribution.

4. `BI-DISC-FP-004` - Add redaction and contribution-readiness pipeline
   - Ensure raw private evidence stays local and contribution artifacts are safe.

5. `BI-DISC-FP-005` - Add repo-owned fingerprint catalog format and catalog test suite
   - Include schema validation, fixture match/non-match tests, privacy scans, and taxonomy reference validation.

6. `BI-DISC-FP-006` - Add contribution-back PR generation for approved catalog candidates
   - Generate a small PR-ready patch, rationale, fixtures, and test output.

Keep this epic separate from:

- `EP-SITE-7C4D2B`, which owns customer site and location records
- `EP-INT-2E7C1A`, which owns integration benchmarking and private deployment foundations
- `EP-LAB-6A91C2`, which owns integration lab sandbox connectivity
- MSP archetype work, which may later consume fingerprint results for customer-managed estates

## 20. Testing Strategy

First implementation slice tests:

- observation schema accepts multi-family evidence
- redaction removes private literals and blocks unsafe evidence
- identity confidence and taxonomy confidence are computed separately
- threshold gate auto-accepts only high-confidence safe observations
- ambiguous observations become review items
- approved observations synthesize deterministic rules
- deterministic rules match positive fixtures and reject negative fixtures
- catalog validation rejects duplicate keys, private tokens, deprecated taxonomy nodes, and untested rules
- audit events are written for auto-accept, review, rule activation, and contribution candidate creation

Later UI tests:

- review queue shows identity and taxonomy confidence separately
- coworker proposal requires human approval for sensitive and contribution-ready cases
- redaction preview is visible before contribution

## 21. Smallest Next Implementation Slice

Implement the schema and pure policy layer only:

1. add first-class persistence for fingerprint observations, reviews, rules, and catalog versions
2. add redaction helper tests
3. add confidence threshold gate tests
4. add deterministic rule candidate builder tests
5. do not alter live discovery attribution behavior yet
6. do not add UI yet
7. do not open contribution PRs yet

This gives the platform a trustworthy foundation for the daily triage coworker and repo catalog work without changing production discovery outcomes prematurely.

## 22. Final Recommendation

DPF should treat discovery fingerprints as governed platform knowledge.

The durable architecture is:

```text
local evidence -> reviewed observation -> deterministic local rule -> redacted repo catalog contribution
```

High-confidence identity plus high-confidence taxonomy placement can be applied automatically only when the operational blast radius supports it. Confidence thresholds and rollout strategy scale with the blast radius tier (`low`, `medium`, `high`, `customer-critical`), which is computed from taxonomy placement, network zone, entity role, dependents, and SLA linkage. Anything low-confidence, missing evidence, ambiguous, proprietary, customer-specific, privacy-sensitive, or `customer-critical` by blast radius should route to daily AI coworker triage and human review. Approved reusable rules should become deterministic catalog entries with fixtures and redaction reports before they are contributed back to the repo.
