# Lifecycle Evidence Specialist Design

**Date:** 2026-04-18  
**Status:** Draft  
**Author:** Codex  
**Purpose:** Extend the Digital Product Estate Specialist so unknown manufacturer, version, and support lifecycle gaps are resolved through an AI-assisted procedural fingerprinting loop that steadily converts repeated reasoning into deterministic code and rules.

## 1. Inputs

This design extends:

- `docs/superpowers/specs/2026-04-18-purpose-first-product-estate-design.md`
- `docs/superpowers/specs/2026-04-17-business-first-portal-workflow-consolidation-design.md`
- `docs/superpowers/specs/2026-04-17-portal-navigation-consolidation-design.md`

It is grounded in the current implementation:

- `apps/web/lib/actions/discovery.ts`
- `apps/web/lib/operate/discovery-scheduler.ts`
- `apps/web/lib/mcp-tools.ts`
- `apps/web/lib/tak/agent-routing.ts`
- `apps/web/lib/tak/route-context-map.ts`
- `apps/web/lib/estate/estate-item.ts`
- `packages/db/src/discovery-normalize.ts`
- `packages/db/src/software-normalization.ts`
- `packages/db/prisma/schema.prisma`

It is also grounded in live runtime data queried from the running portal container on **April 18, 2026**:

- `InventoryEntity.total = 120`
- `InventoryEntity.unknown_support = 120`
- `InventoryEntity.unsupported_or_eol = 0`
- `InventoryEntity.missing_manufacturer = 114`
- `InventoryEntity.missing_normalized_version = 114`
- current open `PortfolioQualityIssue` counts in this area are only:
  - `attribution_missing = 1`
  - `taxonomy_attribution_low_confidence = 1`

Operational note:

- the host shell `DATABASE_URL` values did not authenticate cleanly, so the runtime snapshot above was gathered through `psql` inside the running `portal` container rather than through the host shell directly
- the backlog is intentionally not treated as runtime truth in this phase because the user confirmed the live backlog system is not yet the active planning source for this rebuilt instance

## 2. Problem Statement

The estate model now explains identity, version source, support posture, and advisories more clearly, but the underlying lifecycle evidence remains mostly absent.

Today:

- every live estate item still has `supportStatus = unknown`
- most live estate items are still missing normalized manufacturer and version detail
- only two explicit quality issues are open, which means the current issue system is not yet representing the actual evidence debt
- the existing AI coworker can help explain uncertainty, but it is still external to the deeper normalization and fingerprinting loop

That leaves the platform in an awkward middle state:

- better UX
- better language
- better route placement
- but not yet a self-improving evidence engine

The user clarified two important constraints:

1. human investigation must be the last resort, not the default
2. repeated AI reasoning should be turned into procedural code and fingerprint rules over time

This means the platform should not become a chatbot wrapped around an unresolved inventory problem. It should become a progressively smarter identity and lifecycle engine where:

- code handles the common cases
- AI resolves the ambiguous tail
- repeated AI resolutions are proceduralized
- humans are asked only when the platform genuinely cannot determine the answer

## 3. Design Goals

This design should:

1. Make lifecycle and support verification a first-class part of the shared product-estate model.
2. Keep raw discovery evidence, normalized identity, and applied fingerprint rules distinct.
3. Let deterministic rules handle the majority of matches.
4. Use AI inside the discovery-improvement loop, not as a disconnected afterthought.
5. Convert repeated AI reasoning into procedural rules and code.
6. Present human fallback tasks in non-technical language.
7. Maintain a full audit trail so bad rules, regressions, and collisions can be detected later.

This design must not:

1. Default to human review for large numbers of items.
2. Create a new siloed catalog tool separate from the estate model.
3. Treat AI suggestions as unlogged magic.
4. Guess lifecycle or support state without evidence.
5. Depend on a heavy approval workflow for low-risk normalization decisions.

## 4. Research & Benchmarking

### 4.1 Prometheus

Sources:

- [Prometheus HTTP API: `/api/v1/targets`](https://prometheus.io/docs/prometheus/3.2/querying/api/)
- [Prometheus configuration and relabeling](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)
- [Prometheus data model](https://prometheus.io/docs/concepts/data_model/)

What it teaches:

- Prometheus distinguishes between `discoveredLabels` and final `labels`
- the raw discovery payload and the standardized label set are both valuable
- relabeling is an ordered, deterministic transformation pipeline
- labels are the operational fingerprint for target identity

Pattern adopted:

- keep raw discovery fingerprints separate from normalized identity
- persist both the pre-rule evidence and the post-rule standardized identity view
- treat fingerprint/rule application as a deterministic pipeline before any AI interpretation

Pattern rejected:

- collapsing raw discovered evidence and normalized identity into one field with no lineage

### 4.2 Grafana Alloy

Sources:

- [Grafana Alloy `discovery.relabel`](https://grafana.com/docs/grafana-cloud/send-data/alloy/reference/components/discovery/discovery.relabel/)
- [Grafana Alloy discovery components](https://grafana.com/docs/alloy/latest/reference/components/discovery/)

What it teaches:

- discovery relabeling is a reusable component, not ad hoc logic
- rules are applied in top-down order
- internal discovery metadata can be preserved and selectively promoted
- configuration health and rule validity matter just as much as matching behavior

Pattern adopted:

- represent fingerprint rules as ordered, inspectable transformations
- preserve temporary and internal evidence fields during rule evaluation
- treat rule quality and rule drift as an operational concern

Pattern rejected:

- embedding all identity logic in opaque AI prompts with no reusable rule representation

### 4.3 Flexera / Technopedia

Sources:

- [Technopedia API](https://docs.flexera.com/flexera/EN/Technopedia/technoAPI.htm)
- [Technopedia overview](https://docs.flexera.com/flexera-one/technopedia/)
- [Data Platform](https://docs.flexera.com/data-platform/)
- [Lifecycle and End-of-Life Policy](https://docs.flexera.com/eol/policy.html)
- [Proactive SW EOL and Obsolescence Guidance](https://docs.flexera.com/flexera/EN/ITVisibility/ProactiveSWEOL.htm)

What it teaches:

- a useful technology catalog contains manufacturer, product, taxonomy, and enrichment content such as lifecycle dates
- lifecycle data may be researched, calculated, or mixed
- customers gain value when normalized identity and lifecycle posture are available inside the operating platform, not only in raw exports

Pattern adopted:

- DPF should maintain a canonical identity and lifecycle layer for discovered technology items
- support posture should carry evidence source and confidence, not just a plain status string

Pattern rejected:

- depending on one proprietary catalog vendor as the only future path
- exposing calculated lifecycle output without telling the user whether it is vendor-provided, inferred, or unknown

### 4.4 Differentiator

Best-of-breed systems usually stop at one of two points:

- deterministic relabeling and target normalization
- external product intelligence enrichment

DPF should combine both with a third layer:

- an AI coworker that resolves the ambiguous tail, then helps proceduralize what it learns into the deterministic pipeline

That is the differentiator:

- `scan`
- `normalize`
- `infer`
- `proceduralize`
- `detect drift`

instead of just:

- `scan`
- `dump results`

## 5. Current-State Gaps

### 5.1 The runtime gap is bigger than the issue queue

The live runtime snapshot shows the product-estate evidence debt is structurally larger than the explicit issue queue:

- `120` items with unknown support lifecycle
- `114` items missing manufacturer
- `114` items missing normalized version
- but only `2` relevant open quality issues

So the platform currently explains uncertainty better than it operationalizes that uncertainty.

### 5.2 The software normalization layer has become partially de-persisted

The codebase still has:

- `packages/db/src/software-normalization.ts`
- `packages/db/src/discovery-normalize.ts`
- `softwareIdentityId` on `DiscoveredSoftwareEvidence`

But the historical persistence layer was dropped in migration:

- `packages/db/prisma/migrations/20260320222431_add_invoice_payment_models/migration.sql`

That migration removed:

- `SoftwareIdentity`
- `SoftwareNormalizationRule`

So the platform currently has helper logic and references, but not a strong canonical rule/catalog persistence layer for long-term proceduralization.

This is a key refactoring opportunity and should be addressed in the design rather than silently worked around.

## 6. Proposed Design

## 6.1 Core principle

The specialist is not a glorified investigator. It is a resolution engine.

The order of operations should be:

1. deterministic fingerprint rules
2. deterministic normalization and catalog lookup
3. AI resolution for ambiguous cases
4. automatic rule candidate generation from repeated AI success
5. human fallback only for unresolved exceptions

## 6.2 Product shape

This should remain part of the existing `Digital Product Estate Specialist` operating model, not a new top-level silo.

The user-facing experience stays cohesive:

- estate pages remain the place where humans understand purpose, dependencies, and posture
- discovery operations remain the specialist evidence workspace
- lifecycle evidence becomes a deeper operating capability within the same specialist family

Internally, the capability gains a new mode:

- `Lifecycle Evidence Specialist`

But externally, this is still one estate discipline inside the platform.

## 6.3 Closed-loop architecture

The lifecycle evidence loop should be:

### Stage 1: Scan

Collect raw evidence from:

- bootstrap discovery collectors
- connection-specific collectors like UniFi
- Prometheus target discovery
- relabeled monitoring target state
- host and container software evidence
- topology relationships and portfolio attribution context

### Stage 2: Fingerprint

Build stable fingerprints from raw evidence such as:

- collector type
- source connection
- target labels
- discovered labels
- raw product/package name
- raw vendor
- install location
- instance/job identity
- topology role and network position
- previously seen normalized matches

The fingerprint is the repeatable matching substrate, not the final human-facing identity.

### Stage 3: Normalize

Apply deterministic rules first:

- exact fingerprint rules
- alias rules
- relabel transforms
- product/vendor normalization rules
- version extraction rules
- lifecycle source mappings

### Stage 4: Infer

If deterministic rules do not resolve the case, invoke the AI specialist against:

- raw fingerprint evidence
- candidate matches
- prior successful resolutions
- portfolio and dependency context
- current support posture and update posture

The AI outcome must be structured, not freeform:

- likely manufacturer
- likely product identity
- likely version
- support/lifecycle posture hypothesis
- confidence
- why this is still uncertain
- whether the case is reusable enough for rule promotion

### Stage 5: Proceduralize

If the same AI reasoning succeeds repeatedly, convert it into:

- a new fingerprint rule
- a refined normalization rule
- a relabel transform
- or a deterministic extraction helper in code

This is the long-term platform win: AI teaches the procedural layer.

### Stage 6: Detect drift

Continuously watch for:

- rule collisions
- lower confidence after a previously stable match
- later correction of an auto-applied rule
- different collector sources disagreeing
- taxonomy or dependency changes making an old rule unsafe

### Stage 7: Human fallback

Only when the above still fails should a human be involved.

The human task must be phrased for non-technical people:

- what we think this is
- why the platform still is not sure
- the easiest next thing to check
- examples of where to look
- what answer to provide back

## 6.4 Prometheus/Grafana-style identity lineage

The platform should explicitly model three states:

1. `raw discovered evidence`
2. `standardized fingerprinted evidence`
3. `resolved catalog identity`

This is the equivalent of Prometheus:

- `discoveredLabels`
- relabeling pipeline
- final `labels`

Translated into DPF estate terms:

- raw collector evidence
- fingerprint/rule transformation pipeline
- canonical estate identity

That lineage should be inspectable so the specialist can explain:

- what was seen
- which rules ran
- what changed
- which evidence remains weak

## 6.5 Human fallback behavior

When human help is needed, the platform should never dump technical ambiguity on them.

It should generate a plain-language review card with:

- `What we think this is`
- `Why we still cannot verify it automatically`
- `What to check next`
- `Where that information is usually found`
- `How to tell the platform the answer`

Example:

- We think this is a Ubiquiti access point, but the model and lifecycle details still are not confirmed.
- The platform found the device on your network and matched part of its identity, but the product name is still too vague to trust support dates.
- Please look for the model label in the device app, admin page, or packaging.
- If you find it, tell the coworker the exact model name or upload a screenshot of the device details page.

## 7. Data Model Stewardship

## 7.1 Shared concept needing canonical persistence

The shared concept here is not just "software evidence." It is `catalog identity plus fingerprint rule lineage`.

The current schema has raw evidence and inventory entities, but not a strong canonical persisted model for:

- normalized catalog identity
- deterministic fingerprint rules
- resolution audit lineage

That should be corrected explicitly.

## 7.2 Proposed canonical models

### `CatalogIdentity`

Canonical normalized identity for a discovered technology item.

Fields should include:

- `identityKey`
- `identityType` (`software`, `hardware`, `service`, `network_device`, etc.)
- `manufacturer`
- `productName`
- `edition`
- `canonicalVersionPattern`
- `technicalClass`
- `iconKey`
- `supportLifecycleSource`
- `supportLifecycleConfidence`
- `latestKnownVersion`
- `lifecycleMetadata`
- `status`

### `FingerprintRule`

Deterministic rule that maps raw evidence to a `CatalogIdentity`.

Fields should include:

- `ruleKey`
- `scope` (`software_evidence`, `prometheus_target`, `network_device`, `topology_role`, etc.)
- `matchType`
- `sourceFields`
- `rawSignature`
- `transformationSpec`
- `catalogIdentityId`
- `status`
- `confidence`
- `origin` (`seeded`, `auto_promoted`, `human_authored`)
- `originResolutionLogId`
- `lastValidatedAt`

### `IdentityResolutionLog`

Audit trail for every significant decision or correction.

Fields should include:

- `inventoryEntityId`
- `catalogIdentityId`
- `resolutionType` (`auto_rule`, `ai_inferred`, `human_confirmed`, `human_corrected`, `rule_regressed`)
- `inputFingerprint`
- `reasoningSummary`
- `confidence`
- `appliedRuleId`
- `outcome`
- `createdAt`

## 7.3 Existing model updates

### `InventoryEntity`

Add fields such as:

- `catalogIdentityId`
- `identityStatus`
- `identityConfidence`
- `supportLifecycleSource`
- `supportLifecycleConfidence`
- `latestKnownVersion`
- `updateAvailable`
- `lastIdentityReviewedAt`

### `PortfolioQualityIssue`

Expand issue usage so it reflects real evidence debt, including types like:

- `lifecycle_unverified`
- `identity_rule_candidate`
- `rule_collision_detected`
- `rule_regression_detected`
- `catalog_match_ambiguous`

This is necessary because the current issue queue is materially understating runtime evidence gaps.

## 7.4 Deferred refactoring note

The old `SoftwareIdentity` and `SoftwareNormalizationRule` tables were dropped, but their conceptual role is still needed.

This design does not require reviving them under the exact old names. It does require reintroducing their canonical function in a broader, cleaner identity model that supports both software and hardware-like discovered items.

## 8. Specialist Behavior

## 8.1 Default operating mode

The specialist should default to:

- automatic deterministic resolution first
- AI inference on the ambiguous tail
- automatic promotion of stable repeated outcomes into rules
- logging everything needed for rollback, drift, and pattern detection

This is low-HITL by design.

## 8.2 Auto-apply policy

Default policy:

- auto-apply when confidence is high and there is no conflict
- create a logged rule candidate and apply it immediately when the pattern is stable enough
- do not block on human approval for low-risk normalization actions

Suggested thresholds:

- auto-apply direct deterministic rules at `>= 0.97`
- auto-promote AI-derived rule candidates after at least `3` consistent successful resolutions across at least `2` separate discovery runs
- require fallback instead of auto-apply when there is:
  - candidate conflict
  - taxonomy conflict
  - blast-radius sensitivity with low confidence
  - contradictory evidence from multiple sources

Exact thresholds can be tuned during implementation.

## 8.3 Drift handling

The specialist should reopen or downgrade prior resolutions when:

- a later discovery run no longer matches the rule cleanly
- a different collector suggests another identity
- a human correction contradicts an auto-applied identity
- support lifecycle data changes from the enrichment source

This is where the audit log matters. The platform should become smarter over time, not more brittle.

## 9. UX Surfaces

## 9.1 Discovery Operations

`/platform/tools/discovery` should gain:

- lifecycle evidence debt summary
- rule candidate summary
- recent auto-promotions
- drift/regression queue
- plain-language exception queue for unresolved items

## 9.2 Product estate page

`/portfolio/product/[id]/inventory` should gain:

- confidence-backed lifecycle/source badges
- latest-known-version versus observed-version posture
- why this item is still uncertain
- whether the current identity came from:
  - direct rule
  - AI-inferred resolution
  - human confirmation

## 9.3 Coworker skills

Add skills such as:

- `Improve fingerprint rule`
- `Explain why this item is still unverified`
- `Show how this identity was resolved`
- `Promote this repeated match into a rule`
- `Prepare a human-friendly review request`

## 10. Phasing

### Phase 1: Visible debt and structured AI resolution

- introduce lifecycle evidence debt detection
- expose queue counts honestly
- add structured AI resolution output
- improve plain-language fallback tasks

### Phase 2: Canonical persistence layer

- add `CatalogIdentity`
- add `FingerprintRule`
- add `IdentityResolutionLog`
- link `InventoryEntity` to canonical identity

### Phase 3: Auto-promotion loop

- detect repeated successful AI resolutions
- generate rule candidates
- auto-promote high-confidence patterns
- add regression detection

### Phase 4: Enrichment connectors

- add external lifecycle/catalog enrichment sources where valuable
- keep source and confidence visible
- avoid turning enrichment into an opaque dependency

## 11. Testing and QA

Add tests for:

- fingerprint extraction from raw discovery and Prometheus targets
- deterministic rule application ordering
- AI-to-rule promotion thresholds
- drift detection on later conflicting evidence
- plain-language human fallback card generation
- no-fabrication behavior for unknown lifecycle states

Add QA cases to `tests/e2e/platform-qa-plan.md` for:

- discovery route shows lifecycle debt counts
- coworker explains why an item is unresolved without guessing
- repeated AI resolution produces a reusable rule candidate
- corrected item reopens drift detection rather than silently keeping a bad rule

## 12. Recommendation

Implement this as an extension of the existing `Digital Product Estate Specialist`, with a new lifecycle evidence loop that:

- uses deterministic fingerprint and relabel-style rules first
- uses AI for the ambiguous tail
- converts repeated AI success into procedural code and persisted rules
- asks humans only when the platform truly cannot determine the answer

That direction is the best fit for the platform principles already established:

- one shared estate model
- no siloed tools
- AI work moving into code over time
- explanation that works for non-technical users

