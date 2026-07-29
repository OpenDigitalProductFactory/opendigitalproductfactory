# WSID (What Should I Do) — Per-Coworker Professional Corpus & Knowledge Graph

> **Amended 2026-07-23** by [`2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md`](2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md).
> DELIVERED (PR #2016). This spec did not address back-migration of kernel content authored before WSID existed, nor profession-local decision axes. Both are added there; the provenance invariant defined here is inherited unchanged.

- **Date:** 2026-06-09
- **Backlog:** BI-48B3CEC4 (epic EP-WSID)
- **Status:** Draft for review
- **Family:** WWMD (founder/platform) → WWWD (organization) → **WSID (profession/role)**
- **Related specs:**
  - `2026-05-17-wwmd-decision-perspective-kernel-design.md` — the kernel
  - `2026-05-19-wwmd-mcp-exposure-design.md` — MCP tool surface
  - `2026-05-19-persona-voice-layer-wwtd-design.md` — profile kinds & WWTD generalization
  - `2026-05-31-continuous-corpus-enrichment-design.md` — `enrichOrgCorpus` pipeline
  - `2026-05-31-wwmd-explainability-layer-design.md` — Decision Canvas / backlinks / review inbox
  - `2026-05-12-principles-as-wiki-kind-design.md` — principle taxonomy (consumer archetypes, contexts)

---

## 1. Problem

WWMD answers *"what would the founder/platform do?"* and WWWD answers *"what would this
organization do?"* — but a coworker doing a specialist's job has no governed source for
**what a competent professional in this role should do**.

Concretely:

- The **data-architect coworker** has no DAMA-DMBOK grounding, no ANSI SQL standards
  doctrine, no OWASP guidance on preventing SQL injection or insecure data handling.
- The **finance coworker** has no GAAP / general-accounting-practice doctrine.
- The **marketing specialist** has no marketing body of knowledge.

Today that professional judgment is whatever the underlying LLM happens to produce —
ungoverned, unauditable, and inconsistent across model routings. The platform already
solved this exact problem twice (founder doctrine, org doctrine); the third scope reuses
the same architecture: **a versioned profile + a source-traced corpus + weighted retrieval
+ an audited gate**, scoped to the profession instead of the founder or the org.

WSID is also the human-equivalence story: the corpus a data-architect coworker consults is
the same body of knowledge a human data architect is expected to know. The platform should
be aware of each role's professional canon and incorporate it *in situ* — at the decision
point, inside the governed gate — not as prompt folklore.

## 2. Goals / Non-goals

**Goals**

1. A third `DecisionPerspectiveProfile` scope — the **profession profile** — one per
   coworker role family (`WSID-DATA-ARCHITECT`, `WSID-FINANCE`, `WSID-MARKETING`, …).
2. **Full-roster coverage contract**: WSID scopes **every AI Coworker on the platform**,
   not a handpicked few — all 63 registry agents (48 specialists, 9 orchestrators,
   6 cross-cutting; counted 2026-06-09) plus the ~24 route personas, collapsed into
   profession *families* (§4.11). Data architect / finance / marketing are the **pilot
   three**, chosen to prove the pipeline — they are not the scope.
3. A per-role **professional corpus** on the existing substrate: `WikiPage` pages with
   `RawSource` provenance for the body of knowledge, `PerspectiveMaterial` rows for
   decision-bearing doctrine, Qdrant embeddings for recall.
4. **Research-sourced content — never training-data authoring**: every corpus page is
   produced by the research-ingest pipeline from *fetched, verifiable sources* (§4.12).
   The LLM distills retrieved source text; it never writes doctrine from its own
   training-data memory. Each profession gets **its own research effort and its own
   source list**, governed by the Profession Source Registry.
5. **Role-aware gate resolution**: when a coworker hits a craft question, the Decision
   Perspective Gate evaluates against its profession profile, falling back through the
   existing chain (role → org WWWD → DPF doctrine advisory → defer-with-gap-capture).
6. **Seed = bootstrap, enrichment = runtime**: pilot corpora install on a fresh portal
   (themselves pipeline-produced with recorded provenance, §5); ongoing growth flows
   through the (role-scoped) enrichment pipeline with draft-by-default review.
7. **Org overridability**: an organization can extend or override a profession profile
   without mutating the platform-seeded baseline (existing kernel-page overlay pattern).

**Non-goals (V1)**

- Voice layer for profession profiles (the surface exists; no profession voice work).
- Per-individual coworker *instance* profiles (WSID is per role family, not per agent id).
- Verbatim ingestion of licensed/copyrighted texts (see §7 corpus content policy).
- A new vector DB, graph DB, or parallel table family — reuse is the design.

## 3. Research & Benchmarking

### Open-source systems

| System | Pattern studied | Verdict |
|---|---|---|
| **Onyx (formerly Danswer)** | "Personas"/assistants bound to **document sets** — each assistant retrieves only from its curated connector subset. Data model: assistant → document-set join, shared index underneath. | **Adopt the shape**: shared corpus store + per-profile scoping, not per-agent silo stores. Their single-index/many-scopes model matches our WikiPage + profile-scoped recall. |
| **CrewAI (Knowledge)** | Per-agent `knowledge_sources` lists (files/strings/URLs) embedded per crew run. Simple, but knowledge is config-time, unversioned, and has no review lifecycle. | **Reject the lifecycle**: config-time knowledge with no provenance/versioning is exactly the ungoverned state WSID exists to replace. Adopt only the ergonomics — binding knowledge at the role level, not the prompt level. |
| **Microsoft GraphRAG** | Corpus → entity/relationship graph → community summaries for retrieval. | **Defer**: our knowledge graph V1 stays WikiPageLink-based (local neighborhoods, per the explainability spec's "bound the graph" principle). GraphRAG-style community summarization is a possible enrichment for large corpora, not a V1 dependency. |

### Commercial systems

| System | Pattern studied | Verdict |
|---|---|---|
| **OpenAI Assistants API** | Per-assistant vector stores (`file_search` binds a vector store per assistant). Clean scoping, but stores are opaque — no review states, no evidence grades, no audit of *why* a chunk applied. | **Adopt scoping, reject opacity** — every WSID retrieval must remain explainable through Decision Canvas with cited, graded materials. |
| **Microsoft Copilot Studio** | Per-agent "knowledge sources" with admin governance and tenant boundaries. | Confirms the per-role knowledge binding as the industry norm for enterprise agents; their tenant boundary maps to our platform-seed vs org-overlay split. |
| **Glean** | Single governed enterprise index with permission-trimmed, persona-aware retrieval. | Reinforces shared-index + scoped-retrieval over per-agent stores at enterprise scale. |

### Professional bodies of knowledge (the corpus contents)

Candidate anchor standards for the **pilot three**, per the platform's
`research-and-use-standards` principle (cite sources; deviate only with reason). These
lists are *starting hypotheses* — each profession's dedicated research pass (§4.12)
confirms, extends, and supersedes them with fetched sources; the full-roster family map
is in §4.11:

- **Data architect:** DAMA-DMBOK2 (11 knowledge areas — governance, modeling, storage,
  security, MDM, metadata, quality…), ISO/IEC 9075 (ANSI SQL), OWASP Top 10 + ASVS +
  Query Parameterization Cheat Sheet (SQL injection prevention), ISO 11179 (metadata
  registries), Data Mesh / data-product thinking as contextual material.
- **Finance:** US GAAP (FASB ASC) presentation and recognition principles, double-entry
  bookkeeping invariants, month-end close discipline, segregation-of-duties / SOX 404
  control concepts, IFRS divergences as contextual material.
- **Marketing:** AMA definitions and ethics statement, classic frameworks (4Ps/7Ps, STP,
  funnel/AARRR), brand-consistency doctrine, CAN-SPAM/GDPR consent constraints as
  commandment-tier contextual rules.
- **Role→competency mapping:** SFIA 9 and O*NET/ESCO inform which knowledge areas a role
  profile must cover — used as the checklist for corpus completeness, not ingested text.

### Anti-patterns identified

1. **Prompt-stuffed expertise** ("You are an expert in DMBOK…") — unversioned, unauditable,
   silently lost on model swap. WSID replaces this; it must not reintroduce it via giant
   role prompts.
2. **Per-agent silo vector stores** — N copies of overlapping knowledge, no shared review
   lifecycle, divergence between roles that share material (e.g. OWASP applies to data
   architect *and* software engineer). Shared WikiPage corpus + many profiles solves this.
3. **Licensed-text ingestion** — DMBOK/PMBOK are licensed works. Corpus stores DPF-authored
   distillations *citing* the standard (RawSource locator = citation), never reproduced text.

### Gap this design fills

No surveyed system combines per-role knowledge scoping with a **governed decision gate**
(weighted principle aggregation, confidence earned-in-drops, escalate/defer outcomes,
audit ledger). That combination is the platform's existing WWMD kernel; WSID extends it to
professions rather than building a parallel RAG feature.

## 4. Architecture

### 4.1 One substrate, third scope

No new tables. WSID is a configuration of the existing decision-perspective substrate
(verified against `packages/db/prisma/schema.prisma` — `DecisionPerspectiveProfile.kind`
is an open string column; `fallbackProfileId` already implements chains;
`PerspectiveMaterial` already carries `domains`, `evidenceGrade`, `freshness`,
`reviewStatus`, `promotionState`).

```
WWMD   profile kind "platform"      — founder/platform doctrine        (shipped)
WWWD   profile kind "organization"  — org operating principles         (shipped surface)
WSID   profile kind "profession"    — role professional doctrine       (this spec)
```

### 4.2 Profile kind & identity

- Add `"profession"` to `DECISION_PROFILE_KINDS`
  (`apps/web/lib/decision-perspective/types.ts`). DB needs no migration for the kind
  (string column); the TS registry, lint, and MCP input validation are the gate.
- One profile per role family, platform-seeded with deterministic ids:
  `WSID-DATA-ARCHITECT`, `WSID-FINANCE`, `WSID-MARKETING`.
- `scope` (existing Json) carries the role binding:

```jsonc
{
  "domains": ["data-model", "data-security"],      // existing scope axis
  "professionKey": "data-architect",               // NEW, kebab-case role-family slug
  "roles": ["build-data-architect", "data-architect"] // registry agent_name + prompt-slug alias (§4.3)
}
```

- `fallbackProfileId` → the org's WWWD profile (which itself falls back to platform
  doctrine), so the chain in §4.5 is pure existing mechanics.

### 4.3 Role → profile resolution

A small resolver, mirroring the org-profile resolution entry-point (BI-230C9EF7):

```
resolveProfessionProfile({ agentId | roleSlug }) → DecisionPerspectiveProfile | null
```

- **Role-slug source of truth** (verified 2026-06-09): `agent_registry.json` has no
  `role` field — its identifiers are `agent_id` / `agent_name`
  (`AGT-BUILD-DA` / `build-data-architect`, `AGT-900` / `finance-agent`,
  `AGT-WS-MARKETING` / `marketing-specialist`). The `prompts/specialist/*.prompt.md`
  slugs (`data-architect`, …) are a *separate namespace* that only sometimes coincides.
  `scope.roles` therefore binds to the registry **`agent_name`** as the canonical key,
  with the specialist-prompt slug listed as an alias when it differs, so the resolver
  accepts whichever identifier the gate call site carries:
  agentId → registry entry → `agent_name` (or prompt-slug alias) → profile.
- Seed bindings: `WSID-DATA-ARCHITECT` ← `build-data-architect` (alias
  `data-architect`); `WSID-FINANCE` ← `finance-agent`; `WSID-MARKETING` ←
  `marketing-specialist`.
- Null result = no WSID profile for this role → gate proceeds with the org/platform chain
  exactly as today (additive, zero behavior change for unbound roles).

### 4.4 Decision domain

`DECISION_DOMAIN_CLASSES` is a closed registry (`plan-readiness`, `architecture-tradeoff`,
`risk-assessment`). Add **`professional-practice`** — the domain class for craft questions
("how should this be normalized", "which account does this accrual hit", "is this subject
line compliant"). Existing domain classes remain valid against profession profiles (a
data-architect plan-readiness question can still score WSID material tagged for it).

### 4.5 Inheritance chain & authority boundary

```
1. Profession profile (WSID)        — authoritative for CRAFT questions
2. Org WWWD profile                 — authoritative for BUSINESS questions
3. DPF product doctrine             — advisory only (non-inherit boundary, unchanged)
4. defer                            — captured as a profile gap (review inbox)
```

Conflict rule: **org-over-profession for business context, profession-over-silence for
craft**. If the org's WWWD materially contradicts a professional standard (e.g. org policy
mandates a denormalized reporting table where DMBOK doctrine pulls normalize), the gate
returns `arbitrate` with the dissent preserved — same mechanics as today's two-credible-
directions outcome — and org doctrine wins the business framing. A profession commandment
that encodes *public safety or legal exposure* (e.g. "never interpolate untrusted input
into SQL" — OWASP; "revenue is recognized when earned" — GAAP) does not yield: that
conflict `escalate`s rather than arbitrates. Every interaction row records which chain
level produced the answer (existing ledger fields).

### 4.6 Corpus structure

Per-role corpus on the existing wiki substrate:

- **`WikiPage`** — body-of-knowledge pages, `organizationId = null` for platform-seeded
  baseline (the kernel-overlay pattern gives orgs `kernelPageId`-linked override pages).
  Page kinds used as-is: `principle` (decision-bearing rules — e.g. *parameterize all
  SQL*), `heuristic` (e.g. *prefer 3NF until a measured read-path needs denormalization*),
  `entity` (e.g. *DMBOK knowledge area: Data Quality*), `stance`, `summary`.
- **`RawSource`** — one row per standard cited (DMBOK2, ISO/IEC 9075, OWASP ASVS, FASB
  ASC…), `sourceType: "framework" | "spec"`, locator = formal citation. Pages link via
  `WikiPageSource`. This is the provenance that makes a WSID recommendation auditable
  back to the professional standard.
- **`PerspectiveMaterial`** — the decision-bearing subset, attached to the profession
  profile, graded per the existing trust ladder (platform-distilled standards enter as
  `evidenceGrade: "B"`, `derived` trust — they are DPF's *reading* of the standard, not
  first-party org fact).
- **Principle taxonomy scoping** (existing axes, no additions):
  `principleConsumerArchetype: "specialist"`,
  `principleConsumerContexts: ["data-model"] | ["finance"] | ["marketing"]` (slugs already
  in `PRINCIPLE_CONSUMER_CONTEXT_EXAMPLES`; `data-security` is a new governed slug —
  contexts are open kebab-case, but append it to the examples registry so docs and lint
  stay honest), `principleRingScope: "ring-1-coworker"`.
  `recallPrincipleContext`'s strict context filter then keeps finance doctrine out of
  marketing prompts for free.
- **Knowledge graph**: `WikiPageLink` neighborhoods (existing), projected through the
  shipped Material Backlinks surface. Cross-role links are first-class (OWASP pages link
  from both data-architect and software-engineer corpora — one page, two profiles citing
  it through their own materials).

### 4.7 Enrichment (role-scoped)

Generalize the shipped `enrichOrgCorpus` facade (`apps/web/lib/wiki/enrich-org-corpus.ts`)
with a target discriminator rather than forking it:

```ts
type EnrichCorpusTarget =
  | { kind: "organization"; organizationId: string }          // existing behavior
  | { kind: "profession"; professionKey: string };            // NEW
```

- Source-key contract extends the shipped `deriveSourceKey` scheme
  (`enrich:${organizationId}:${sourceType}:${fingerprint}` — colon-delimited, not
  path-style): `enrich:profession:${professionKey}:${sourceType}:${fingerprint}`.
  Keeping the `enrich:` prefix preserves existing prefix-scoped queries and the
  idempotent-upsert semantics keyed on `RawSource.sourceKey`.
- Same dispositions, same **draft-by-default** review routing (BI-1378 precedent), same
  `WikiIngestEvent` audit. Review-inbox grouping gains the profession as an owner lane
  (the explainability spec's review inbox is already gap-reason generic).
- Gap capture closes the loop: a `defer` on a craft question writes a profession-profile
  gap, which is the enrichment backlog for that corpus — identical to WWMD founder-review
  mechanics, pointed at a different owner.

### 4.8 Gate & retrieval integration

- The gate's profile-selection step becomes role-aware: coworker decision points pass the
  agent identity; selection resolves profession profile for `professional-practice` (and
  other domains when the profile scopes them), else the active org/platform profile.
  `evaluateDecisionPerspective` itself is untouched — it already takes profile +
  fallbacks + materials.
- Qdrant recall reuses the existing wiki/material embedding path (`storeWikiPage`);
  payload filtering by the profession's context slugs.

### 4.9 MCP exposure

No new tool family. The `wwmd_evaluate` / `wwmd_decide` / `wwmd_record_outcome` surface
is specced (`2026-05-19-wwmd-mcp-exposure-design.md`, EP-WWMD-MCP) but **not yet
registered** in `apps/web/lib/mcp-tools.ts` (verified 2026-06-09) — until it lands, the
in-portal gate is WSID's only decision surface. WSID's MCP requirement is purely
additive to that epic:

- when the wwmd tools land, profession profile ids are valid `profileId` targets under
  the same scopes/grants — no WSID-specific tool work;
- agent→profile resolution (so an external client can ask "which profile governs the
  finance coworker?") rides the **landed** BI-230C9EF7 entry-point
  (`resolveProfileMaterialForOrg`, `apps/web/lib/decision-perspective/material.ts`)
  extended with the §4.3 resolver — read-only, no parallel tool.

### 4.10 Explainability

Nothing new to build: Decision Canvas, Material Backlinks, and the review inbox project
profile-generic records. A WSID decision renders as "the data-architect doctrine
recommended X, citing *Parameterize all SQL* (OWASP ASVS v5, grade B, current)". The
review queue wording for profession profiles uses owner/operator language (per the
explainability spec's WWMD-vs-WWWD wording rule).

### 4.11 Coverage contract — every coworker, mapped to a profession family

WSID covers the **whole roster**: all 63 `agent_registry.json` agents and all ~24
`prompts/route-persona/*` personas. Many coworkers share a craft, so coverage is by
**profession family** — one profile, one corpus, N bound roles. The working family map
(maintained as the Profession Source Registry, §4.12; candidate anchor standards subject
to each family's research pass):

| Profession family (`professionKey`) | Bound roles (registry `agent_name` / persona) | Candidate anchor standards |
|---|---|---|
| `data-management` | build-data-architect/data-architect, data-governance-agent | DAMA-DMBOK2, ISO/IEC 9075, ISO 11179, OWASP |
| `finance-accounting` | finance-agent, investment-analysis-agent | US GAAP (FASB ASC), SOX 404, FP&A practice |
| `marketing` | marketing-specialist | AMA BoK, STP/4Ps, CAN-SPAM/GDPR consent |
| `software-engineering` | software-engineer, frontend-engineer, platform-engineer, iac-execution-agent | SWEBOK v4, OWASP, 12-factor, IaC practice |
| `software-quality` | qa-engineer, release-acceptance-agent | ISTQB CTFL, ISO/IEC 25010 |
| `security-compliance` | security-auditor-agent, policy-enforcement-agent, policy-specialist | ISO/IEC 27001, NIST CSF 2.0, CIS Controls |
| `enterprise-architecture` | ea-architect, architecture-agent, architecture-definition-agent, architecture-guardrail-agent, governance-orchestrator | TOGAF 10, IT4IT 3.0, ArchiMate 3.2 |
| `portfolio-management` | portfolio-advisor, portfolio-backlog-agent/-specialist, portfolio-rationalization-agent, gap-analysis-agent, strategy-alignment-agent | PMI Std for Portfolio Mgmt, IT4IT S2P |
| `product-management` | product-backlog-specialist, product-backlog-prioritization-agent, roadmap-assembly-agent, scope-agreement-agent | PDMA BoK, discovery/prioritization practice |
| `service-management-sre` | operate-orchestrator, ops-coordinator, monitoring-agent, incident-detection-agent, incident-resolution-agent, service-support-agent | ITIL 4, Google SRE, ISO/IEC 20000 |
| `release-engineering` | integrate/deploy/release-orchestrators, release-planning-agent, deployment-planning-agent, sbom-management-agent, resource-reservation-agent | DORA, SLSA, NTIA SBOM / CycloneDX |
| `customer-service` | consume-orchestrator, customer-advisor, consumer-onboarding-agent, order-fulfillment-agent, subscription-management-agent | service blueprinting, CX practice (CXPA) |
| `service-catalog-licensing` | catalog-publication-agent, service-offer-definition-agent, licensing-specialist | ITIL service catalog, ISO/IEC 19770 (ITAM/SAM) |
| `asset-estate-management` | inventory-specialist, estate-specialist | ISO 55000, IAITAM ITAM |
| `human-resources` | hr-specialist | SHRM BASK, employment-compliance basics |
| `technical-communication` | documentation-specialist | tech-writing practice, structured authoring |
| `ux-accessibility` | ux-accessibility | WCAG 2.2, ISO 9241, heuristic evaluation |
| `general-management` | coo, onboarding-coo, admin-assistant, evaluate/explore-orchestrators, remaining cross-cutting reviewers | management practice; mostly WWWD-governed |

Rules:

1. **Every active coworker role resolves** — to its family profile, or explicitly to
   `general-management` as the typed generalist bucket. An unmapped role is a lint
   failure in the registry, not a silent fallthrough.
2. **Profiles ship for all families from V1; corpora roll out in waves.** A profile
   whose corpus isn't built yet still participates in the gate — its `defer` outcomes
   are the gap signal, and per-family defer counts are the **prioritization queue** for
   which corpus gets researched next (demand-driven, not guessed).
3. Platform-internal pipeline agents (hive-scout reviewers, discovery-triage) are
   governed by the engineering-flow/WWMD platform doctrine they already have; they map
   to families only where a real external profession exists.

### 4.12 Research-sourced corpus pipeline — no training-data authoring

The corpus is only as trustworthy as its sources. **A model writing "DMBOK says X" from
its own training-data memory is the exact ungoverned state WSID exists to replace** —
so the pipeline makes that impossible to pass review:

1. **Profession Source Registry** (governed artifact, `docs/professions/registry.json`,
   PR-reviewed): per `professionKey` — bound roles, context slugs, the source list
   (locator, publisher, edition/version, **license class**: `open` / `licensed` /
   `org-supplied`), and a coverage checklist of knowledge areas (SFIA 9 / O*NET-derived)
   the corpus must span. This registry is the per-profession research mandate Mark's
   directive requires: each family gets its own research effort and its own sources.
2. **Fetch & capture**: a per-profession research run (the existing research-execution
   harness — `apps/web/lib/wiki/research-execution.ts`, `market-research.ts` precedent —
   plus deep-research style multi-source sweeps) retrieves each open source. Every fetch
   is stored as a `RawSource` with verifiable provenance: locator (URL/citation),
   `retrievedAt`, content fingerprint, license class. Licensed works enter only via the
   `document` origin (org-supplied upload under the customer's own license — DPF is a
   conduit, never the licensee) or stay checklist-only (knowledge-area names and
   structure are facts; licensed prose is not ingested).
3. **Distill from retrieved text only**: page proposals run through the existing
   `proposeWikiDiff` adapters **with the fetched source text as input**. The model's job
   is distillation and structure-mapping of text in front of it, never recall.
4. **Provenance invariant (lint + CI gate)**: every WSID corpus `WikiPage` has ≥1
   `WikiPageSource` link to a `RawSource` carrying retrieval metadata; every
   `PerspectiveMaterial.sourceRef` traces to those RawSources. A page with no fetched
   source cannot reach `published`; a material with no traceable source cannot reach
   `promoted`. This is mechanical, not honor-system.
5. **Freshness loop**: `scheduled-refresh` origin re-validates sources (standards get
   new editions; OWASP Top 10 rotates), updating `lastValidatedAt` and flagging
   `stale`/`superseded` materials through the existing freshness states.

## 5. Seeding (bootstrap) vs runtime (calibration)

Per `seed-is-bootstrap-calibration-is-runtime` and `fix-the-seed-not-the-runtime`:

- **Seed** installs: profession profiles **for every family in the registry** (§4.11)
  with full role bindings, plus the pilot corpora — WikiPages + RawSources +
  PerspectiveMaterials that were **produced by the §4.12 research pipeline** (run at
  authoring time, provenance recorded in the committed content, PR-reviewed like kernel
  pages — never hand-authored from model memory). Idempotent, FK-safe, loud on skip
  (silent-seed-skips audit applies). Seed-time
  embeddings follow the founder-kernel precedent (`seed-wiki-kernel.ts`): a precomputed
  `embeddings.jsonl` sidecar per corpus tree, because a fresh install has no embedding
  provider configured at seed time (`zero-click-provider-setup`); runtime enrichment
  embeds through the live `storeWikiPage` path.
- **Runtime** owns growth: enrichment pipeline (§4.7), gap capture from `defer`s,
  org overlays. Seed content is never the long-term source of truth for routing
  decisions — the corpus lives in the DB and evolves there.

## 6. Data model changes (summary)

| Change | Layer | Migration? |
|---|---|---|
| `"profession"` in `DECISION_PROFILE_KINDS` | TS registry + lint + MCP validation | No (DB column is string) |
| `"professional-practice"` in `DECISION_DOMAIN_CLASSES` | TS registry | No |
| `scope.professionKey` / `scope.roles` | Json contract + type | No |
| `EnrichCorpusTarget` discriminator | `enrich-org-corpus.ts` generalization | No |
| `"data-security"` in `PRINCIPLE_CONSUMER_CONTEXT_EXAMPLES` | `packages/db/src/wiki-taxonomy.ts` examples registry | No (contexts are open kebab-case) |
| Profession Source Registry | `docs/professions/registry.json` (governed artifact + lint) | No (file + seed) |
| Profession seed module | `packages/db/src/seed-*` (generalizes `seed-wiki-kernel.ts` machinery) | Seed only |

Zero structural migrations is a deliberate outcome of the schema-audit-before-features
pass (§4.1): the 2026-05 decision-perspective models were built profile-kind-generic.

## 7. Governance & corpus content policy

1. **Copyright-clean**: corpus pages are DPF-authored distillations citing standards;
   never reproduced licensed text. RawSource rows carry the citation; lint can flag pages
   exceeding a quotation-length budget per source.
2. **No training-data authoring**: corpus content is distilled from *fetched* source
   text with recorded retrieval provenance (§4.12). The provenance invariant is a CI/lint
   gate — unsourced pages cannot publish, unsourced materials cannot promote.
3. **Draft-by-default enrichment** (unchanged from org corpus): trust sets grade/weight,
   not review state.
4. **Evidence grades**: platform distillations B; org first-party overrides A; researched
   additions C — the existing ladder.
5. **Security doctrine is commandment-in-context**: injection prevention, secrets
   handling, consent/compliance rules seed at `principleTier: commandment` scoped to
   their contexts, so they win conflict resolution inside the role without leaking
   platform-wide.
6. **Non-inherit boundary preserved**: profession doctrine is craft authority, not
   business authority; the customer's WWWD remains the business voice (§4.5).
7. **Licensed bodies of knowledge follow the conduit rule**: DPF never enrolls as a
   licensee of DMBOK/ISO/SFIA content. Where a standard is licensed, the customer brings
   their own copy (`org-supplied` document origin) or the corpus covers the open
   knowledge-area structure only.

## 8. Acceptance (V1)

1. Data-architect coworker, craft question ("is this query injection-safe / how should
   this table be normalized") → `recommend` citing WSID materials with standard-traced
   provenance; `DecisionInteraction` records the profession profile + version.
2. **Every active coworker role resolves to a profession profile** via the registry
   family map (§4.11) — an unmapped role is a lint failure. Families without a built
   corpus participate via `defer` + gap capture (the demand queue for the next corpus).
3. **Provenance invariant holds mechanically**: 100% of published corpus pages link to a
   fetched `RawSource` with retrieval metadata; 100% of promoted materials trace to
   those sources. The lint/CI gate rejects violations — no training-data-only content
   can ship.
4. Fresh install seeds all family profiles + the three pilot corpora; `pnpm verify` seed
   invariants pass; no silent skips.
5. Org overlay: an org-scoped override page/material wins over the platform baseline for
   that org without mutating it.
6. `defer` on a craft question lands in the review inbox under the profession lane, and
   per-family defer counts are queryable as the corpus-rollout prioritization signal.

## 9. Open questions (tracked, non-blocking)

- Whether `team` profile kind (already in the registry, unshipped) should share the role
  resolver — deferred until a team profile exists.
- GraphRAG-style community summaries for large corpora (§3) — revisit when a corpus
  exceeds local-neighborhood explainability.
- Per-instance coworker profiles (a specific agent's learned preferences) — explicitly
  out of scope; the agent-memory Qdrant collection continues to serve that need.

## 10. Phasing

See the implementation plan:
`docs/superpowers/plans/2026-06-09-wsid-coworker-professional-corpus.md`.

## 11. Addendum (2026-07-29): corpus priming layers, the weaning ladder, and rollout order

Founder direction (Mark, 2026-07-29), recorded against the live state: all 23 registered
families have a published baseline corpus in the DB (~186 pages, ~84 carrying dimension
vectors), every `wsid-*` profile exists — and every one has **zero** `PerspectiveMaterial`
rows, because the §4.6 "decision-bearing subset attached to the profession profile" step
was designed but never implemented. The profession gate deferred 64 times on
`architecture-tradeoff` while six published, vectored enterprise-architecture pages sat
unread. BI-3B02FF9C implements the §4.6 promotion contract (page → material, with
backfill); this addendum specifies what the corpus itself must grow into.

### 11.1 The weaning ladder (why priming exists)

The platform borrows decisions before it owns them. Cognitive load moves incrementally:
**founder → WWMD → WWWD or directly WSID where applicable**. The fallback chain
(`wsid-<family>` → platform profile) is the borrowing mechanism — a profession with no
material of its own decides from WWMD doctrine, which is itself grounded in EA principles
(the founder is an architect; WWMD encodes that). Priming a family's corpus, and capturing
each human ruling as `ruled`-tier material (the stance ladder, never downgraded), is how a
profession weans off the borrow: the same question must never climb back up the ladder
once a human has settled it. `professionProfileSelected=false` on a decision row is the
per-decision borrow marker; a family's borrow rate trending down is the weaning metric.

### 11.2 Three corpus layers

1. **Common professional knowledge (baseline)** — what any competent member of the
   profession would treat as settled: bodies of knowledge, standards, canonical decision
   factors and their default weights (the "common vectors"). Platform-seeded,
   `organizationId = null`, graded B/derived per §4.6. This layer EXISTS for all 23
   families but is uneven (4–17 pages); depth follows the demand signal (§11.3).
2. **Industry / archetype variation** — how the profession's defaults shift inside a
   vertical (what "operations" means in fabric-care vs lodging vs MSP). Overlay pages
   scoped via the existing principle-taxonomy consumer contexts and archetype slugs;
   seeded as part of each vertical-readiness program (e.g. lodging P3 BI-270FAE06), never
   by forking the baseline page — variation pages cite and override, kernel-overlay style.
3. **Locale / market / jurisdiction variation** — county-and-narrower governance, market
   norms, and regulatory reality (licensing-permit-jurisdiction spec, location-reference
   resolution, CADA precedent). Enters ONLY source-cited through the enrichment facade
   (§4.7, conduit rule); high-stakes families (legal, compliance, finance, healthcare)
   require human approval before material goes gate-live, per the competence-flywheel
   risk tiering. Retrieval filters by the install's locale context; absence of a local
   page falls back up the layers, never to silence.

### 11.3 Rollout order and the minimum viable decision-pack

Rollout order is not editorial: it is the defer demand signal the profile seeder was
designed to emit ("defer counts function as the demand signal for Phase 6 rollout
order"). Enterprise-architecture is first (64 deferrals). A family is "primed" when it
carries a minimum viable decision-pack: enough decision-bearing material in its live
decision classes (mapped `domainClass`, dimension vectors present) that the gate can
recommend or arbitrate on the family's routine consult shapes instead of deferring —
verified against the family's own recent deferral questions, not hypotheticals. Depth
beyond the pack is pulled by gap capture (§4.7), not pushed speculatively.

## 12. Addendum (2026-07-29) — Phase 6 implementation record: craft pages become gate-live material (BI-3B02FF9C)

**Why this phase is load-bearing.** Phase 6 is the decisive step of the weaning
ladder (founder → WWMD → WWWD/WSID): until corpus pages produce
`PerspectiveMaterial`, every profession decision borrows WWMD via the fallback
chain and every wsid-* consult defers. The demand signal fired exactly as §4.11
rule 2 designed — 64 unresolved `architecture-tradeoff` deferrals on
`wsid-enterprise-architecture` put that family at the front of the rollout.

**What shipped.** The profession sibling of the WWWD stance promotion
(`stance-promotion.ts`), one shared write path used by both the runtime and the
seed: `packages/db/src/profession-material-promotion.ts` (exported as
`@dpf/db/profession-material-promotion`).

1. **Publish hook** — `publishWikiOverlayPages` (the overlay draft review
   surface's publish click) promotes any published `craft/<professionKey>/`
   page to owner-confirmed material on `wsid-<professionKey>`, exactly as
   `publishBusinessStance` promotes an org stance. Promotion failure never
   rolls back the page publish; the seed backfill converges misses.
2. **Backfill** — `backfillProfessionCraftMaterials`, run as the
   `professionCraftMaterials` seed step after `seedProfessionCorpus`:
   published `professions/<key>/` platform pages enter at the derived tier,
   already-published `craft/<key>/` overrides at the confirmed tier.
   Idempotent; loud on anomalies.
3. **Tier ladder** (aligned with the §4.6 trust ladder and the stance ladder):
   `derived` B/0.6 (platform distillation of a standard), `confirmed` A/0.9
   (owner published a craft override), `ruled` A/1.0 (human ruled on a real
   decision). Never downgrades — neither tier nor an approved review status.
4. **Tier-aware domain-class mapping.** Only decision-bearing page kinds
   promote (`principle`, `heuristic`, `stance`, `decision`; `entity`/`summary`/
   `runbook` stay retrieval-only per §4.6). Derived material is context-grade
   and enters `professional-practice` only; confirmed/ruled material carries
   the family's decision classes — for `enterprise-architecture`,
   `architecture-tradeoff` primary + `professional-practice`. Rationale: gate
   confidence is the *mean* of applicable effective weights, so a derived row
   (0.45 effective) sharing a class with confirmed rows (0.9) would dilute the
   mean below the 0.7 recommend band — human confirmation is what promotes a
   page's doctrine into tradeoff authority.
5. **Risk tiering** (competence-flywheel §5.5, BI-BE9C95D9): families whose
   registry contextSlugs touch `finance` or `compliance` (finance,
   legal-compliance, hr-people-ops, security today) are high-stakes — their
   derived-tier rows land `draft`/`candidate`, auditable but invisible to the
   gate, until a human approves. Confirmed/ruled tiers are human actions and go
   gate-live everywhere.

**Acceptance trace.** With the backfill plus the two published EA craft
overrides (`craft/enterprise-architecture/architecture-review-verdicts-…`,
`…/verify-the-substrate-first-…`), an `architecture-tradeoff` consult on
`wsid-enterprise-architecture` resolves 2 confirmed materials → confidence 0.9
at low risk → `recommend` with `professionProfileSelected=true` instead of the
coverage-gap defer (regression-locked in `profession-gate.test.ts`).
