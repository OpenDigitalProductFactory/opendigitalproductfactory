# Discovery → Portfolio Gap Closure

| Field | Value |
| - | - |
| Status | Draft |
| Date | 2026-04-30 |
| Owner persona(s) | AGT-WS-INVENTORY (display-name/prompt-scope rename to "Digital Product Estate Specialist"), AGT-WS-PORTFOLIO ("Portfolio Analyst") |
| Scope | Close the visible gap between Estate Discovery (`/platform/tools/discovery`) and the Foundational Portfolio (`/portfolio/foundational`). Define a procedural pipeline that classifies discovered items into the right taxonomy node, enriches them with manufacturer/version/description detail, and gives both specialist coworkers a durable governance loop. |
| Builds on | [2026-03-13 Bootstrap Infrastructure Discovery and Portfolio Quality Foundation](./2026-03-13-bootstrap-infrastructure-discovery-and-portfolio-quality-foundation-design.md), [2026-04-30 AI Coworker Operator Pattern](./2026-04-30-ai-coworker-operator-pattern.md) |

---

## 1. Problem

The Foundational Portfolio is supposed to surface every digital product discovered on the install, with enough metadata that a human (or a downstream agent) can reason about it. Today there are five distinct failure modes, all visible on a single bootstrap install:

**Evidence note.** The runtime counts below were re-checked against `dpf-postgres-1` on 2026-04-30. The design should continue to treat those counts as install-specific evidence, not as universal constants. Implementation must re-run the audit query before writing migrations, backlog items, or acceptance evidence.

**1.1 Discovered items don't reach the portfolio.**
Of 218 deduplicated `InventoryEntity` rows produced by 92 bootstrap discovery runs, only 140 (64%) became `DigitalProduct` rows. The 78 orphans break down as 69 `network_client`, 4 `access_point`, 3 `vlan`, 1 `switch`, 1 `service`. None of those `entityType` values appear in `PROMOTABLE_TYPES` at [discovery-promotion.ts:7-20](../../../packages/db/src/discovery-promotion.ts:7), so the promotion query at [discovery-promotion.ts:74-92](../../../packages/db/src/discovery-promotion.ts:74) silently filters them out. The discovery page shows them; the portfolio page does not. The user reads this as "most discovered items are missing."

**1.2 Promoted items have almost no detail.**
Live counts on the same install:

| Field | Populated |
| - | - |
| `DigitalProduct.description` | 9/100 |
| `DigitalProduct.observationConfig` | 0/100 |
| `InventoryEntity.manufacturer` | 6/218 |
| `InventoryEntity.observedVersion` | 6/218 |
| `InventoryEntity.normalizedVersion` | 0/218 |
| `InventoryEntity.technicalClass` | 0/218 |
| `InventoryEntity.iconKey` | 0/218 |

Most names are infrastructure hashes (`2ac308458df7`, `vEthernet (Default Switch)…`). The schema has slots for richer detail; nothing populates them. Promotion creates skeleton rows and stops.

**1.3 The detail UI is sparse even when data exists.**
[`PortfolioNodeDetail.tsx`](../../../apps/web/components/portfolio/PortfolioNodeDetail.tsx) renders summary stats (counts, health, investment, owner) but ignores `TaxonomyNode.description`, `TaxonomyNode.governance`, and `TaxonomyNode.enrichment` — three JSON columns intended exactly for the kind of context the user is asking to see.

**1.4 Three of four root portfolios are effectively empty.**
The active discovery-to-promotion path feeds the `foundational` portfolio: 99 foundational products have 140 linked inventory entities. `for_employees` and `manufacturing_and_delivery` have zero products and zero inventory entities; `products_and_services_sold` has one product but no linked inventory. There is no source feeding those root portfolios in this spec's scope.

**1.5 The role split for closing this gap is implicit.**
The user's mental model names two specialists: a **Digital Product Estate Specialist** and a **Portfolio Analyst**. The platform has `AGT-WS-PORTFOLIO` ("Portfolio Analyst") but no coworker named "Estate Specialist" — the nearest match is `AGT-WS-INVENTORY` ("Product Manager") which already owns daily Discovery Taxonomy Gap Triage. The mismatch makes ownership unclear and obscures who is responsible when promotion or enrichment falls behind. This spec should fix the operator contract and display identity without forcing a brittle primary-key-style agent ID rename in the first slice.

---

## 2. Research and Benchmarking

The discovered → catalog → enrichment pipeline is well-trodden in CMDB / EAM / service-catalog products. The patterns below are the ones DPF should adopt or explicitly reject.

### 2.1 Open-source references

- **Backstage (Spotify)** — service catalog with **entity providers** (sources of truth like Kubernetes, GitHub, Terraform) feeding **processors** (validate, enrich, classify). Entities are first-class with kind/spec/metadata; classification is declarative. Re-discovery is continuous; missing entities are tombstoned, not deleted. *Pattern adopted:* provider/processor split — a discovered entity flows through a chain that can enrich it with vendor/version/owner before it lands.
- **NetBox** — DCIM/IPAM with a normalized `Manufacturer`/`DeviceType`/`DeviceRole` triad. Discovery sources (NetBox plugins like netbox-onboarding) populate raw observations; manufacturer/model are looked up against a curated dictionary, not free-text. *Pattern adopted:* a manufacturer/model normalization dictionary with rules-first lookup and human-curatable seeds.
- **iTop / Combodo** — open ITIL CMDB with explicit "operational status" (production / stock / obsolete) separated from "discovery freshness." Stale CIs do not vanish; they get downgraded. *Pattern adopted:* introduce a freshness state distinct from lifecycle status, so dead container IDs leave the foundational portfolio without breaking historical references.

### 2.2 Commercial references

- **ServiceNow Discovery + CMDB** — Probes (data acquisition) and Sensors (parse + classify) are decoupled. Identification rules + reconciliation rules deduplicate aggressively. Each CI class has a dedicated enrichment chain. *Pattern adopted:* enrichment is its own decoupled pipeline; promotion is not the end of the story.
- **Device42** — auto-discovery + auto-categorization with a living **Application Component Library** that maps observed-banner / process-signature → canonical product + manufacturer. Vendor metadata pulls in automatically. *Pattern adopted:* a small canonical signature library, seedable and admin-editable, that maps `entityType` + observed properties → taxonomy node + technical class.
- **LeanIX EAM (now SAP)** — application portfolio with **Inventory** (factual) vs **Architecture** (interpretive) separation; auto-import from technology providers; meta-model with required fields per fact-sheet type. Items are never "missing detail" because the meta-model rejects under-specified imports. *Pattern adopted:* required-field gates per taxonomy node — a `DigitalProduct` cannot sit in `compute/servers` without `manufacturer` + `observedVersion` populated; that becomes a `PortfolioQualityIssue`.

### 2.3 Patterns rejected

- **Promote-everything-by-type** (some early CMDBs). Loses the signal between actionable products and noise. Keep the gate; widen it deliberately.
- **One-shot enrichment** (older asset managers). Enrichment must run on a cadence; vendor info changes, versions drift, support status flips.
- **Free-text manufacturer/model fields with no normalization.** Creates duplicates ("Cisco" vs "Cisco Systems"). Must normalize against a dictionary.
- **Auto-creating taxonomy nodes from inferred data** (some discovery tools). Already explicitly prohibited by the [Inventory Specialist prompt](../../../prompts/route-persona/inventory-specialist.prompt.md): "NEVER invent taxonomy nodes." Keep this; surface gaps for human review.

### 2.4 Patterns adopted, summarized

1. Provider/processor pipeline: discovery → normalization → classification → enrichment → promotion.
2. Manufacturer/model normalization dictionary, seeded + admin-editable.
3. Freshness state (`fresh` / `stale` / `retired`) distinct from `lifecycleStatus`.
4. Required-field gates per taxonomy node, surfaced as `PortfolioQualityIssue` not as silent skips.
5. Continuous re-enrichment on cadence.
6. Human-in-the-loop only for genuinely ambiguous cases (taxonomy gap, low-confidence classification, missing canonical signature).

---

## 3. Current State (audit)

### 3.1 Pipeline

```
DiscoveryRun ──► DiscoveredItem ──► InventoryEntity ──► DigitalProduct ──► Portfolio
   (raw scans)    (per-run obs)       (deduplicated)      (promoted CI)     (4 roots)
```

- Promotion code: [`packages/db/src/discovery-promotion.ts`](../../../packages/db/src/discovery-promotion.ts)
- Promotion triggers: [`apps/web/lib/actions/inventory.ts:276,314,469`](../../../apps/web/lib/actions/inventory.ts) on triage decisions, plus the bulk sweep in `discovery-runner.ts`
- Daily triage owner: AGT-WS-INVENTORY via the `run_discovery_triage` MCP tool ([`packages/db/src/discovery-triage-config.ts`](../../../packages/db/src/discovery-triage-config.ts))

### 3.2 Promotion gate (the hard filter)

`promoteInventoryEntities` in [discovery-promotion.ts:71-167](../../../packages/db/src/discovery-promotion.ts:71) requires all of:

- `attributionStatus = "attributed"`
- `attributionConfidence >= 0.90`
- `digitalProductId IS NULL`
- `taxonomyNodeId IS NOT NULL`
- `entityType IN PROMOTABLE_TYPES` (12 values; **see 1.1 — this is the largest blocker**)

Plus a runtime check that the taxonomy node's root segment matches a `Portfolio.slug`, otherwise silent skip.

### 3.3 Schema slots already available

`DigitalProduct` ([schema.prisma:504-533](../../../packages/db/prisma/schema.prisma:504)): `description`, `observationConfig`, `version`, `lifecycleStage`, `lifecycleStatus`. All present, mostly empty.

`InventoryEntity` ([schema.prisma:2511-2559](../../../packages/db/prisma/schema.prisma:2511)): `technicalClass`, `iconKey`, `manufacturer`, `productModel`, `observedVersion`, `normalizedVersion`, `supportStatus`, `attributionMethod`, `attributionConfidence`, `attributionEvidence`, `candidateTaxonomy`, `properties` (JSON). Rich slots. Mostly empty.

`TaxonomyNode` ([schema.prisma:832-851](../../../packages/db/prisma/schema.prisma:832)): `description`, `governance` (JSON), `enrichment` (JSON), `status`, `portfolioId`. Present; not rendered.

The schema is largely sufficient. **This is mostly a pipeline + UI gap, not a data-model gap.**

### 3.4 Adjacent foundation already available

This spec should not create a second recognition-rule subsystem. The 2026-04-25 discovery fingerprint contribution slice already added the foundation for:

- `DiscoveryFingerprintObservation`
- `DiscoveryFingerprintReview`
- `DiscoveryFingerprintRule`
- `DiscoveryFingerprintCatalogVersion`
- deterministic rule evaluation helpers
- catalog fixture validation
- activation helpers for approved rules

This gap-closure design should consume that foundation for recognition, evidence, review, and catalog versioning. New schema in this spec should be limited to portfolio-specific promotion/enrichment state that cannot cleanly live in the fingerprint foundation or existing portfolio models.

---

## 4. Goals and Non-Goals

### 4.1 Goals

1. Every discovered, attributed `InventoryEntity` either appears in the foundational portfolio or has a recorded reason it does not (visible to the operator).
2. Every promoted `DigitalProduct` carries enough detail to be human-meaningful: a name beyond an infrastructure hash, a description, a manufacturer/model when applicable, a normalized version, a technical class, and an icon.
3. Taxonomy detail pages render the schema fields they already have (`description`, `governance`, `enrichment`).
4. Stale entries (e.g. dead container IDs) age out automatically without polluting the active portfolio view.
5. The two specialist coworkers have clearly distinct, non-overlapping responsibilities for this pipeline.
6. The whole pipeline is continuous, not one-shot — re-runs reconcile changes; new evidence updates existing rows.
7. Refactor the discovery-to-portfolio boundary enough that future classifiers, enrichers, and UI surfaces share one policy/evidence model instead of adding more page-local or prompt-local rules.

### 4.2 Non-goals

- Multi-source discovery beyond the bootstrap connector (deferred per the 2026-03-13 design).
- Populating the other three root portfolios (`for_employees`, `manufacturing_and_delivery`, `products_and_services_sold`) — those need their own discovery sources, separate spec.
- Auto-creating taxonomy nodes. Gaps surface for human review (existing rule).
- Replacing the ServiceNow/CMDB market in this round. Slice for the bootstrap install first.
- Creating a parallel signature/rule catalog that duplicates `DiscoveryFingerprintRule` and `DiscoveryFingerprintCatalogVersion`.

---

## 5. Specialist Role Split

This spec proposes one display/contract rename and one clarification.

### 5.1 Rename the visible role, preserve the durable ID

**Rationale.** The `inventory-specialist.prompt.md` already describes the work the user calls "Estate Specialist": daily discovery triage, attribution review, taxonomy gap surfacing, lifecycle integrity across the discovered estate. The display name is "Product Manager" which is misleading — the role is operational over the *estate of discovered digital products*, not portfolio strategy.

Do **not** rename the durable `agent_id` in the first implementation slice. `AGT-WS-INVENTORY` is already referenced in `agent_registry.json`, route prompts, tools, scheduled triage, and likely runtime rows. Renaming it as a data migration is higher risk than the user-facing problem requires.

Instead:

- keep `agent_id: AGT-WS-INVENTORY`
- set the display name to `Digital Product Estate Specialist`
- add a stable route/persona alias such as `estate-specialist` while preserving `inventory-specialist` as a compatibility alias
- update prompt language from "Product Manager" to "Digital Product Estate Specialist"
- update peer references so other coworkers describe this agent as estate/discovery owner, not product-strategy owner

Only create `AGT-WS-ESTATE` later if the platform adopts a formal agent-ID migration playbook with aliasing, data backfill, and route-grant compatibility tests.

### 5.2 Responsibility split

**Estate Specialist (AGT-WS-INVENTORY with `estate-specialist` alias).** Owns the *factual* state of the estate.

- Daily Discovery Taxonomy Gap Triage (existing).
- Auto-classification of un-classified `InventoryEntity` rows.
- Auto-enrichment of `DigitalProduct` and `InventoryEntity` (manufacturer, version, description, technical class, icon).
- Stale-aging policy.
- Surfaces taxonomy gaps and missing-evidence quality issues; never invents nodes.

**Portfolio Analyst (AGT-WS-PORTFOLIO).** Owns the *interpretive* state of the portfolio.

- Reviews newly promoted products and approves taxonomy gap proposals.
- Computes and surfaces portfolio completeness scores.
- Detects concentration risk, balance issues, and Pareto patterns across the portfolio.
- Owns portfolio-level governance (rebalancing, sunset proposals, investment-mix red flags).

**Hand-off.** Estate Specialist promotes + enriches → Portfolio Analyst reviews + governs. The Portfolio Analyst's review queue is fed by the Estate Specialist's outputs.

---

## 6. Proposed Design

Five implementation slices. Each is independently shippable; the order minimizes blank-screen periods.

### 6.1 Slice 1 — Promotion gate fix and audit visibility

**Goal.** Stop silently dropping 36% of inventory.

**Changes.**

- Replace direct use of the hardcoded `PROMOTABLE_TYPES` array with a typed **promotion policy resolver**. The resolver reads the resolved taxonomy node's `governance.promotion` policy when present and falls back to the current `PROMOTABLE_TYPES` list during rollout. This keeps existing behavior stable while moving the source of truth toward taxonomy policy.
- Default rule for all current `PROMOTABLE_TYPES`: `{ promotion: "auto" }`. Default rule for `network_client`, `access_point`, `vlan`, `switch`, `service`: `{ promotion: "auto", classify_as: "infrastructure_endpoint" }` — they promote, but with a `technicalClass` that distinguishes them from primary CIs.
- New view at `/platform/tools/discovery/promotion-audit`: counts of discovered / attributed / promoted / blocked, with each blocked group reasoned (`type_not_promotable`, `no_taxonomy`, `no_portfolio_root`, `low_confidence`). The first slice can be backed by a query helper; use a SQL view only if the query shape proves shared by multiple surfaces.
- Promotion writes or refreshes a `PortfolioQualityIssue` for every actionable skip, using the existing `issueType` field. Skipped items become visible work, not silent loss.
- Add a pure helper such as `resolvePromotionDecision(entity, taxonomyNode, portfolio)` with unit tests for every skip reason. The current promotion function mixes filtering, rule policy, portfolio resolution, `DigitalProduct` upsert, and logging; slice 1 should spend explicit refactoring budget separating those concerns before adding new behavior.

**Files touched.**

- `packages/db/src/discovery-promotion.ts` — rule lookup + quality issue creation
- `packages/db/src/discovery-promotion-policy.ts` — pure promotion-decision helper
- `packages/db/src/seed.ts` (or a successor seed module) — promotability defaults under `TaxonomyNode.governance`
- `packages/db/src/discovery-promotion.test.ts` — policy/skip-reason coverage
- `apps/web/app/(shell)/platform/tools/discovery/promotion-audit/page.tsx` — new

**Migration.** None required (governance JSON already exists). Backfill via a one-shot in the seed pass that ensures every existing `TaxonomyNode` has a `promotion` rule.

### 6.2 Slice 2 — Auto-classification

**Goal.** Every `InventoryEntity` reaches a taxonomy node, automatically when possible, into a triage queue when not.

**Changes.**

- New library: `packages/db/src/discovery-classification.ts` exporting `classifyInventoryEntity({ entityType, properties, observedSignals }) -> { taxonomyNodeId, confidence, evidence, fingerprintRuleId? }`.
- Two-stage classifier:
  1. **Rules pass.** Evaluate active `DiscoveryFingerprintRule` rows and their catalog version metadata. Rules map observed evidence to a taxonomy node and optional technical class. Confidence comes from rule specificity, evidence family diversity, and blast-radius policy from the fingerprint contribution design.
  2. **Model-assisted fallback.** When rules don't match, the Estate Specialist invokes the configured small/cheap inference profile through `apps/web/lib/ai-inference.ts`, producing `taxonomyNodeId` + confidence + reasoning. Output is recorded in `attributionEvidence` and, when useful, as a `DiscoveryFingerprintObservation` for later rule review. Do not name a vendor/model in the spec; DPF runs through an OpenAI-compatible runtime that may be local or hosted.
- New MCP tool: `classify_inventory_entity` (Estate Specialist's grant).
- Daily classification sweep: runs after the daily triage; classifies any `InventoryEntity` with `taxonomyNodeId IS NULL`.
- Confidence < 0.75 → triage queue, not auto-classified. Maintains the "never invent" rule by routing ambiguous cases to humans.

**Failure mode handling.** When the LLM returns a taxonomy node that doesn't exist, the entity is filed under the closest existing parent + a `PortfolioQualityIssue` of type `taxonomy_gap_proposal` is created with the proposed node — visible to the Portfolio Analyst for approval.

### 6.3 Slice 3 — Auto-enrichment (background pipeline)

**Goal.** Populate the empty fields on `DigitalProduct` and `InventoryEntity` automatically, on a cadence, without blocking the UI.

**Changes.**

- New durable queue function: `enrich-digital-product` at proposed path `apps/web/lib/queue/functions/enrich-digital-product.ts`. Triggered:
  - On promotion (post-`promoteInventoryEntities` hook).
  - On a weekly cadence for products older than the cadence window.
  - On manual request from the Estate Specialist or operator.
- Enrichment chain (each step is a small adapter, fail-soft, evidence recorded in `attributionEvidence`):
  1. **Fingerprint/catalog lookup** — match observed banners / process signatures / image names against active `DiscoveryFingerprintRule` and catalog-version metadata. Populates `manufacturer`, `productModel`, `technicalClass`, `iconKey`, and `taxonomyNodeId` when matched. Do not introduce a separate `ProductSignature` table unless the implementation proves that enrichment signatures cannot fit the fingerprint rule shape.
  2. **Version normalization** — parse `observedVersion` into `normalizedVersion` (semver / calver / debian-style). Pure code; no external call.
  3. **Vendor probe** — for entities with a known manufacturer + known network address, optional secondary probe (banner grab, `/version` endpoint, container `inspect`). Off by default; opt-in per environment.
  4. **Description synthesis** — configured small inference profile summarizing the entity from its properties, taxonomy node, and signature match. At most two sentences. Cached. Re-runs only when input fields change.
- All enrichment runs as background jobs using the existing queue-function conventions in `apps/web/lib/queue/functions/`. Never blocks UI.
- Enrichment status surfaced on the entity detail page as a small badge: `enriched` / `partial` / `pending` / `failed (reason)`.

**Required-field gates.** A new `TaxonomyNode.governance.requiredFields` array. When required fields are unpopulated post-enrichment, a `PortfolioQualityIssue` of type `incomplete_detail` is created. This is the LeanIX-style meta-model gate.

### 6.4 Slice 4 — Detail page rendering

**Goal.** Render the data we already have plus the data Slice 3 just added.

**Changes.**

- `PortfolioNodeDetail.tsx`: add three scannable sections — **About** (renders `description`), **Governance** (renders `governance` JSON as labeled policy fields, not raw JSON), **Enrichment** (renders `enrichment` JSON: standards, patterns, references, links). Avoid nested cards; use full-width bands or compact repeated rows.
- Replace hardcoded color usage discovered in the current component (`PORTFOLIO_COLOURS`, inline `style={{ color }}`, `text-[#e2e2f0]`) with theme-aware status/accent tokens or CSS custom properties before expanding the component. This is part of the slice, not cleanup for later.
- Build `apps/web/app/(shell)/portfolio/[[...slug]]/products/[productId]/page.tsx` (or extend if it exists) — full `DigitalProduct` detail with: name + version, description, taxonomy lineage, manufacturer/model badge, technical class, icon, lifecycle stage/status, freshness state, linked `InventoryEntity` rows (with attribution evidence), enrichment status, recent quality issues, and recent change items.
- Stale-aging UI: `freshness = stale|retired` shown as a muted state plus filter toggle on portfolio listing. Default view hides retired but keeps a clear "show retired" control for auditability.
- Promotion-audit UI should be operational, not decorative: top summary strip, grouped blockers by reason, drill-in table with entity name/type/taxonomy/confidence/last seen, and one-click actions for classify, request enrichment, dismiss, or open the source entity.
- Empty-state copy should tell the operator which pipeline stage is missing signal: no discovered entities, discovered but unattributed, attributed but blocked from promotion, or promoted but missing enrichment.

All UI must follow AGENTS.md theme-aware styling: no hardcoded hex/Tailwind gray/text-white exceptions except text on accent buttons, explicit option colors, stable dimensions for status strips and action buttons, and no feature-explaining text that belongs in docs rather than the app.

### 6.5 Slice 5 — Portfolio Analyst governance loop

**Goal.** A standing, durable workflow that gives the Portfolio Analyst something to do daily/weekly with the outputs of slices 1–4.

**Changes.**

- New skill on AGT-WS-PORTFOLIO: `portfolio-completeness-review` at proposed path `skills/route-persona/portfolio-completeness-review.skill.md`. Inputs: portfolio root, time window. Steps: pull newly promoted products, taxonomy-gap proposals, completeness score per node. Outputs: a `PortfolioReview` work product (per the Coworker Operator Pattern) with approve/redirect actions.
- New MCP tools for the Portfolio Analyst:
  - `approve_taxonomy_gap_proposal(proposalId)` — promotes a gap proposal into a real `TaxonomyNode`.
  - `set_node_required_fields(nodeId, fields[])` — defines completeness gates.
  - `request_re_enrichment(productId)` — triggers Slice 3 manually.
- Portfolio dashboard adds a **Completeness** strip per portfolio root: % of products with full required fields, % with full enrichment, count of open quality issues by type.
- Daily scheduled task (08:30 UTC, after Estate Specialist's 08:00 triage): Portfolio Analyst's review run. Output is a `PortfolioReview` with explicit work items.

---

## 7. Data Model Changes

Schema changes are minimal — most fields exist already.

**Reuse before adding.**

- Use `DiscoveryFingerprintObservation`, `DiscoveryFingerprintReview`, `DiscoveryFingerprintRule`, and `DiscoveryFingerprintCatalogVersion` for recognition evidence, review, deterministic rules, and catalog versioning.
- Use existing `PortfolioQualityIssue.issueType` for operator-visible gaps. Do not add `PortfolioQualityIssue.kind`; the live model has `issueType`.
- Keep `TaxonomyNode.governance` and `TaxonomyNode.enrichment` as the policy/context home for node-specific promotion and completeness rules.

**Additions.**

- New `PortfolioQualityIssue.issueType` values: `type_not_promotable`, `taxonomy_gap_proposal`, `incomplete_detail`, `enrichment_failed`, `no_portfolio_root`, `low_confidence_promotion`. The implementation must add canonical constants and MCP enum/schema entries in the same commit if this field is formalized there; otherwise add a local typed union beside the issue helpers and tests that prevent hyphen/underscore drift.
- New column `InventoryEntity.freshness` — `fresh|stale|retired`. Default `fresh`. Updated by an aging job. Distinct from `status`/`lifecycleStatus`.
- New column `DigitalProduct.enrichmentStatus` — `pending|enriched|partial|failed`. Default `pending`.
- New column `DigitalProduct.lastEnrichedAt` — timestamp.

**No changes** to the four root portfolios, taxonomy structure, or the Discovery* tables.

**Conditional additions only if reuse fails.**

- A dedicated enrichment-signature table is allowed only if `DiscoveryFingerprintRule` cannot represent non-classifying enrichment signatures without weakening the fingerprint catalog. If added, it must reference the catalog/rule foundation instead of becoming a second source of truth.
- A persisted promotion-audit table is allowed only if query-time grouping cannot meet UX latency or historical-audit requirements. Start with derived state.

---

## 8. New Tools and Queue Functions

| Name | Owner | Purpose |
| - | - | - |
| `classify_inventory_entity` (MCP tool) | AGT-WS-INVENTORY / Estate Specialist alias | Run rules + model-assisted fallback classifier on one entity |
| `enrich_digital_product` (MCP tool) | AGT-WS-INVENTORY / Estate Specialist alias | Manually trigger enrichment for a product |
| `approve_taxonomy_gap_proposal` (MCP tool) | AGT-WS-PORTFOLIO | Promote a gap proposal into a real `TaxonomyNode` |
| `set_node_required_fields` (MCP tool) | AGT-WS-PORTFOLIO | Define completeness gates per taxonomy node |
| `request_re_enrichment` (MCP tool) | AGT-WS-PORTFOLIO | Trigger enrichment from the portfolio review |
| `enrich-digital-product` (queue fn) | system | Background enrichment chain |
| `classify-inventory-entity` (queue fn) | system | Background daily classification sweep |
| `age-inventory-freshness` (queue fn) | system | Daily freshness state update |

All MCP tools follow the existing `enum:` pattern in [`apps/web/lib/mcp-tools.ts`](../../../apps/web/lib/mcp-tools.ts). All queue functions follow [`apps/web/lib/queue/functions/`](../../../apps/web/lib/queue/functions/) conventions.

Tool naming note: the human-facing role may be "Estate Specialist", but grants should continue to resolve through the durable registry ID `AGT-WS-INVENTORY` plus the `estate-specialist` alias until a formal agent-ID migration is approved.

---

## 9. Refactoring Budget

Allocate roughly 20% of implementation effort to refactoring that directly reduces future rework. This is not optional polish; it is the architecture work that makes the slices safe.

1. **Promotion policy extraction.** Move promotion eligibility and skip-reason logic out of `promoteInventoryEntities` into a pure helper with table-driven tests.
2. **Shared quality issue writer.** Add one helper for opening/updating/resolving discovery-to-portfolio `PortfolioQualityIssue` rows so promotion, classification, enrichment, and aging do not each invent issue semantics.
3. **Fingerprint-rule adapter.** Add an adapter that translates active `DiscoveryFingerprintRule` matches into classification/enrichment decisions. Do not let web code query rule internals directly.
4. **Portfolio detail view model.** Add a server-side mapper for `PortfolioNodeDetail` and product detail pages so UI components receive labeled, theme-ready display data instead of raw JSON blobs.
5. **Coworker identity compatibility.** Add alias lookup and tests before changing prompt filenames/display names, so routed persona lookup, tool grants, scheduled tasks, and prompt seeding survive the rename.

Refactoring is bounded to this pipeline. Do not broaden into unrelated portfolio navigation, global theme redesign, or root-portfolio population.

---

## 10. Success Criteria

Measured against the same install referenced in §1.

| Criterion | Today | Target |
| - | - | - |
| InventoryEntities orphaned from DigitalProduct | 78/218 (36%) | < 5% (only genuinely non-promotable cases, with reason recorded) |
| DigitalProducts with `description` populated | 9/100 (9%) | ≥ 95/100 (95%) |
| InventoryEntities with `manufacturer` populated when applicable | 6/218 (3%) | ≥ 80% of bootstrap-known types (containers, databases, services) |
| InventoryEntities with `normalizedVersion` populated when `observedVersion` is set | 0/6 (0%) | 100% |
| TaxonomyNodes used by foundational products | 7/481 | ≥ 20 (more granular classification) |
| Stale `InventoryEntity` rows older than 14 days still showing as active | 98 today | 0 |
| `PortfolioNodeDetail` renders `description`, `governance`, `enrichment` | No | Yes |
| Promotion-audit page exists and shows blocked counts with reasons | No | Yes |
| Daily PortfolioReview produced by AGT-WS-PORTFOLIO | No | Yes |
| Estate Specialist coworker exists with that displayName | No | Yes |

---

## 11. Open Questions

1. **Agent ID migration.** This spec recommends preserving `AGT-WS-INVENTORY` and changing the visible/operator identity first. Should a later platform-wide agent-ID alias/migration pattern be designed so `AGT-WS-ESTATE` can become canonical without breaking historical rows?
2. **Model cost guardrail.** Slice 2's model-assisted fallback and Slice 3's description synthesis are per-entity. On a typical install (~200 entities) with weekly cadence this is trivial. On a large estate (10k+) it isn't. Should the cadence scale with estate size, or should there be a quota?
3. **Signature seed source.** Which bootstrap fingerprints should be hand-curated into `DiscoveryFingerprintRule` first? Proposal: ~30 entries covering DPF stack, then governed contribution through the hive (`contribute_to_hive`) so every install improves the dictionary the next install benefits from.
4. **Required-field gates as policy or default.** Should every taxonomy node have required-field gates from day one (LeanIX-style strict), or should gates be opt-in per node? Strict gates are cleaner but produce a cold-start flood of quality issues.
5. **Freshness threshold.** What counts as `stale` vs `retired`? Proposal: `stale` after 1 missed discovery run; `retired` after 14 days of misses. Configurable per portfolio.
6. **Empty portfolios.** This spec explicitly defers populating the three empty root portfolios. Do we file a follow-up epic now, or wait until the foundational pipeline is healthy?

---

## 12. Migration and Rollout

Order matters because Slice 1 widens the promotion gate before enrichment exists — items will land in the portfolio with skeleton data unless slices land together.

**Recommended landing order.**

1. **Slice 1 + Slice 4 (rendering)** together — widens the gate AND surfaces what's already there. Visible improvement immediately.
2. **Slice 3 (enrichment)** next — fills in the detail on items now reaching the portfolio.
3. **Slice 2 (classification)** alongside or just after Slice 3 — most bootstrap items are already classified by rules; this picks up edge cases.
4. **Slice 0 (operator identity rename)** as a coordinated compatibility slice — update display name, prompt copy, aliases, peer references, and tests while preserving `AGT-WS-INVENTORY`.
5. **Slice 5 (governance loop)** last — depends on signal from the earlier slices.

**Rollback.** Each slice is isolatable: Slice 1's wider gate can be reverted by disabling taxonomy promotion policy fallback; Slice 3's enrichment can be paused by disabling the queue function; Slice 4's rendering can be feature-flagged. The operator identity slice is rollback-safe if it preserves `AGT-WS-INVENTORY` and adds aliases rather than rewriting historical IDs.

---

## 13. Implementation Status

### Chunk 1 — Refactoring Foundation (landed 2026-04-30)

Pure helpers shipping zero production behavior change. All four foundation modules unit-tested; full @dpf/db + apps/web vitest suites green; production `next build` exit 0.

| Task | Commits | Tests |
| - | - | - |
| 1.1 Promotion policy resolver | `cea88828`, `5e889ab0` (spec fix), `0b438144` (polish) | 7/7 |
| 1.2 Shared quality-issue writer | `a631d8af`, `e1ed27e8` (polish) | 13/13 |
| 1.3 Fingerprint-rule adapter | `0e0fcaad`, `203d0dbc` (polish) | 9/9 |
| 1.4 Coworker identity alias resolver | `f67080c4`, `799047f6` (polish) | 13/13 |

**Build gate (Task 1.5):** `pnpm --filter @dpf/db exec vitest run` → 299 pass / 52 files. `pnpm --filter web exec vitest run` → 4389 pass / 14 skipped / 13 todo / 541 files. `cd apps/web && npx next build` → exit 0. 102 pre-existing Turbopack NFT-tracing warnings in `next.config.mjs` predate this chunk; tracked separately.

**Deviations from plan.** Task 1.1 originally included `already_linked` as a `PromotionSkipReason`; spec compliance reviewer caught that the spec's resolution order delegates that gate to the caller (Task 2.1's Prisma query). Removed in `5e889ab0`. Task 1.4 implementer used a `findRepoRoot()` walk-up (looks for `pnpm-workspace.yaml`) rather than `process.cwd()` for cross-context portability — matches the existing pattern in `apps/web/scripts/internal/build-grant-catalog.ts`. No other deviations.

**Open questions still pending (gating later chunks):**
- #2 Model cost guardrail (gates Chunk 4 Task 4.3 description-enricher).
- #3 Signature seed scope (gates Chunk 4 Task 4.3 fingerprint-enricher).
- #4 Required-field gates default (gates Chunk 7 Task 7.3).
- #5 Freshness thresholds (gates Chunk 4 Task 4.6).

**Pre-flight blocker for Chunks 4–5.** `DiscoveryFingerprintCatalogVersion` table is empty (0 rows) on the bootstrap install. The fingerprint adapter (Task 1.3) is already shippable — it just returns `null` for empty input — but Chunks 4–5 depend on rules existing in the catalog. Either the upstream fingerprint contribution slice needs to ship its seed, or this plan needs to bootstrap a small initial catalog before Chunk 4.

### Chunk 2 — Promotion Gate Fix + Audit Visibility (landed 2026-04-30)

Replaces the hardcoded `PROMOTABLE_TYPES` SQL filter with the Chunk 1 policy resolver, seeds default `governance.promotion` on every `TaxonomyNode`, surfaces every promotion skip as a `PortfolioQualityIssue`, and ships an admin audit page.

| Task | Commits | Tests |
| - | - | - |
| 2.1 Promotion uses policy resolver + writes quality issues | `a919096e` | 24/24 (10 promotion + 14 sibling helpers) |
| 2.2 Seed default promotion governance | `f788e69b` | 6/6 pure helper + invariant guard wired |
| 2.3 Promotion-audit query helper | `88e837cf`, `bdafea75` (count fix) | 7/7 |
| 2.4 Promotion-audit page UI | `0aaf9c02`, `98f93c3e` (REASON_LIST extraction) | 1/1 light load test |

**Build gate (Task 2.5):** `pnpm --filter @dpf/db exec vitest run` → 310 pass / 53 files. `pnpm --filter web exec vitest run` → 4397 pass / 14 skipped / 13 todo / 543 files. `cd apps/web && npx next build` → exit 0. Pre-existing Turbopack NFT warnings unchanged.

**Net runtime effect on the bootstrap install** (predicted; pending re-verification on the live install):
- 78 previously-orphaned `InventoryEntity` rows (`network_client`, `access_point`, `vlan`, `switch`, `service`) now flow through the resolver.
- After re-seeding (which writes `governance.promotion.mode: "auto"` on the foundational subtree, with `classifyAs: "infrastructure_endpoint"` on `foundational/network_management/*`), those 78 rows promote to `DigitalProduct` with `observationConfig.classifyAs: "infrastructure_endpoint"`.
- Any remaining skips appear as open `PortfolioQualityIssue` rows visible at `/platform/tools/discovery/promotion-audit`.

**Deviations from plan.** Task 2.3's first commit set `BlockedReasonGroup.count = sample.length` (capped at 10) which would have shown "10" instead of the real total on the audit page; fixed in `bdafea75` to issue per-reason `count()` queries in parallel with `findMany()`. Task 2.4 manual UX verification (plan Step 4) deferred — page compiles, theme tokens grep-clean, light load test passes, but a logged-in `/platform/tools/discovery/promotion-audit` smoke check still owed against the running portal once the branch is rebased to main.

**Open questions still pending (gating later chunks):** unchanged from Chunk 1 — #2 (model cost guardrail), #3 (signature seed scope), #4 (required-field gates default), #5 (freshness thresholds). All gate Chunks 4 and 7.

### Chunk 3 — Detail Page Rendering (landed 2026-04-30)

Renders the three `TaxonomyNode` JSON columns (`description`, `governance`, `enrichment`) that the schema already had but the detail UI was ignoring. Adds a full `DigitalProduct` detail page with a typed view-model abstraction. Theme-token cleanup of `PortfolioNodeDetail` lands as part of the chunk per spec §6.4.

| Task | Files | Tests |
| - | - | - |
| 3.1 Portfolio node view model | `apps/web/lib/portfolio/portfolio-node-view-model.ts` + test | 12/12 |
| 3.2 Theme-token cleanup of PortfolioNodeDetail | `PortfolioNodeDetail.tsx` (refactored — `PORTFOLIO_COLOURS` import dropped, every hardcoded color replaced with `var(--dpf-*)` tokens) | n/a (build verified) |
| 3.3 About/Governance/Enrichment sections | 3 new components + tests; widened `PortfolioTreeNode` type + `getFullPortfolioTree` Prisma select | 15/15 |
| 3.4 Digital product detail page | `digital-product-view-model.ts` + 3 components + page (4 files + 4 tests) | 35/35 (after multi-row table extension) |

**Build gate (Task 3.5):** `pnpm --filter @dpf/db exec vitest run` → 304 pass / 53 files. `pnpm --filter web exec vitest run` → 4494 pass / 14 skipped / 13 todo / 557 files. `cd apps/web && npx next build` → exit 0.

**Deviations from plan.**

- **Task 3.4 route path forced to relocate** from `/portfolio/[[...slug]]/products/[productId]` to `/portfolio/products/[productId]`. Next.js refuses children under optional catch-all routes ("Optional catch-all must be the last part of the URL"). Static segments still win route matching, so the new URL resolves correctly. Documented in the page header comment.
- **Task 3.4 deferred sections to Chunk 4.** `enrichmentStatus` / `lastEnrichedAt` / "recent change items" not rendered yet — dependent on Chunk 4 schema columns (`InventoryEntity.freshness`, `DigitalProduct.enrichmentStatus`, `DigitalProduct.lastEnrichedAt`). View model accepts them as optional inputs (forward-compatible); component carries `TODO(Chunk 4 Task 4.3)` comments at the insertion points. `FreshnessBadge` degrades to muted "Unknown" when freshness is undefined.
- **Per-portfolio-root color differentiation removed** from `PortfolioNodeDetail` (Task 3.2). Spec §6.4 endorsed replacing `PORTFOLIO_COLOURS` with theme tokens; the four other consumers (`PortfolioTreeNode`, `PortfolioOverview`, `DiscoveryOperationsPage`, `AgentGovernanceCard`) still import the constant from `apps/web/lib/evaluate/portfolio.ts` and remain unchanged.
- **Manual UX verification deferred.** Plan Task 3.2 calls for "light + dark + brand override" check; Task 3.3 calls for "view a foundational node with description/governance present and one without"; Task 3.4 calls for "drill into an existing promoted product, confirm all sections render". All three are owed against the running portal once this branch lands and the install is re-deployed. Theme-token grep is empty across all new TSX files; component tests assert empty-state behavior + raw-JSON-leak prevention.

**Carry-overs to Chunk 4.**

- Render an Enrichment section in `DigitalProductDetail` reading `vm.enrichmentStatus` + `vm.lastEnrichedAt` once the schema columns land.
- Render recent `ChangeItem` rollups for a product (spec §6.4 calls this out; per-product query helper does not exist yet).
- The `colour` prop on `ProductList` is now effectively dead (detail callers pass a literal token string the component ignores). Cleanup candidate.
- `AgentGovernanceCard.tsx` still falls back to a hardcoded hex `"#555566"` — flag for the next theme-token sweep.

### Chunk 6 — Operator Identity Rename (compatibility-safe, landed 2026-04-30)

Display + alias only; the durable `agent_id` `AGT-WS-INVENTORY` is preserved. Both "estate-specialist" (new canonical handle) and "inventory-specialist" (historical name) resolve to the same coworker record.

| Task | Files | Tests |
| - | - | - |
| 6.1 Alias on AGT-WS-INVENTORY | `packages/db/data/agent_registry.json` (added `displayName` + `aliases`); `apps/web/lib/coworker-identity.test.ts` (+3 default-loader tests) | 16/16 |
| 6.2 Persona prompt copy | `prompts/route-persona/inventory-specialist.prompt.md` (displayName + role title updated); `prompts/route-persona/estate-specialist.prompt.md` (new, near-duplicate); `prompts/route-persona/explore-orchestrator.prompt.md` (peer label updated) | n/a (prompts) |

**Build gate (Task 6.3):** `pnpm --filter @dpf/db exec vitest run` → 315 pass / 54 files. `pnpm --filter web exec vitest run` → 4465 pass / 14 skipped / 13 todo / 558 files. `cd apps/web && npx next build` → exit 0.

**Deviations from plan.**

- **Two prompt files share content.** Plan called for `estate-specialist.prompt.md` to be a near-duplicate of `inventory-specialist.prompt.md`. They are. Both files set `agent_id: AGT-WS-INVENTORY` so the prompt loader treats them as two `PromptTemplate` rows pointing at the same canonical agent. The duplication risk (drift if one is edited without the other) is flagged with an HTML comment at the top of `estate-specialist.prompt.md`. A future loader-level aliasing pass can collapse the two files into one source.
- **HTML duplication-warning comment placed AFTER frontmatter, not before.** The prompt loader's frontmatter regex (`packages/db/src/seed-prompt-templates.ts`) requires the file to start with `---\n`. Putting the warning comment at the top would silently fail frontmatter parsing. Comment moved to the first line of the body — still the first thing a maintainer sees inside the markdown body.
- **Three "Product Manager" mentions intentionally NOT updated.** `prompts/specialist/release-acceptance-agent.prompt.md` and `prompts/specialist/roadmap-assembly-agent.prompt.md` reference "Digital Product Manager (HR-200)" — the human supervisor role, not AGT-WS-INVENTORY. `packages/db/src/seed.ts:929` has a legacy fallback seed entry `name: "Product Manager"` which is now superseded by the registry's `displayName` patch (registry wins at runtime). Tracked for a future cleanup sweep but not in scope for Chunk 6.
- **No DB schema migration for aliases.** The Prisma `Agent` model has no `aliases` or `displayName` columns. The resolver (`apps/web/lib/coworker-identity.ts`) reads `agent_registry.json` directly from disk, bypassing the DB; all other registry consumers I found do the same. If a future feature wants to query aliases via Prisma, a schema migration would add the columns and the seed mapping would need explicit fields.

**Carry-overs.**

- `packages/db/src/seed.ts:929` legacy "Product Manager" fallback can be removed once we confirm no caller depends on it.
- `packages/db/data/agent_registry.json` `capability_domain` copy for `AGT-WS-INVENTORY` still describes the role in product-management language; refresh in a future sweep.
- A loader-level aliasing pass in `seed-prompt-templates.ts` could let `estate-specialist.prompt.md` redirect to `inventory-specialist.prompt.md` instead of duplicating content.

---

## 14. References

- [2026-03-13 Bootstrap Infrastructure Discovery and Portfolio Quality Foundation](./2026-03-13-bootstrap-infrastructure-discovery-and-portfolio-quality-foundation-design.md)
- [2026-04-30 AI Coworker Operator Pattern](./2026-04-30-ai-coworker-operator-pattern.md)
- [2026-04-28 Coworker and Routing Sequencing Plan](../plans/2026-04-28-coworker-and-routing-sequencing-plan.md)
- Code: [`packages/db/src/discovery-promotion.ts`](../../../packages/db/src/discovery-promotion.ts), [`packages/db/src/discovery-triage-config.ts`](../../../packages/db/src/discovery-triage-config.ts), [`apps/web/components/portfolio/PortfolioNodeDetail.tsx`](../../../apps/web/components/portfolio/PortfolioNodeDetail.tsx)
- Prompts: [`prompts/route-persona/inventory-specialist.prompt.md`](../../../prompts/route-persona/inventory-specialist.prompt.md), [`prompts/route-persona/portfolio-advisor.prompt.md`](../../../prompts/route-persona/portfolio-advisor.prompt.md)
- Schema: [`packages/db/prisma/schema.prisma`](../../../packages/db/prisma/schema.prisma) — `DigitalProduct` (504), `TaxonomyNode` (832), `InventoryEntity` (2511)
