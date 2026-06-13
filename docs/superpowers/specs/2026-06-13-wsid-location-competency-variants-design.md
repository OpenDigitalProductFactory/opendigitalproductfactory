# WSID Variants — Location (Jurisdiction) & Competency Level

- **Date:** 2026-06-13
- **Backlog:** BI-871126F9 (epic EP-WSID) — variant addendum
- **Status:** Draft for review
- **Parent spec:** `2026-06-09-wsid-coworker-professional-corpus-design.md`
- **Family:** WWMD (founder/platform) → WWWD (organization) → **WSID (profession/role)**

---

## 1. Problem

The parent WSID spec builds one professional corpus per coworker family, but treats
each family's doctrine as a single flat body. Two real-world axes break that
assumption for **every** AI coworker:

1. **Location / jurisdiction.** Professional doctrine is not globally uniform. A
   finance coworker recognizing revenue under **US GAAP (ASC 606)** applies a
   different probability threshold for variable consideration than one under
   **IFRS 15**. A marketing coworker under **US CAN-SPAM** has materially weaker
   consent obligations than one under **EU GDPR**. An HR coworker under **US EEOC**
   law operates differently from one under EU employment directives. Serving the
   wrong-jurisdiction doctrine is not a quality miss — it is an active compliance
   hazard.

2. **Level of competency.** A profession's body of knowledge spans depths: the
   non-negotiable basics every practitioner holds, the day-to-day working practice,
   and the nuanced trade-off judgment of a senior expert. A coworker configured to
   operate at a foundational level should not be handed expert-tier divergence
   doctrine as if it were settled basics, and an expert-level coworker should not
   be capped at foundational material.

Neither axis appears in the parent spec beyond passing mentions ("IFRS divergences
as contextual material"; "SFIA 9 / O*NET inform which knowledge areas a profile
must cover"). This addendum makes both first-class.

## 2. Goals / Non-goals

**Goals**

1. A governed way to tag any profession-corpus page with the **jurisdiction(s)** its
   doctrine governs and the **competency level** of judgment it encodes.
2. Author jurisdiction-divergent doctrine as **distinct, separately-cited pages**
   (US-GAAP revenue recognition vs IFRS revenue recognition), not as one muddled
   page, so each variant traces to its own source.
3. **Zero structural migration** — consistent with the parent spec's deliberate
   zero-migration outcome. Reuse the existing wiki substrate.
4. A coverage signal at seed time so the platform can see, per family, which
   jurisdictions and competency depths are covered and which are gaps.

**Non-goals (V1)**

- Wiring the gate to *filter* retrieval by the calling coworker's jurisdiction /
  competency. That binding rides the same future PR that binds WSID profiles to
  corpus materials (parent spec §4.8, not yet landed). V1 makes the content and
  the tags correct and governed; V2 makes them filterable. This is called out
  explicitly in §6.
- Per-instance coworker competency learning (out of scope, same as parent spec).
- Sub-national jurisdictions (US state law, EU member-state divergence). The
  registry starts at `global / us / eu / uk` and grows by PR review on real
  customer demand — never speculatively.

## 3. Why not new columns / not the contexts axis

Two rejected approaches and why:

- **New typed `WikiPage` columns** (`professionJurisdiction`, `professionCompetencyLevel`):
  would require a Prisma migration plus cross-stack plumbing (lint, MCP validation,
  retrieval). The parent spec achieved zero migrations on purpose; adding two
  columns *before* the retrieval path can even consume them is premature substrate
  (`verify-substrate-before-proposing-new`). Deferred to V2, when retrieval
  actually filters on them and the column earns its index.
- **Overloading `principleConsumerContexts`** (e.g. `jurisdiction-us`, `level-expert`
  as context slugs): rejected on two grounds. (a) The shipped corpus pattern
  (`docs/professions/data-architect/wiki/*`) uses `principleConsumerArchetype:
  specialist` with **no** contexts — domain scoping is by the `professions/<family>/`
  slug prefix. Adding contexts would diverge from the established pattern. (b)
  `recallPrincipleContext` does not filter on `principleConsumerContexts` at all
  (it filters by tier, organization, population, ring-scope), so overloading that
  axis would buy no filtering while mixing three orthogonal meanings into one
  array.

## 4. Design — two validated frontmatter axes

Two optional frontmatter fields on profession-corpus pages (slug prefix
`professions/`), validated by the corpus seed against closed registries in
`packages/db/src/wiki-taxonomy.ts`:

```yaml
# Omitted = jurisdiction-neutral (applies everywhere; equivalent to ["global"]).
professionJurisdiction:
  - us
# Omitted defaults to "practitioner".
professionCompetencyLevel: expert
```

- **`PROFESSION_JURISDICTIONS`** = `global | us | eu | uk`. A page may declare more
  than one (a control that holds identically in US and EU lists both). Omission
  means jurisdiction-neutral.
- **`PROFESSION_COMPETENCY_LEVELS`** = `foundational | practitioner | expert`,
  loosely aligned to SFIA responsibility bands (≈1-2 / 3-4 / 5-7) and O*NET job
  zones — used as a coverage frame, never ingested as text (conduit rule).

Both are validated fail-fast in `seedProfessionCorpus` (`tallyVariantCoverage`):
an unknown value throws with the allowed set, exactly as `extractPrinciplePayload`
gates principle dimensions/archetypes. A typo can never silently mis-tag
jurisdiction-sensitive doctrine.

### 4.1 Authoring convention

1. **Jurisdiction-neutral doctrine** lives at the family root with no
   `professionJurisdiction` field: `professions/finance/double-entry-invariant`.
2. **Jurisdiction-divergent doctrine** is split into one page per variant, each
   declaring its jurisdiction and carrying a `-<jur>` (or standard-name) slug
   suffix, cross-linked to its sibling:
   - `professions/finance/revenue-recognition-asc606-us` → `professionJurisdiction: [us]`
   - `professions/finance/revenue-recognition-ifrs15` → `professionJurisdiction: [eu]` (IFRS; `global` where adopted)
3. Every page carries a short **`## Jurisdiction & Competency`** body section
   stating, in prose, the scope and depth — so the variant is legible to a human
   reading the page even before the gate filters on the tags.

### 4.2 Resolution semantics (the V2 contract these tags enable)

When the gate is wired to corpus materials (V2), profile selection already carries
the org and the coworker config. Variant resolution then layers on:

```
Jurisdiction:
  candidate pages = neutral (no professionJurisdiction)  ∪  pages whose
                    professionJurisdiction ∋ org.jurisdiction
  pages tagged for a DIFFERENT jurisdiction are excluded.
  Conflict (a neutral page and a jurisdiction-specific page on the same topic):
    the jurisdiction-specific page wins for a matching org; the neutral page is
    the fallback when no jurisdiction-specific variant exists.

Competency:
  retrieve pages whose professionCompetencyLevel ≤ coworker.competency
  (foundational ⊂ practitioner ⊂ expert — higher competency sees more, never
  less). A foundational-configured coworker never receives expert-tier divergence
  doctrine; an expert coworker receives the full depth.
```

This composes underneath the parent spec §4.5 inheritance chain (profession →
org WWWD → DPF doctrine → defer) — variants narrow *within* the profession layer;
they do not change the cross-layer authority boundary. A jurisdiction-tagged
**commandment** that encodes legal exposure (GDPR consent, GAAP recognition)
still `escalate`s rather than `arbitrate`s on conflict, exactly as §4.5 specifies.

## 5. Jurisdiction-sensitive families

Most families are jurisdiction-neutral (engineering practice, data modeling, UX,
documentation are global). The families where jurisdiction variants are expected
and should be authored as split pages:

| Family | Divergence axis | Variants to author |
|---|---|---|
| `finance` | Accounting standard | US GAAP (ASC 606, SOX 404) vs IFRS |
| `legal-compliance` | Privacy / AI regulation | GDPR + EU AI Act (eu) vs US sectoral |
| `marketing` | Email consent | CAN-SPAM (us) vs GDPR consent (eu) |
| `hr-people-ops` | Employment law | EEOC (us) vs EU employment directives |
| `security` | Breach notification / residency | varies; tag where doctrine diverges |

All other families default to jurisdiction-neutral unless a researched source
shows real divergence. Competency tiering applies to **every** family.

## 6. V1 → V2 path (honest scope)

- **V1 (this addendum + corpus build-out):** tags are authored, validated against
  the registries, and tallied into seed coverage logs
  (`profession-corpus: … jurisdiction[us=3,eu=2,global=8] competency[foundational=4,…]`).
  Content is correct and split per jurisdiction. The gate does not yet filter on
  them because the gate↔corpus-material binding itself is not yet wired (parent
  spec §4.8).
- **V2 (future PR, rides the gate↔material binding):** implement §4.2 resolution.
  At that point, decide per measured need whether to promote the two axes from
  validated-frontmatter to indexed `WikiPage` columns (only if retrieval needs the
  index). The registries and frontmatter contract defined here are the stable
  interface; V2 changes the *consumer*, not the *authoring*.

## 7. Data model changes (summary)

| Change | Layer | Migration? |
|---|---|---|
| `PROFESSION_JURISDICTIONS` + `PROFESSION_COMPETENCY_LEVELS` + type guards | `packages/db/src/wiki-taxonomy.ts` | No |
| `professionJurisdiction?` / `professionCompetencyLevel?` | `WikiPageFrontmatter` type | No |
| `tallyVariantCoverage` validation + coverage in result | `seed-profession-corpus.ts` | No |
| Coverage surfaced in seed log | `seed.ts` | No |
| Split jurisdiction pages + competency tags | corpus content under `docs/professions/` | No |

## 8. Acceptance (V1)

1. A corpus page with `professionJurisdiction: [zz]` (unknown) fails the seed
   loudly with the allowed set — no silent mis-tag.
2. Finance corpus ships US-GAAP and IFRS revenue-recognition as separate,
   separately-cited pages, cross-linked, each correctly jurisdiction-tagged.
3. Seed log reports per-family jurisdiction and competency coverage.
4. Provenance invariant from the parent spec still holds: every published variant
   page cites ≥1 fetched `RawSource`.
5. Omitting both fields yields a jurisdiction-neutral, practitioner-level page
   (backward-compatible with the shipped data-architect corpus, which sets
   neither and therefore tallies as `global` / `practitioner`).

## 9. Coverage disposition for platform-internal families

"Consider variants … for **all** of the AI Coworkers" requires a disposition for
every registry family, not corpus content for every family. Most families get a
researched external corpus (data-architect, software-engineer, finance, security,
legal-compliance, qa-engineer, product-manager, frontend-engineer, ux-design,
documentation-content, enterprise-architecture, operations, hr-people-ops,
customer-success, strategy-executive, external-intelligence, plus the wave still
gated on merges: devops-platform, scrum-master, portfolio-management, marketing,
release-service-management).

Three registry families are **platform-internal** and are deliberately *not* given
a parallel external corpus:

- **`build-studio`** and **`admin-operations`** — their professional doctrine is
  DPF's own platform doctrine, already the single source of truth in the **founder
  kernel** (`docs/founder-kernel/wiki/principles/`) and `AGENTS.md`. Authoring a
  `professions/build-studio/*` corpus that re-cited `AGENTS.md` would duplicate the
  kernel and violate `single-source-of-truth`. Their Phase-1 profession profiles
  already fall back through the chain to the platform/WWMD kernel (parent spec
  §4.5), which **is** their body of knowledge. This matches parent spec §4.11:
  "Platform-internal pipeline agents … are governed by the engineering-flow/WWMD
  platform doctrine they already have; they map to families only where a real
  external profession exists."
- **`external-intelligence`** *does* map to a real external profession (tool/registry
  scouting, supply-chain vetting) with genuine external sources (MCP, npm, OWASP),
  so it gets a corpus.

Disposition rule: a family with a real external body of knowledge gets a researched
corpus; a platform-internal family defers to the founder kernel via the fallback
chain rather than duplicating it. Both are "covered" — one by corpus, one by
governed deferral.
