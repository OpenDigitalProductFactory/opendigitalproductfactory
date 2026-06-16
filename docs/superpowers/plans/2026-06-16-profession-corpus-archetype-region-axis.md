# Profession corpus — archetype & region axis (WSID Phase 4)

**Date:** 2026-06-16
**Status:** Phase 1 (mechanism + first content) implemented
**Predecessor:** PR #2024 — profession-corpus runtime injection (WSID Phase 3)

## Problem

After #2024 every coworker resolves to a profession family and is served its
family corpus at runtime. But the corpus is **family-level and mostly
jurisdiction-neutral**: 150 pages across 23 families (avg 6.5), regional variants
for only 4 families, and **no archetype dimension at all** — a veterinary clinic
and a bank get byte-identical corpus. "Resolving to a family" is not the same as
"having the right corpus on install."

## Model

Corpus becomes **profession × jurisdiction × archetype**. Each coworker resolves
to its profession; the **install's archetype + region** select the slice it is
served, always falling back to archetype-neutral (`universal`) / region-neutral
(`global`) so nothing is ever empty.

- **Archetype axis** (`PROFESSION_ARCHETYPES`, wiki-taxonomy.ts) — `universal` +
  the 19 canonical `ArchetypeCategory` slugs (kept in sync by the
  `profession-archetype axis sync` invariant test). A page omitting
  `professionArchetype` is `universal`.
- **Selection rule** (`pageEligibleForInstall`): an archetype-specific page is
  served ONLY to a matching install (a retail install never sees HVAC craft).
  Jurisdiction is filtered ONLY when the install declares a concrete region —
  otherwise the full corpus is preserved (no regression for installs that haven't
  set a region). Matching variant pages are **ranked above** neutral ones.

## What shipped (Phase 1)

- Axis substrate: `PROFESSION_ARCHETYPES` + `isProfessionArchetype`; frontmatter
  `professionArchetype`; seed validate + tally + persist to `WikiPage.metadata`;
  `normalizeVariantAxes` archetype; `SeedProfessionCorpusResult.archetypeCoverage`.
- Variant-aware retrieval: `resolveProfessionCorpusContext` takes an
  `installContext`, filters eligible pages, and boosts matching variants.
- Install resolution: `resolveInstallVariantContext` (storefront archetype
  category → install archetype; region TBD), shared by the runtime path and the
  operator surfaces.
- "Noted at setup": the coworker record's Profession tab shows the install's
  resolved archetype + the family's archetype coverage.
- First archetype content: `professions/operations/automotive-adas-recalibration-dispatch`
  (`automotive-services`) — ADAS recalibration as a dispatcher compliance gate,
  sourced from an open CC-BY-SA reference.
- Tests: axis sync (corpus axis ⊇ canonical categories), eligibility +
  boost + generic-install isolation, install resolution, normalize archetype.

## Staged next (Phase 2+)

This is the mechanism + a first content wave. Building out a corpus for **every
unique region × archetype difference** is sustained, multi-wave work, driven by:

1. **Content waves** — thicken thin families; author archetype-specific craft for
   the dispatch wedge (trades-maintenance / automotive-services / moving-and-
   logistics / security-services) and regional doctrine, each with provenance.
2. **The growth-gap loop from #2024** — real coworker misses (now including
   archetype/region context) feed `ProfessionCorpusGap` as the prioritized backlog.
3. **Region as a first-class install setting** — capture the install's
   jurisdiction profile at setup so jurisdiction filtering engages (today the
   regional profile resolves empty = unfiltered).

## Regional is multi-dimensional — the jurisdiction-basis model (added 2026-06-16)

Region is not one tag. An install **operates in** some jurisdictions, **sells
to** others, and **employs in** others — and different obligations key off
different dimensions. A US business selling into the EU must get GDPR
marketing-consent rules (via `sellsTo`) even though it `operatesIn` only the US.

So a page declares `professionJurisdiction` **+ `professionJurisdictionBasis`**:

| Basis | Triggered by the install's… | Examples |
|---|---|---|
| `global` | (always, if the capability exists) | **PCI-DSS** card handling |
| `operating` | `operatesIn` (business establishment) | business licensing, corp tax/nexus, US-GAAP vs IFRS reporting |
| `selling` | `sellsTo` (customer/recipient location) | sales tax/VAT, **marketing consent** (GDPR/CAN-SPAM/CASL), consumer law |
| `employing` | `employsIn` (where work is done) | employment law, payroll tax, workers' comp |
| `data-residency` | `dataResidency` (where data subjects are) | **data sovereignty** |

Eligibility (`pageEligibleForInstall` → `jurisdictionEligible`): `global` always
applies; otherwise the page's jurisdiction must intersect the install's set **for
that basis**; an **undeclared** install dimension (empty set) does not filter (no
regression). `ProfessionCorpusInstallContext.regional` carries
`{operatesIn, sellsTo, employsIn, dataResidency}` (resolves empty until setup
captures it). Exemplar pages: `finance/pci-dss-card-handling-global` (global),
`marketing/eu-gdpr-consent-by-recipient-selling` (selling).

### Setup capture (added 2026-06-16)

The regional profile is now **captured at setup**, on `BusinessContext`
(`operatesIn / sellsTo / employsIn / dataResidency` jurisdiction sets +
`handlesCardPayments`, migration `..._add_business_context_compliance_scope`).
The business-context step gains a **"Compliance & regulatory scope"** section
using **progressive disclosure** (UX-Fit): the primary "where do you operate?" +
card-payments question is visible; the cross-border sell/employ/data-residency
detail is opt-in. `resolveInstallVariantContext` reads `BusinessContext` and
populates `regional`, so the jurisdiction-basis engine now bites for installs
that have declared their scope — and stays permissive (no filter) where a
dimension is blank.

**Follow-up:** re-tag the pre-existing jurisdiction pages (hr → `employing`,
marketing → `selling`, finance revenue-recognition → `operating`) which default
to `operating`; expand the jurisdiction taxonomy + setup options beyond us/eu/uk
as real installs need them; consider capability-gating `global`-basis pages on
`handlesCardPayments` (so PCI only surfaces for card-handling businesses).
