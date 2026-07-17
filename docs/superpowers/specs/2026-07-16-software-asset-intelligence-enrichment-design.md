# Software & Asset Intelligence — Discovery Enrichment, Normalization Catalog & Support-Lifecycle Feeds

**Date:** 2026-07-16
**Status:** Draft (backlog + spec only — no code this cycle, per CEO decision 2026-07-16)
**Epic:** EP-ASSET-INTELLIGENCE
**Supersedes / consolidates:** `2026-04-18-lifecycle-evidence-specialist-design.md` and the enrichment intent in `2026-04-30-discovery-portfolio-gap-closure-design.md` (both Draft, never implemented)
**Grounded in:** live `packages/db/prisma/schema.prisma` verification (2026-07-16) + external reference research (Technopedia/Flexera, ServiceNow SAM/HAM, open feeds)

---

## 1. Why this exists

Discovery finds an asset; **enrichment investigates it and fills in the detail** — normalized vendor, product, version/edition, support lifecycle (release / end-of-support / end-of-life), vulnerabilities, and a human-readable description. This is the same "normalize discovered data against a reference catalog + lifecycle feed" pattern that **BDNA/Technopedia (Flexera)** and **ServiceNow SAM/HAM Content Service** are built on.

DPF **designed** this (the two superseded specs above) but **never built it.** Verified absent from the live schema/code on 2026-07-16:

- No canonical models: `CatalogIdentity`, `CatalogLifecycleMilestone`, `FingerprintRule`, `IdentityResolutionLog`.
- No enrichment fields on `InventoryEntity` / `DigitalProduct` (`catalogIdentityId`, `updatePosture`, `latestKnownVersion`, `supportLifecycleSource/Confidence`, `identityStatus/Confidence`, `enrichmentStatus`, `lastEnrichedAt`). `supportStatus` is a bare string defaulting to `"unknown"` (spec snapshot: 120/120 items `unknown_support`, 114 missing manufacturer/version).
- No enrichment engine: no `apps/web/lib/queue/functions/enrich-digital-product.ts`, no `enrich_digital_product` / `request_re_enrichment` MCP tools.
- `DiscoveredSoftwareEvidence.softwareIdentityId` (`schema.prisma:3638`) is a **dangling FK** to a table dropped in migration `20260320222431`.
- The **estate-specialist** agent (`AGT-WS-INVENTORY`) that is supposed to own enrichment exists only as a prompt (`prompts/route-persona/estate-specialist.prompt.md`) — the tools it references don't exist.

**What does exist:** discovery/inventory (`InventoryEntity`, cross-platform collectors), a **read-only** patch-posture wedge (`/ops/patches`, `apps/web/lib/patch/*`) fed by **OSV + CISA KEV** (language ecosystems only, findings-only), the `AssuranceFinding` ledger, and the gated `RemoteAction` execution primitive.

So DPF has a **vulnerability feed but no software normalization catalog, no EOL/EOS lifecycle feed, no SAM/license, no reclamation, and no hardware lifecycle/financials** — precisely the BDNA/Flexera/ServiceNow-SAM/HAM gaps.

The vestigial `data-enrichment` / `document-parser` / `advanced-code-analysis` `ModelProvider` service rows in `packages/db/data/providers-registry.json` are leftovers of the superseded EP-MCP-SURFACE-001 design; they gesture at this capability but have no engine behind them. They are retired by this epic (BI-3EE51676).

---

## 2. Positioning — compose open feeds, don't clone Flexera

The reference products' moat is **proprietary catalog data** at a scale DPF will not license: Technopedia claims 5M+ products / 4,500+ daily updates ([Flexera Technopedia](https://www.flexera.com/products/technopedia)); ServiceNow's SAM content service tracks ~680,000 lifecycle entries across 2,558 publishers / 21,000 products, synced weekly ([ServiceNow: Software Product Lifecycles](https://www.servicenow.com/community/sam-blog/navigating-software-product-lifecycles-a-key-to-effective/ba-p/3030314)).

DPF's deliberate choice (echoing the patch-management spec's "compose standards + build governance") is to **assemble open feeds behind a CPE-keyed normalization spine, and build the governance/evidence/agent layer natively.** The research confirms the open feeds fully cover four of the pillars and leave exactly two proprietary "build-or-curate" moats:

| Pillar | Open-feed coverage | Verdict |
|--------|--------------------|---------|
| Software/vuln **identity** | **CPE 2.3** (NVD dictionary ~1.77M names) + SWID tags + Wikidata backfill | Coverable |
| **Support lifecycle** (release/EOL/EOS/EOES) | **endoflife.date v1** (MIT, ~461 products) + manual overlay for long-tail | Coverable (mainstream), overlay for tail |
| **Vulnerability** intel | **NVD CVE** (installed/commercial via CPE) + **OSV** (OSS ecosystems) + **CISA KEV** (exploited priority) | Coverable |
| Firmware/HW **model hints** | **LVFS/fwupd** + endoflife.date hardware + Wikidata | Partial backfill |
| **License entitlement / rights** (SAM) | *No open substitute* — Flexera 900k-app PURL library, SN Publisher Packs | **Build-or-curate** |
| **Reclamation / HAM financials / SaaS** | *No open catalog* | **Native build** |

---

## 3. Capability pillars & target (from reference research)

Canonical checklist a native platform must match to credibly claim "asset + software management with support-lifecycle feeds":

(a) discovery/inventory · (b) software normalization catalog/identity · (c) support-lifecycle data (release/EOL/EOS) · (d) vulnerability intel · (e) patch/remediation · (f) license entitlement & compliance (SAM) · (g) reclamation/usage metering · (h) hardware lifecycle & financials (HAM) · (i) SaaS management · (j) CMDB/CSDM model.

DPF today: (a) built, (d) partial (OSS-only), (e) read-only wedge, (j) strong CSDM-aligned ontology. **Missing: (b), (c), (f), (g), (h), (i).**

---

## 4. Design

### 4.1 The normalization spine — `CatalogIdentity`

The canonical, deterministic **manufacturer → product → version → edition (→ patch level)** identity — the open analog of the Technopedia hierarchy ([Flexera: power of normalization](https://www.flexera.com/blog/it-visibility/the-power-of-normalization-a-key-to-unlocking-it-efficiency/)). Machine key: **CPE 2.3** (`cpe:2.3:<part>:<vendor>:<product>:<version>:<update>:<edition>:…`, part ∈ {a,o,h}) ([NVD CPE Dictionary](https://nvd.nist.gov/products/cpe)). Raw vendor strings (`DiscoveredSoftwareEvidence.rawVendor`) **never** leak directly onto the canonical identity — only the fingerprint/normalize pipeline sets `CatalogIdentity.manufacturer`, via rules (2026-04-18 §7.2 mapping note).

Companion models (2026-04-18 §7.2):
- **`CatalogLifecycleMilestone`** — child of `CatalogIdentity`; one row per named milestone (`mainstream_end`, `extended_support_end`, `eol`, `eosl`, `security_updates_end`), each with `date`, `source`, `confidence`. Lifecycle is structured, not a flat string.
- **`FingerprintRule`** — deterministic raw-evidence → `CatalogIdentity` matcher; `status` (`shadow|active|rejected`), `origin` (`seeded|human|auto_promoted`).
- **`IdentityResolutionLog`** — resolution lineage/audit; `resolutionType` (`rule|ai_resolved|human_confirmed|human_corrected`), confidence, evidence packet. Human-confirmed rows are never overwritten by a rule (2026-04-18 §6.3.1).

### 4.2 The enrichment pipeline (the engine that was never built)

A **decoupled, continuous** stage (not one-shot), triggered on promotion + weekly cadence + manual request. Stages (2026-04-18 §6.3): **Scan → Fingerprint → Normalize → Infer → Proceduralize → Detect-drift → Human-fallback.** Deterministic rules first; a **cheap-model** fallback (via `apps/web/lib/ai-inference.ts`, **no vendor pinning**) resolves the ambiguous tail; repeated AI successes are promoted to **shadow** `FingerprintRule`s and auto-applied only at confidence ≥ 0.97. Owned by the estate-specialist agent, exposed via `enrich_digital_product` + `request_re_enrichment` MCP tools. **Cost guardrail required**: batching + budget cap for per-entity inference at 10k+ estate scale (gap-closure §11 Q2 open question).

Writes results onto `InventoryEntity` / `DigitalProduct` (§4.3), with lineage in `IdentityResolutionLog`.

**AI fallback — LANDED (BI-85359521).** The cheap-model fallback deferred from BI-27EE2AF7 is built as a **decoupled governed stage** (the altitude the kernel selected — DI-7D4E383E9944 — over inlining in `discovery-normalize` or folding into the CatalogIdentity enrichment sweep). Engine: `packages/db/src/catalog-identity-inference.ts` (`runIdentityInferenceFallback`) — a pure loop over an injectable inference fn + client that scans unresolved `InventoryEntity` (catalogIdentityId null / identityStatus in {null, needs_review, needs_reresolve}, never `human_confirmed`) stalest-first, and per proposal: writes an `IdentityResolutionLog(resolutionType='ai_resolved')` row, keeps `InventoryEntity.catalogIdentityId` untouched during the shadow window, promotes repeated identical resolutions of an entity to a `status='shadow'` `DiscoveryFingerprintRule`, and auto-applies the identity **only at confidence ≥ 0.97**. A contradicting `human_confirmed`/`human_corrected` resolution demotes the shadow rule to `rejected`, and a `human_confirmed` identity is never overwritten (§4.1). **Cost guardrail:** the model calls are **batched** (`batchSize`) and bounded by a **per-run inference-token budget cap** + hard call cap, so a 10k+-entity estate cannot blow the AI budget in one pass; the remainder rotates in on the next poll. Governed home: `apps/web/lib/asset-intelligence/identity-inference-{constants,runner}.ts` + the `identity-inference-fallback` scheduled Inngest job (weekly Tue 04:43 + a run-now event), wiring the real prisma and a `routeAndCall(budgetClass="minimize_cost")` inference fn (dynamic model discovery, no vendor pinning).

### 4.3 Existing-model updates

`InventoryEntity` gains: `catalogIdentityId` (FK), `identityStatus`/`identityConfidence`, `updatePosture` (`unknown|current|behind|ahead`) + source + confidence, `latestKnownVersion`, `supportLifecycleSource`/`supportLifecycleConfidence`. `DigitalProduct` gains: `enrichmentStatus` (`pending|enriched|partial|failed`), `lastEnrichedAt`. The dangling `softwareIdentityId` is resolved **in the same migration that lands `CatalogIdentity`** (rename→`legacySoftwareIdentityId` + join, or drop-with-evidence) — post-state invariant: no discovery/inventory field points at a non-existent table (2026-04-18 §7.4).

### 4.4 Open feeds (Phase B)

- **endoflife.date v1** → `CatalogLifecycleMilestone`. `GET /api/v1/products/{name}/` returns `releases[]` with `releaseDate`, `isEol/eolFrom`, `isEoas/eoasFrom` (active support), `isEoes/eoesFrom` (extended support). Each product's `identifiers[]` carries **CPE**, the join back to `CatalogIdentity`. MIT-licensed, community-maintained (no SLA), ~461 products → maintain a manual overlay table for commercial long-tail. ([endoflife.date API](https://endoflife.date/docs/api))
- **NVD CPE + CVE** → CPE crosswalk on `CatalogIdentity`; unlocks CVEs for **installed/commercial** products (today's OSV coverage is OSS-only). NVD API `services.nvd.nist.gov/rest/json/cpes/2.0`; free API key → 50 req/30s. ([NVD Product APIs](https://nvd.nist.gov/developers/products))
- **OSV** (OSS ecosystems) + **CISA KEV** (exploited-in-wild priority overlay) — already integrated; retained.
- **LVFS/fwupd**, **Wikidata**, endoflife.date hardware — model/EOL backfill hints for HAM (Phase D).

### 4.5 UI surfaces

Support-lifecycle signal (`supportStatus`, `updatePosture`, `latestKnownVersion`, `supportEndsAt`) rendered on `/ops/patches` tiles and on the estate + `DigitalProduct` detail pages. EOL/patch findings write into the existing `AssuranceFinding` ledger (`findingKind`: `unsupported-component` = EOL, `missing-patch`) — **no parallel finding table** (respect the EP-ASSURANCE-LEDGER one-substrate rule).

### 4.6 Coworker & skills — extend, don't add a role — **LANDED**

No new AI coworker role is required. The **Digital Product Estate Specialist** (`AGT-WS-INVENTORY`, `estate-specialist` / `inventory-specialist` prompts) already owns the daily Discovery Taxonomy Gap Triage, support posture, and dependency mapping — enrichment is a direct extension of its existing remit. What was added (BI-1D25BC3C):

- **MCP tools** in the discovery-inventory pack: `enrich_digital_product` (run CPE + endoflife enrichment now for one product's identities and stamp `enrichmentStatus`) and `request_re_enrichment` (flag a product/entity so the next catalog sweep re-resolves it). Backing logic: `packages/db/src/enrich-digital-product.ts` (`enrichCatalogIdentity` / `enrichDigitalProduct` / `requestReEnrichment`).
- **Tool grants** on `packages/db/data/agent_registry.json`: a dedicated finer grant **`enrichment_write`** (Pseudo-User Contract direction — scoped + auditable, not folded into the broad `registry_write`) gates the two enrich tools and is held by the estate-specialist. `contribute_to_hive` is already authorized for it via its existing `backlog_write` grant.
- **New coworker skills** (2026-04-18 §9.3): `skills/inventory/improve-fingerprint-rule.skill.md` (propose/refine a `DiscoveryFingerprintRule` from a resolution-log miss) and `skills/inventory/show-identity-resolution.skill.md` (show the full `IdentityResolutionLog` lineage for an item), both `assignTo: inventory-specialist`.
- **Reuse the existing sharing agent/loop:** the hive-scout agent + `contribute_to_hive` + `run_hive_scout_ingest` + the built device-fingerprint contribution path (`packages/db/src/device-fingerprint-contribution.ts` — `buildFingerprintContribution`/`decideInboundActivation`) already carry the outbound/inbound "hive-mind" loop. Enrichment plugs into it rather than inventing a second one.

### 4.7 Cross-customer sharing — public vs proprietary (reuse the egress boundary)

The mechanism the CEO is asking about **already exists** and must be reused, not re-invented: the **public-egress boundary** (`2026-06-19-hive-contribution-architecture-and-egress-model.md`, epic EP-1A78BAE1) built on the same kernel/org-overlay pattern DPF uses for knowledge (`WikiPage` kernel vs org overlay; `principlePublic`; `contributionStatus local→contributed`).

Applied to enrichment:

- **Public / commodity technology** — Windows, PostgreSQL, a Dell PowerEdge model, a common OSS library. Its `FingerprintRule`, CPE mapping, and `CatalogLifecycleMilestone` rows are **generic, redacted, and broadly reusable** → eligible to contribute to the shared hive catalog so every opt-in install recognizes it deterministically instead of re-resolving it. **Hardware fingerprint contribution is already built** (`device-fingerprint-contribution.ts`) — consistent with the CEO's point that hardware is nearly all commodity and safely shareable.
- **Proprietary / local-only technology** — a company's bespoke internal app. Classified `proprietary`/`local-only`, **fail-closed `private` by default**, **never egresses**, and requires human approval even to mark shareable (fingerprint spec §10 routes "the identity is proprietary or local-only" and any raw evidence with private strings/hostnames/customer names straight to human review, and blocks contribution when `redactionStatus = blocked_sensitive`). Software has materially more proprietary cases than hardware — exactly the CEO's distinction.
- **The determinant is identity classification, not the tool.** Egress applies only at *public-hive* boundary; a customer's own repo/install (`dpf/install`) is the unfiltered proprietary home. Redaction (§12 of the fingerprint spec) strips private literals before any contribution candidate is drafted; the daily coworker triage proposes `auto-accept` / `human-review` / `local-only` / `reject` / `gather-more-evidence` per observation.

Net: public-tech catalog + lifecycle knowledge flows to the commons (opt-in); proprietary tech stays sovereign. Zero new infra — git + Postgres + in-process, mirroring the knowledge-segregation substrate.

### 4.8 SBOMs as an enrichment source (many products in one package)

An SBOM enumerates the many software components inside one package — a rich enrichment input. The substrate exists: `cyclonedx-generator.ts` → `BomDocument` → `BomComponent` (`name`, `version`, `packageUrl`/PURL, `supplierName`, `licenseExpression`, `componentType`) → `BomComponentOccurrence` (`schema.prisma:4990+`), under EP-ASSURANCE-LEDGER; a `sbom` portfolio projector is designed in `2026-06-21-portfolio-coverage-multisource-projection-design.md` but the components are **not yet normalized into the identity/lifecycle spine**.

Bridge: each `BomComponent` PURL/CPE → resolve to a `CatalogIdentity` → attach `CatalogLifecycleMilestone` (EOL/EOS) + CVEs (via the CPE crosswalk). One SBOM ingest thus enriches dozens/hundreds of identities at once.

**Sharing split maps cleanly onto §4.7:**
- **`BomComponent`** (the generic component identity — usually public OSS: a log4j version, an openssl version) → **public/shareable** catalog knowledge.
- **`BomComponentOccurrence`** (the fact that *this proprietary product v3* contains *those specific components/versions*) → **proprietary composition** (IP + attack-surface); stays **private** (org-overlay), never contributed even when each component's generic entry is public.

This is the kernel/org-overlay pattern again: component catalog entries are kernel; the product↔component graph is org overlay.

---

## 5. Phasing (maps 1:1 to backlog)

**Phase A — Enrichment core** (the "make it work"):
- Canonical models + dangling-FK fix — **BI-74579817**
- Enrichment fields on InventoryEntity/DigitalProduct — **BI-70469721**
- enrich-digital-product pipeline + estate-specialist tools + cost guardrail — **BI-27EE2AF7**
- AI-assisted identity-resolution fallback for the ambiguous tail + per-run inference cost guardrail — **BI-85359521** — **LANDED** (the cheap-model fallback deferred from BI-27EE2AF7; engine `packages/db/src/catalog-identity-inference.ts`, governed weekly Inngest job `identity-inference-fallback`; shadow window + auto-promote at ≥0.97 + human-precedence demotion + batched/budget-capped guardrail). See §4.2.
- FingerprintRule catalog + legacy warm-start — **BI-0528AD01**

**Phase B — Open support-lifecycle & vuln feeds:**
- endoflife.date connector → CatalogLifecycleMilestone (+ optional vendor calendars) — **BI-3A2328D6** — feed logic **landed** in `packages/db/src/endoflife-lifecycle.ts` (`releaseToMilestones`/`selectRelease`/`fetchEolProduct`/`upsertLifecycleForIdentity`, endoflife.date→milestone mapping + idempotent upsert onto CatalogIdentity); the scheduled sweep that iterates CatalogIdentities + the CPE-keyed slug resolution are the follow-up wiring.
- NVD CPE 2.3 crosswalk + broaden vuln beyond OSS — **BI-44B8B1E4** — crosswalk **landed** in `packages/db/src/cpe-crosswalk.ts` (`buildCpe23` deterministic CPE 2.3 from a CatalogIdentity, `fetchNvdCpeNames` NVD-dictionary resolution, `resolveCatalogIdentityCpe` sets `CatalogIdentity.cpe`); broadening vuln lookups to installed/commercial products via the resolved CPE is the follow-up.
- OS-package patch coverage + EOL/support posture UI — **BI-9C0424E4** — the **UI half landed**: the inventory entity detail page (`apps/web/app/(shell)/inventory/entity/[entityId]/page.tsx`) now surfaces the enrichment — update posture, latest known version, the resolved CatalogIdentity (manufacturer/product/CPE), and its endoflife.date support-lifecycle milestones. The **logic half is implemented through EP-PATCH-MANAGEMENT child BI-B747424D**: the existing daily `patch-assessment-sweep` now composes OSV/KEV with CatalogIdentity CPE → NVD CVE lookup, carries `CatalogLifecycleMilestone` EOL dates, and writes only to the existing `AssuranceFinding` ledger (`missing-patch` for NVD/CPE advisories, `unsupported-component` for EOL).
- SBOM → CatalogIdentity enrichment bridge (component=public, occurrence=private) — **BI-19FD07F9** — bridge **landed** in `packages/db/src/sbom-catalog-bridge.ts` (`parsePurl` + `bomComponentToCatalogIdentity` + `upsertIdentitiesForComponents`: BomComponent PURL → canonical CatalogIdentity, `source='sbom'`; the private `BomComponentOccurrence` graph is untouched). **Linking `BomComponent.catalogIdentityId` LANDED** (BI-877FE5D4): migration `20260717040000` adds the nullable FK (`onDelete: SetNull`, indexed); the bridge writes it back when given the component id, and the catalog sweep's SBOM stage passes the id so the weekly loop links components as it ingests — the component↔identity join the SBOM view traverses to lifecycle/CVEs. `BomComponentOccurrence` (product↔component IP) still stays private (§4.7/§4.8).
- **Scheduled catalog-enrichment sweep — LANDED.** The three feeds above are now driven by one governed autonomous loop (`packages/db/src/catalog-enrichment-sweep.ts` `runCatalogEnrichmentSweep`): a weekly Inngest cron + manual "run now" event (`ops/catalog-enrichment-sweep-scheduled`/`.requested`, registered in `SCHEDULED_JOB_CATALOG`) iterates the `CatalogIdentity` spine and runs SBOM ingest (`upsertIdentitiesForComponents`), CPE resolution (`resolveCatalogIdentityCpe`), and endoflife.date lifecycle (`fetchEolProduct` + `upsertLifecycleForIdentity`) — bounded per-poll (stalest-first, so repeated polls rotate the whole spine) and Vercel-friendly. Slug resolution is best-effort from the product name (`deriveEolSlug`); the manual overlay still covers the long tail (§4.4). Phase B CPE→CVE broadening, OS-package patch projection, and `BomComponent.catalogIdentityId` linkage have now landed through the CatalogIdentity spine; remaining gaps are the explicitly deferred SAM/HAM roadmap items in Phases C/D.

**Enablement (coworker + sharing):**
- Estate-specialist enrichment skills + hive-contribution grants + public/proprietary egress classification — **BI-1D25BC3C** — **LANDED (tools + grants + skills):** `enrich_digital_product` / `request_re_enrichment` MCP tools (backed by `packages/db/src/enrich-digital-product.ts`), a dedicated `enrichment_write` grant on the estate-specialist (`contribute_to_hive` already via `backlog_write`), and the `improve-fingerprint-rule` / `show-identity-resolution` coworker skills. See §4.6.

**Phase C — SAM (roadmap):**
- License entitlement & compliance (ELP, contracts, true-up) — **BI-E454034B**
- Reclamation & usage metering — **BI-55756F66**
- SaaS management — **BI-30151E25**

**Phase D — HAM (roadmap):**
- Hardware lifecycle & financials — **BI-3D1DBFBE**

**Cross-cutting:**
- Retire placeholder ModelProvider rows once real enrichment lands — **BI-3EE51676** (supersedes BI-D9EA2D9C)

---

## 6. Non-goals / explicit deferrals

- **Cloning a proprietary catalog** (Technopedia's 5M products, ServiceNow's publisher rules). We compose open feeds + hand-curate publisher rules for the top vendors only.
- **A complete package-vulnerability database inside DPF** (supply-chain spec non-goal); we consume OSV/NVD/KEV.
- **Auto-mutating remediation/reclamation** — any uninstall/patch apply goes through the gated `RemoteAction` path with approval, never automatically.
- **A new finding table** — reuse `AssuranceFinding`.
- Phases C/D are **roadmap**; sequencing is steered before build. This cycle is **backlog + spec only**.

---

## 7. Data-model stewardship notes

- `CatalogIdentity` holds the current normalized result; `IdentityResolutionLog` + `FingerprintRule` hold evidence + rule lifecycle — do not collapse (2026-04-18 §7.1, mirrors the fingerprint-pipeline stewardship rule).
- All four new models + the InventoryEntity/DigitalProduct column additions land under **data-architecture stewardship review** (this is a data-model change, a founder-gated concern).
- The dangling-FK fix is a hard prerequisite invariant, not optional cleanup.

---

## 8. Testing strategy (when built)

- Golden path: discover → fingerprint-match → normalize to `CatalogIdentity` → endoflife.date populates `CatalogLifecycleMilestone` → `InventoryEntity.supportStatus`/`updatePosture` set → `/ops/patches` shows EOL/behind posture → `AssuranceFinding` written for out-of-support items.
- Auto-promote path (2026-04-18 §11): repeated identical AI resolutions create a `status='shadow'` rule that writes only `IdentityResolutionLog` (never `catalogIdentityId`) during the shadow window; a contradicting human correction demotes it to `rejected`.
- Feed resilience: endoflife.date slug↔CPE mapping, NVD rate-limit backoff, long-tail overlay fallback.

---

## Appendix — open feed reference (cited)

- **endoflife.date** — MIT, ~461 products, v1 API (`/api/v1/products/`, `/api/v1/products/{name}/`, `identifiers[]` = CPE). [home](https://endoflife.date/) · [API](https://endoflife.date/docs/api) · [repo](https://github.com/endoflife-date/endoflife.date)
- **NVD CPE / CVE** — CPE 2.3 (13-field), ~1.77M names; 5/30s anon, 50/30s keyed. [CPE](https://nvd.nist.gov/products/cpe) · [Product APIs](https://nvd.nist.gov/developers/products) · [Vuln APIs](https://nvd.nist.gov/developers/vulnerabilities)
- **OSV.dev** — OpenSSF OSV schema, 24+ ecosystems. [FAQ](https://google.github.io/osv.dev/faq/) · [schema](https://ossf.github.io/osv-schema/)
- **CISA KEV** — JSON/CSV, no auth. [catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) · [feed](https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json)
- **SWID (ISO/IEC 19770-2)** / **CycloneDX** / **SPDX** — identity vs composition standards. [overview](https://www.aikido.dev/blog/understanding-sbom-standards-a-look-at-cyclonedx-spdx-and-swid)
- **LVFS/fwupd** — firmware model/version. [fwupd](https://fwupd.org/) · [LVFS](https://lvfs.readthedocs.io/en/latest/intro.html)
- Reference products: [Flexera Technopedia](https://www.flexera.com/products/technopedia) · [FlexNet Manager](https://www.flexera.com/products/flexnet-manager) · [ServiceNow SAM Content](https://www.servicenow.com/docs/bundle/vancouver-it-asset-management/page/product/software-asset-management2/concept/calculated-lifecycles.html) · [ServiceNow HAM](https://www.servicenow.com/products/hardware-asset-management.html)
