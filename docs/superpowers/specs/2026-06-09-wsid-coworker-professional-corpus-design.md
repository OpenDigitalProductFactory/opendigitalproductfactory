# WSID (What Should I Do) — Per-Coworker Professional Corpus & Knowledge Graph

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
2. A per-role **professional corpus** on the existing substrate: `WikiPage` pages with
   `RawSource` provenance for the body of knowledge, `PerspectiveMaterial` rows for
   decision-bearing doctrine, Qdrant embeddings for recall.
3. **Role-aware gate resolution**: when a coworker hits a craft question, the Decision
   Perspective Gate evaluates against its profession profile, falling back through the
   existing chain (role → org WWWD → DPF doctrine advisory → defer-with-gap-capture).
4. **Seed = bootstrap, enrichment = runtime**: starter corpora for the first three roles
   install on a fresh portal; ongoing growth flows through the (role-scoped) enrichment
   pipeline with draft-by-default review.
5. **Org overridability**: an organization can extend or override a profession profile
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

The standards each starter role's corpus distills, per the platform's
`research-and-use-standards` principle (cite sources; deviate only with reason):

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
  "domains": ["data-model", "data-security"],     // existing scope axis
  "professionKey": "data-architect",               // NEW, kebab-case role-family slug
  "roles": ["data-architect"]                      // coworker role slugs this profile serves
}
```

- `fallbackProfileId` → the org's WWWD profile (which itself falls back to platform
  doctrine), so the chain in §4.5 is pure existing mechanics.

### 4.3 Role → profile resolution

A small resolver, mirroring the org-profile resolution entry-point (BI-230C9EF7):

```
resolveProfessionProfile({ agentId | roleSlug }) → DecisionPerspectiveProfile | null
```

- Source of the role slug: the coworker's registry entry (`agent_registry.json` /
  `Agent` model) already names specialist roles (`data-architect`, etc. — the
  `prompts/specialist/*.prompt.md` slugs). The resolver maps agent → role slug →
  profession profile whose `scope.roles` contains it.
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
  in `PRINCIPLE_CONSUMER_CONTEXT_EXAMPLES`), `principleRingScope: "ring-1-coworker"`.
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

- Source-key contract extends the existing scheme:
  `profession/${professionKey}/${origin}/${stableSourceFingerprint}`.
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

No new tool family. `wwmd_evaluate` / `wwmd_decide` / `wwmd_record_outcome` already accept
`profileId`; WSID adds:

- profession profile ids as valid targets under the same scopes/grants;
- a `resolveProfileForAgent` convenience (so an external client can ask "which profile
  governs the finance coworker?") — read-only, exposed via the existing profile-resolution
  entry-point work (BI-230C9EF7) rather than a parallel tool.

### 4.10 Explainability

Nothing new to build: Decision Canvas, Material Backlinks, and the review inbox project
profile-generic records. A WSID decision renders as "the data-architect doctrine
recommended X, citing *Parameterize all SQL* (OWASP ASVS v5, grade B, current)". The
review queue wording for profession profiles uses owner/operator language (per the
explainability spec's WWMD-vs-WWWD wording rule).

## 5. Seeding (bootstrap) vs runtime (calibration)

Per `seed-is-bootstrap-calibration-is-runtime` and `fix-the-seed-not-the-runtime`:

- **Seed** installs: 3 profession profiles, their starter WikiPages + RawSources +
  PerspectiveMaterials (platform-authored distillations, published status, promoted
  materials — they are reviewed at PR time like kernel pages), and the role bindings.
  Idempotent, FK-safe, loud on skip (silent-seed-skips audit applies).
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
| Profession seed module | `packages/db/src/seed-*` | Seed only |

Zero structural migrations is a deliberate outcome of the schema-audit-before-features
pass (§4.1): the 2026-05 decision-perspective models were built profile-kind-generic.

## 7. Governance & corpus content policy

1. **Copyright-clean**: corpus pages are DPF-authored distillations citing standards;
   never reproduced licensed text. RawSource rows carry the citation; lint can flag pages
   exceeding a quotation-length budget per source.
2. **Draft-by-default enrichment** (unchanged from org corpus): trust sets grade/weight,
   not review state.
3. **Evidence grades**: platform distillations B; org first-party overrides A; researched
   additions C — the existing ladder.
4. **Security doctrine is commandment-in-context**: injection prevention, secrets
   handling, consent/compliance rules seed at `principleTier: commandment` scoped to
   their contexts, so they win conflict resolution inside the role without leaking
   platform-wide.
5. **Non-inherit boundary preserved**: profession doctrine is craft authority, not
   business authority; the customer's WWWD remains the business voice (§4.5).

## 8. Acceptance (V1)

1. Data-architect coworker, craft question ("is this query injection-safe / how should
   this table be normalized") → `recommend` citing WSID materials with standard-traced
   provenance; `DecisionInteraction` records the profession profile + version.
2. Role without a WSID profile → unchanged behavior, ledger shows org/platform chain level.
3. Fresh install seeds all three corpora; `pnpm verify` seed invariants pass; no silent
   skips.
4. Org overlay: an org-scoped override page/material wins over the platform baseline for
   that org without mutating it.
5. `defer` on a craft question lands in the review inbox under the profession lane.

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
