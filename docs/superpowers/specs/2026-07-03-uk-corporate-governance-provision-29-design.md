# UK Corporate Governance Code — Provision 29 (jurisdiction- and listing-gated governance) — Design

- **Status:** implemented (initial slice)
- **Date:** 2026-07-03
- **Area:** compliance / governance (customer-facing), onboarding, coworker corpus
- **Related:** `regulation-applicability.ts`, `compliance-library.ts`, `seed-banking-compliance.ts` (pattern), profession-corpus jurisdiction-basis model

## 1. Problem

The UK Corporate Governance Code (FRC, 2024 edition), and specifically its **Provision 29**, requires the board of a UK **premium-listed** company to monitor its risk-management and internal-control framework, review the effectiveness of its **material controls** (financial, operational, compliance, reporting), and **declare in the annual report** whether they operated effectively at the balance-sheet date — disclosing material weaknesses and remediation. It applies for accounting periods beginning on/after **1 January 2026** on a **comply-or-explain** basis (not statute).

We want the platform to (a) recognise when Provision 29 applies to the organisation using the platform — gated by **jurisdiction (UK operating nexus)** and **legal form (premium-listed)** — and (b) surface it through the AI coworkers during onboarding, without showing it to organisations it doesn't apply to.

## 2. Key constraint: it is listing-gated, not industry-gated

The platform's archetypes are deliberately jurisdiction- and legal-form-neutral (a "banking" archetype exists for US/UK/EU alike). Provision 29 keys on **corporate legal form** (premium-listed), which is **orthogonal** to the industry archetype — any archetype can be a listed or private company. This is the one genuine data-model gap; everything else reuses existing machinery.

## 3. Research & Benchmarking

- **UK FRC 2024 Code / Provision 29** (primary source): board declaration on material-controls effectiveness; premium-listing scope; 1 Jan 2026 effective date; comply-or-explain. Pattern adopted: model as reference `Regulation → Obligation → Control`, classified per-install — **not** asserted as binding platform doctrine (respects the WWWD / Decision-Perspective boundary in AGENTS.md §16).
- **US SOX 404** (benchmark, rejected as a model): SOX is statutory with management + auditor attestation and criminal exposure. Provision 29 is deliberately lighter (comply-or-explain, board declaration only). We reused our existing attestation record (`RequirementCompletion`) rather than importing a SOX-style dual-attestation model the Code does not require.
- **Existing DPF compliance packs** (`seed-banking-compliance.ts`, `seed-public-sector-compliance.ts`): those gate by **industry**. Provision 29 needed a **listing-status** gate instead — so we extended the applicability model with a listing dimension rather than forcing it through the industry match, and gave it a bespoke classifier (mirroring the existing `classifyCada` special-case).
- **Anti-pattern avoided:** creating a new "listed company" *archetype*. That would fork every industry archetype into listed/private variants (combinatorial). Listing status is a per-org attribute on `BusinessContext`, matching how the regional footprint is already captured.

## 4. Design

### 4.1 Data model — listing status (the one net-new field)
`BusinessContext.listingStatus String?` (nullable; null = undeclared → "review", never silently applied). Canonical values are the `LISTING_STATUSES` enum in `regulation-applicability.ts`: `premium-listed | standard-listed | aim-listed | private | other`. Migration: `20260703120000_add_business_context_listing_status` (additive, nullable — safe).

### 4.2 Applicability model
`RegionProfile` gains optional `listingStatus`; `RegulationApplicability` gains optional `listingStatuses[]`. `regulationApplies` adds a listing gate (after the archetype gate): a spec with `listingStatuses` requires the profile's status to be one of them. Backward compatible — existing specs (CADA) omit it. New export `UK_CORP_GOV_CODE_APPLICABILITY = { basis: ["operating"], jurisdictions: ["uk"], listingStatuses: ["premium-listed"] }`.

### 4.3 Classification (per-install)
`classifyUkCorpGov` in `compliance-library.ts` (keyed on `REG-UK-CORP-GOV-CODE`, like `classifyCada`):
- **applies** — UK operating nexus **and** premium-listed.
- **review** — no operating footprint captured yet; or UK-operating but listing status undeclared.
- **reference** — no UK operating nexus; or UK-operating but non-premium-listed.

`resolveComplianceLibraryContext` now reads `listingStatus` into `regional`.

### 4.4 Seeder
`seed-uk-corp-gov-compliance.ts` (cross-sector, `industry: null`) seeds one `Regulation` (`REG-UK-CORP-GOV-CODE`), four Provision-29 obligations (monitor / review material controls / board declaration / disclose weaknesses), and one linking `Control`. Registered in `seed.ts` after the banking pack. Idempotent upsert, following the banking-pack pattern exactly.

### 4.5 Onboarding intake
`BusinessContextForm` shows a listing-status `<select>` **only when the org operates in the UK** (`operatesIn.includes("uk")`) — progressive disclosure keeps cognitive load to a couple of plain choices for everyone else. Persisted via the existing `business-context/setup` route (sanitised against the enum).

### 4.6 Coworker surfacing
`docs/professions/finance/wiki/uk-corporate-governance-code-provision-29.md` — a UK-basis (`professionJurisdictionBasis: operating`, `professionJurisdiction: [uk]`) profession-corpus page. The existing `profession-corpus` + `install-variant-context` path injects it into coworkers **only for UK-operating installs**, with no new plumbing.

## 5. Verification & gate status

- **Source-local (run):** `@dpf/db` + `web` typecheck; `regulation-applicability.test.ts` and `compliance-library.test.ts` (new cases for the listing gate + all four classification outcomes).
- **Runtime-bound (must run on the sandbox / canonical install per AGENTS.md §5 — unrun in the source-only authoring environment):** migration apply, seed run, `next build`, and UX verification of the UK-gated intake field. These are unrun gates, not red gates.

## 6. Out of scope / follow-ups

- Wiring the Provision-29 control into `RegulatoryAutonomyPolicy` (human-control ceiling for the board-declaration activity) — a natural next step, deferred.
- A dedicated Provision-29 workspace/checklist surface beyond the existing compliance library.
- Listing status is currently free single-select; a future refinement could auto-derive premium-listing from a companies-register lookup.
