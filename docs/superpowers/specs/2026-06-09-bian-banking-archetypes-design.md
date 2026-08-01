# BIAN-Grounded Banking Archetypes Design

> **Authority notice (2026-08-01):** This historical design records earlier BIAN and CSDM
> research lineage. The locally tracked joint discussion paper is not current normative or
> AI evidence until its source-use decision is completed (`GAP-SOURCE-001`). Use the
> rights-cleared BIAN data contract for observed implementation inputs and the
> [Four-Portfolio Archetype and AI Workforce Operating Standard](../../architecture/four-portfolio-archetype-ai-workforce-operating-standard.md)
> for target semantics and source-use controls.

- **Status:** Draft for review (enterprise-architecture review pass applied 2026-06-09; substrate claims verified against `origin/main` @ 240b528f3)
- **Author:** Claude (directed by maintainer: "incorporate BIAN for the banking archetypes")
- **Date:** 2026-06-09
- **Related specs:** `2026-05-29-vehicle-equipment-rental-archetype-design.md` (new-archetype precedent), `2026-05-22-customer-surface-archetype-activation-design.md` (capability activation), `2026-04-04-business-model-portal-vocabulary-design.md` (vocabulary contract), `2026-05-11-licensing-permit-jurisdiction-readiness-design.md` (jurisdiction/regulatory substrate, EP-LIC-C64FC2)
- **Reference data:** [`docs/Reference/bian/`](../../Reference/bian/README.md) — BIAN v14.0 Service Landscape (8 Business Areas / 43 Business Domains / 341 Service Domains, with official Semantic-API descriptions) + the joint ServiceNow/BIAN "Bridging BIAN and CSDM" v7.6 discussion paper (May 2026)

---

## 1. Problem Statement

DPF's archetype catalog covers 12 categories and ~45 leaf templates, but has **no banking
or financial-institution archetype**. The nearest neighbor (`professional-services →
accounting`) models an accounting *practice*, not a deposit-taking, lending institution.
A community bank, credit union, or mortgage lender that installs DPF today has no
archetype that matches its products, vocabulary ("members," "branches," "rates"), KYC-gated
account provisioning, or regulated-industry communication posture.

Banking is also the one vertical where DPF does **not** need to invent the capability
taxonomy: BIAN publishes a canonical, vendor-neutral decomposition of everything a bank
does (the Service Landscape), and the 2026 ServiceNow/BIAN integration paper (v7.6,
co-authored and endorsed by BIAN's Lead Architect and ServiceNow CSDM product management)
demonstrates exactly how that taxonomy projects onto a CSDM-style capability/service data
model — the same conceptual family DPF's own capability and EA substrate descends from.

This spec defines a new `banking-financial-services` archetype **category** whose leaf
archetypes, item templates, vocabulary, and business-capability perspective are **derived
from BIAN v14** rather than hand-invented — making DPF's banking archetypes
standards-grounded, hive-comparable across installs, and traceable to a maintained
industry reference.

## 2. Live Backlog Context

Queried via the `dpf` MCP backlog tools on 2026-06-09 (`list_epics`, limit 100):

- **No existing banking / BIAN / financial-institution epic or backlog item.** A sweep of
  `origin/main` history for `bank`/`BIAN` finds only the org-side finance module (the
  install's *own* bank accounts/reconciliation — EP-FINANCE, done) and the BIAN v8↔CSDM v3
  research note (`docs/Reference/framework-mapping-playlist/069-…`), neither of which
  overlaps an archetype category.
- **Epic home:** `EP-ARCH-8D4F2A` "Archetype Model V2: Unified Business Archetypes"
  (in-progress) is the natural parent — this work extends the archetype model with a new
  category; it does not need a new epic.

## 3. Research & Benchmarking

Per the Design Research rule (AGENTS.md §10): standards first, then data models of leaders.

### 3.1 BIAN Service Landscape v14.0 — the standard (primary anchor)

Source: `docs/Reference/bian/bian-v14-service-landscape.json` (extracted 2026-06-09 from
bian.org's canonical Value Chain View + the official `bian-official/public` GitHub
Semantic API specs).

The landscape decomposes banking into 8 Business Areas → 43 Business Domains → 341
**Service Domains** — MECE building blocks, each canonical ("Customer Credit Rating" means
the same thing in any bank), each carrying one of 19 functional patterns and publishing
Service Operations as Semantic APIs (258 of 341 have published OAS 3.x specs in release
14.0.0).

- **Adopted:** Business Domains and Service Domains as the **source taxonomy** for the
  banking capability perspective, service categories, and item templates. Canonicality is
  the property that makes hive-mind comparison across banking installs trustworthy — two
  community banks describe the same function with the same name.
- **Adopted:** the SMB-relevant subset. A community bank or credit union storefront needs
  the *Customers*, *Products*, and *Channels*-facing domains (Loans and Deposits, Consumer
  Banking, Cards, Relationship Management, Customer Care, Sales, Servicing) plus
  *Compliance* and *Credit Risk* awareness. The full 341-domain landscape (Market Trading,
  Syndicated Loans, Custody, Group Treasury…) stays in the reference JSON, not in the seed.
- **Rejected:** importing all 341 Service Domains as seeded capabilities. DPF's target
  operator is SMB through mid-market; a community bank does not run a trading desk.
  Over-seeding would bury the useful 30 domains under 300 irrelevant rows.

### 3.2 BIAN ↔ CSDM integration paper v7.6 (May 2026) — the projection pattern

Source: `docs/Reference/BIAN_CSDM_Integration_v76-US-English - FINAL.pdf` (+ distilled
summary in `docs/Reference/bian/README.md`).

The paper's core moves: Business Area → Business Capability L0, Business Domain →
Business Capability L1, Service Domain → a first-class conceptual anchor *contained by*
the capability hierarchy and *provided by* applications; Service Operations → Digital
Interfaces with Semantic APIs as reference specs. Four-layer traversal (Conceptual →
Logical → Physical → Consumption) gives bidirectional strategy↔operations traceability.

- **Adopted:** the **projection pattern**: BIAN supplies the banking vocabulary; the
  platform's existing capability substrate supplies the cross-domain bridge. DPF mirrors
  this by projecting BIAN levels into the existing `BusinessCapability` model via the
  existing sourced-perspective mechanism (`business-capability-perspectives.ts`) — L1 =
  Business Area, L2 = Business Domain, L3 = selected Service Domain. **No new tables.**
- **Adopted:** "core vs commodity" classification as the strategic payoff to preserve in
  capability descriptions (it drives outsource/retain decisions in the paper's worked
  examples); DPF's maturity fields (`currentMaturity`/`targetMaturity`) already carry this
  kind of strategic attribution.
- **Rejected (for v1):** a DPF analog of the custom Service Domain CI + Digital
  Interface/Digital Integration objects. That is the ServiceNow *operational estate*
  integration; DPF's banking archetype v1 is a storefront/portal + capability-map concern.
  Modeling BIAN Service Operations against DPF's integration/EA substrate is real future
  work (§11), not part of an archetype seed.

### 3.3 Digital banking platform vendors (commercial comparators)

Read for portal shape, not feature lists: **Banno (Jack Henry)** and **Alkami** — the two
dominant community-bank/credit-union digital banking platforms — and **Backbase**
(international engagement-banking platform).

- Common shape: a *marketing/storefront site* (products, rates, branch/ATM info, financial
  education) feeding an *account-opening funnel* with KYC identity verification, plus an
  authenticated servicing portal. The storefront/funnel/servicing split matches DPF's
  storefront → inquiry/booking → portal progression exactly.
- **Adopted:** product-card storefront with rate-forward presentation (`from`/`fixed`
  price types read as APY/APR "as low as" rates); appointment booking with a banker as a
  first-class CTA (Banno and Alkami both ship branch-appointment scheduling); KYC-gated
  account opening as *provisioning posture*, not as a built flow.
- **Rejected:** building account-opening/KYC execution, online banking, payments, or core
  integration in v1. DPF is the **engagement layer**; the core ledger stays with the
  institution's core (Jack Henry, Fiserv, FIS…). This is also the explicit BIAN-paper
  posture: the taxonomy classifies what the institution does; it does not replace the
  systems that do it.

### 3.4 Credit-union specifics

Credit unions are member-owned cooperatives; the vocabulary is regulator-enforced in
practice (NCUA): **members** not customers, **share accounts** (share savings, share
draft checking, share certificates) not deposit products. Membership eligibility (field of
membership) gates onboarding. This is a vocabulary + item-template delta over the same
BIAN domains — BIAN's *Savings Account* / *Current Account* / *Term Deposit* Service
Domains cover both charters.

### 3.5 Regulatory landscape + existing DPF jurisdiction substrate

Banking is a *chartered* industry: the jurisdiction and charter type determine which
regulator supervises the institution and which obligations attach. The combinations that
matter for the three leaves (directory-level, grounded in the named official sources):

- **US banks:** national charter → OCC; state member → Federal Reserve + state regulator;
  state nonmember → FDIC + state regulator; deposit insurance → FDIC (with the Part 328
  official-sign / advertising-statement display obligations). State regulators are
  navigable via the CSBS directory.
- **US credit unions:** federal charter → NCUA; state charter → state regulator; federally
  insured share accounts → NCUSIF with the NCUA official insurance sign display obligation.
- **US mortgage lenders/brokers:** state licensing through **NMLS** at both organization
  and individual loan-originator level (SAFE Act), with the NMLS Unique Identifier display
  obligation; CFPB supervision; RESPA/TILA disclosure regimes.
- **Cross-cutting US:** CFPB (consumer protection/UDAAP), FinCEN (BSA/AML program
  obligations), Equal Housing Lender/Opportunity display, Reg DD (Truth in Savings — APY
  accuracy in advertising), Reg Z (trigger-term rules for rate advertising).
- **International (directory-level only):** UK FCA register number display + PRA for
  banks; EU national competent authorities + ECB SSM, EBA register; Canada OSFI;
  Australia APRA/ASIC.

DPF already has the substrate for exactly this shape: the **licensing/permit/jurisdiction
readiness foundation** (`docs/superpowers/specs/2026-05-11-licensing-permit-jurisdiction-readiness-design.md`,
Accepted; epic `EP-LIC-C64FC2`; migration `20260511204500_add_licensing_readiness_foundation`).
Its doctrine — *seed official authority directories, not legal conclusions*; separate
requirement intelligence from the org's credential inventory; organization-level AND
individual-level scope; display obligations as first-class records — is precisely the
regulated-banking posture. `packages/db/data/license_requirement_reference.json` entries
are already keyed by `countryCode`/`stateProvinceCode` + `archetypeCategories` +
`scopeLevel`, so banking rows are additive data, not new schema.

- **Adopted:** extend the licensing-readiness substrate with banking authority entries;
  make the jurisdiction/charter investigation a **required onboarding step** for this
  category (it is optional posture for most archetypes; for a chartered institution it
  gates correct configuration).
- **Rejected:** encoding legal conclusions or per-state rule matrices in seed data
  (violates the licensing spec's bootstrap doctrine); building regulatory filing
  automation in v1.

### 3.6 Anti-patterns identified

- Hand-inventing a banking capability list when a maintained standard exists (violates
  `research-and-use-standards`).
- Mixing BIAN's deprecated Matrix-layout vocabulary with the canonical Value Chain View
  vocabulary (the two use different Business Area/Domain names for the same Service
  Domains — the reference JSON pins the Value Chain View).
- Treating the archetype as a core-banking system (scope explosion; regulated processing
  DPF must not own).

## 4. Design Goals

1. Add `banking-financial-services` as a first-class archetype **category** with three
   leaf archetypes — `community-bank`, `credit-union`, `mortgage-lending` — following the
   same wiring contract as every existing category.
2. Ground every taxonomy-bearing surface in BIAN v14: item templates name the products of
   BIAN's *Loans and Deposits* / *Consumer Banking* / *Cards* Service Domains; seeded
   service categories are kebab-case Business/Service Domain names; the
   business-capability perspective is a `bian-banking-v14`-sourced projection.
3. Reuse existing substrate exclusively: `ArchetypeDefinition` + `ActivationProfile`,
   `BusinessCapabilityPerspective`, `FinancialProfile`, vocabulary map, industries list.
   **Zero new tables, zero new modules.**
4. Encode the regulated-industry posture declaratively: `provisioning:
   "account-with-kyc"`, `commercialModel: "account-based-fees"`, marketing-skill reframes
   (no aggressive competitive claims; rate/term accuracy; NCUA/FDIC tone).
4a. Make **jurisdictional regulatory governance a first-class archetype concern**: banking
   authority entries in the licensing-readiness reference data, a required
   jurisdiction/charter capture step in initial onboarding/configuration, and storefront
   display obligations (Member FDIC / NCUA sign / Equal Housing / NMLS ID) wired to the
   captured posture (§9).
5. Keep the full BIAN landscape available as reference data
   (`docs/Reference/bian/bian-v14-service-landscape.json`) so future work (custom
   archetype refinement, integration modeling, hive analytics) can draw on domains the
   seed deliberately omits.

## 5. Non-Goals

- **Core banking execution** — no ledger, no transaction processing, no online/mobile
  banking, no payment rails. DPF is the engagement/storefront/operations layer beside the
  institution's core.
- **KYC/AML execution** — v1 records the provisioning *posture* (`account-with-kyc`);
  identity-verification vendor integration is future work.
- **Legal advice or regulatory conclusions** — reference entries are official authority
  *directories* per the licensing-readiness doctrine; the institution's compliance officer
  owns the legal determination. No automated regulatory filings in v1.
- **BIAN Service Operation / Semantic API modeling** against DPF's integration substrate
  (the CSDM paper's Digital Interface / Digital Integration analog) — future work, §11.
- **Wealth management / trading / insurance leaves** — the reference data covers their
  domains; leaves can be added later without rework.
- Live rate feeds; rates are operator-entered item attributes in v1.

## 6. Core Design Decisions

**D1 — BIAN projects into existing substrate; no parallel banking taxonomy.**
Options: (a) new `ServiceDomain` table mirroring the CSDM paper's custom CI; (b) projection
into the existing `BusinessCapability` perspective mechanism; (c) tags only.
**Decision: (b).** The paper itself maps BIAN's upper levels onto the *existing* capability
hierarchy and only adds a custom CI for operational-estate traversal DPF v1 doesn't need.
(a) duplicates `BusinessCapability` (violates `verify-substrate-before-proposing-new`,
`single-source-of-truth`); (c) loses the hierarchy that makes the capability map useful.

**D2 — Three leaves, one category.** `community-bank` (retail bank), `credit-union`
(member cooperative), `mortgage-lending` (lender/broker). These cover the dominant SMB
financial-institution charters with materially different vocabulary/products. Wealth
advisory, insurance, and fintech leaves are deferred — same category, later additions.

**D3 — Engagement-layer scope.** The archetype seeds storefront (products & rates,
branches, education, appointment booking), inquiry/application intake, and the
BIAN-grounded capability map. It deliberately does not execute regulated banking
processes (§5).

**D4 — Curated SMB subset for the perspective.** The seeded `bian-banking-v14` perspective
projects 4 Business Areas → 8 Business Domains → ~24 Service Domains (§8). Curation rule:
domains a community institution's *staff portal* plans and reports against. The full
landscape stays in reference data.

**D5 — Required-but-not-blocking jurisdiction capture; disclosure honesty over
completeness.** The §9.2 step is "required" in the sense that the category's onboarding
checklist holds it open and the portal carries a visible "regulatory posture incomplete"
state until completed — it never hard-blocks archetype activation (operators explore
before they configure; a hard gate trains them to enter junk data). The disclosures
surface (§9.3) never renders an insurance or registration claim without a confirmed
credential row behind it: missing posture renders a neutral placeholder, not a default
"Member FDIC". Displaying a false FDIC/NCUA sign is itself a regulatory violation, so the
failure mode must always be **omission, never fabrication**.

## 7. Leaf Archetype Definitions

Shared activation posture (all three leaves):

| Axis | Value | Rationale |
| ---- | ----- | --------- |
| `form` / `delivery` | `services` / `hybrid` | Branch + digital |
| `primaryConsumer` | `individual` (household for credit-union) | Retail focus |
| `consumptionChannel` | `multi-channel` | Branch, web, phone |
| `commercialModel` | `account-based-fees` | Existing enum value, built for this |
| `provisioning` | `account-with-kyc` | Existing enum value, built for this |
| `platform` | `no` | Not a marketplace |
| `billingProfile` | primary `recurring-agreement`; `invoiceExecutionMode: "prepared-not-prescribed"` | Fees accrue to accounts; DPF prepares, never moves money |
| modules | `customer-estate`, `service-agreements`, `billing-readiness`, `lifecycle-signals`, `integrations` | Reuse; no new modules |
| `ctaType` | `inquiry` (booking on banker-appointment items) | Application intake + branch appointments |

### 7.1 `community-bank` — items grounded in BIAN Service Domains

| Item template | BIAN Service Domain (Business Domain) |
| ------------- | ------------------------------------- |
| Checking Account | Current Account (Loans and Deposits) |
| Savings Account | Savings Account (Loans and Deposits) |
| Certificate of Deposit | Term Deposit (Loans and Deposits) |
| Personal Loan | Consumer Loan (Loans and Deposits) |
| Mortgage | Mortgage Loan (Loans and Deposits) |
| Business Loan | Corporate Loan (Loans and Deposits) |
| Debit & Credit Cards | Card products (Cards) |
| Meet with a Banker *(booking, 30 min)* | Bank Customer Contact Handling / Servicing |

Sections: hero, items ("Products & Rates"), about ("About the Bank"), team ("Our
Bankers"), contact ("Visit a Branch"). Form: inquiry base + product interest select +
"existing customer?" select.

### 7.2 `credit-union` — member vocabulary over the same domains

Share Savings, Share Draft Checking, Share Certificate, Auto Loan, Personal Loan,
Mortgage & HELOC, Become a Member *(inquiry; Party Lifecycle Management SD)*, Meet with a
Member Advisor *(booking)*. Sections rename accordingly ("Membership", "Rates").
Form adds field-of-membership eligibility select.

### 7.3 `mortgage-lending` — lender/broker funnel

Pre-Approval *(inquiry; Underwriting + Customer Credit Rating SDs)*, Purchase Mortgage,
Refinance, HELOC *(Consumer Loan)*, Rate Quote *(quote price type)*, Meet with a Loan
Officer *(booking)*. Form adds loan purpose / property type / price range selects.

### 7.4 Vocabulary (`archetype-vocabulary.ts`)

Category defaults in the `VOCABULARY` map (the map is category-keyed): itemsLabel
"Products & Rates", singleItemLabel "Product", addButtonLabel "Add product", categoryLabel
"Product Family", priceLabel "Rate / Fee", portalLabel "Banking Portal", stakeholderLabel
"Customers", teamLabel "Bankers", inboxLabel "Applications", agentName "Relationship
Manager" *(BIAN Business Domain: Relationship Management)*.

**Leaf vocabulary override (decided — replaces the earlier hedge).** There is no
"archetype-wins" resolution in the static map today; the only existing override path is
`StorefrontArchetype.customVocabulary` (a `Json?` column already consumed by
`getVocabulary()` everywhere vocabulary renders), currently written only by the
custom-archetype admin flow. v1 adds an optional `vocabulary?: Partial<ArchetypeVocabulary>`
field to `ArchetypeDefinition`, which the archetype seed writes into the leaf's
`customVocabulary` on upsert. `credit-union` uses it: stakeholderLabel "Members",
portalLabel "Member Portal", agentName "Member Advisor". The blended-label fallback
("Customers & Members") is **rejected**: member vocabulary is the defining
cultural/regulatory delta of the credit-union charter (§3.4) and must not be diluted.
Zero schema change — the column and the read path exist; this is one optional type field,
one seed write, one test.

### 7.5 Marketing-skill rules (`seed-storefront-archetypes.ts`)

Regulated-communication reframes mirroring the healthcare pattern: competitive-analysis →
"Local Institution Positioning" (trust- and community-anchored, no aggressive claims;
rate claims must match current published rates); email-campaign-builder → "Customer &
Member Communication Builder" (rate changes, financial education, branch notices;
compliance-reviewable tone).

## 8. BIAN-Sourced Business-Capability Perspective

New perspective in `packages/db/src/business-capability-perspectives.ts`:

```
perspectiveId: "bian-banking-v14"
label: "Banking (BIAN v14)"
source: "BIAN Service Landscape v14.0 Value Chain View — docs/Reference/bian/bian-v14-service-landscape.json"
```

Curated projection (L1 = BIAN Business Area, L2 = Business Domain, L3 = Service Domain;
keys `bian-<kebab-name>`; descriptions from the official Semantic-API descriptions in the
reference JSON):

- **Customers** → Relationship Management (Customer Relationship Management, Customer
  Behavior Insights), Customer Care (Customer Case Management, Bank Customer Contact
  Handling), Sales (Customer Offer, Lead/Opportunity Management), Party Reference (Party
  Reference Data Directory, Party Lifecycle Management)
- **Products** → Loans and Deposits (Current Account, Savings Account, Term Deposit,
  Consumer Loan, Mortgage Loan, Corporate Loan, Underwriting), Cards (Card Issuance &
  servicing), Consumer Banking (Customer Credit Rating† if retained in this BD in v14 —
  resolve against the reference JSON at implementation time)
- **Operations** → Accounting Services (Position Keeping / Account Reconciliation),
  Clearing and Settlement (Payment Order)
- **Finance & Risk Management** → Compliance (Regulatory Compliance, Guideline
  Compliance), Credit Risk (Credit Management)

† Implementation note: exact Service Domain → Business Domain placement MUST be read from
`bian-v14-service-landscape.json`, not from this prose — the JSON is the source of truth
extracted from the canonical view.

Wiring: the perspective resolves for `category === "banking-financial-services"` alongside
`COMMON_SMALL_BUSINESS` (same composition pattern as the MSP overlay), so a bank install
still gets the universal small-business capabilities (HR, marketing, finance ops) plus the
BIAN overlay.

## 9. Regulatory & Jurisdictional Governance

Banks and financial institutions are subject to regulation and governance **specific to
the jurisdiction they operate in**. This is a first-class archetype concern, captured
during initial onboarding/configuration — not an afterthought bolted on post-setup. The
design reuses the licensing-readiness substrate end to end (§3.5); everything below is
additive data + wiring, zero new schema.

### 9.1 Banking authority reference entries (bootstrap directories)

Add entries to `packages/db/data/license_requirement_reference.json` with
`archetypeCategories: ["banking-financial-services"]`, following the existing entry shape
(`requirementRefId`, `countryCode`/`stateProvinceCode`, `authorityType`, `scopeLevel`,
`displayRuleSummary`, official `sourceUrls`, `confidence`, `staleAfterDays`):

| Entry | Scope | Display obligation captured |
| ----- | ----- | --------------------------- |
| `LIC-REQ-US-OCC` / `US-FRB` / `US-FDIC` | organization | FDIC Part 328 official sign + advertising statement ("Member FDIC") |
| `LIC-REQ-US-NCUA` | organization | NCUA official insurance sign |
| `LIC-REQ-US-CFPB`, `LIC-REQ-US-FINCEN-BSA` | organization | — (supervision / BSA-AML program directories) |
| `LIC-REQ-US-NMLS-ORG` | organization | NMLS Unique Identifier on consumer-facing pages |
| `LIC-REQ-US-NMLS-MLO` | individual | individual loan-originator NMLS ID (SAFE Act) |
| `LIC-REQ-US-CSBS-STATE` | organization | state banking-department directory (per-state research entry) |
| `LIC-REQ-US-EQUAL-HOUSING` | organization | Equal Housing Lender / Opportunity logo |
| `LIC-REQ-GB-FCA` (+ PRA), `LIC-REQ-EU-EBA`, `LIC-REQ-CA-OSFI`, `LIC-REQ-AU-APRA` | organization | FCA register number display (GB); others directory-level |

Per the licensing doctrine these are research entrypoints with official URLs — never
legal conclusions.

### 9.2 Onboarding / initial configuration capture (required for this category)

For `banking-financial-services` the jurisdiction step is **required** during onboarding
(other archetypes treat licensing investigation as optional posture):

1. **Operating jurisdiction** — country + state/province (reuses the org's existing
   location data as the default; confirms rather than re-asks).
2. **Charter / license type per leaf** — community-bank: national / state-member /
   state-nonmember; credit-union: federal / state charter; mortgage-lending: lender /
   broker / servicer.
3. **Derived regulator suggestion** — from jurisdiction × charter, suggest the primary
   regulator and insurance regime (e.g. "federal credit union → NCUA, NCUSIF-insured")
   with the matching reference entries from §9.1 attached as the investigation starting
   set. Operator confirms or corrects; the confirmation is stored as the org's credential
   inventory rows (licensing substrate), never silently assumed.
4. **Credential identifiers** — FDIC certificate number / NCUA charter number / NMLS ID
   as organization credentials; optional individual MLO NMLS IDs for mortgage-lending
   staff (scopeLevel `individual`).
5. **Display obligations** — the confirmed posture activates storefront disclosure
   rendering (§9.3).

Substrate binding (verified on main): the capture step extends the **existing compliance
onboarding wizard** (`apps/web/app/(shell)/compliance/onboard` →
`components/compliance/OnboardingWizard.tsx`, which already has `OnboardingDraft`
persistence) — no second wizard. Archetype activation for this category deep-links the
operator into that wizard with the §9.1 reference entries pre-filtered. Confirmations
persist to the landed licensing models: jurisdiction/charter posture on
`OrganizationLicenseProfile`; organization credentials (FDIC certificate / NCUA charter /
NMLS org ID) as `OrganizationLicenseRecord` rows; individual MLO NMLS IDs as
`PersonLicenseRecord` rows; display duties as `LicenseDisplayObligation` rows
(`displayType`, `displayLocation`, `isSatisfied`). Skipping the step follows D5: checklist
stays open, posture banner shows, activation proceeds.

### 9.3 Storefront display obligations

Each leaf's `sectionTemplates` includes a **"Disclosures"** section (sortOrder last)
using a new first-class `disclosures` member on `SectionType`
(`packages/storefront-templates/src/types.ts`; precedent: the domain-specific
`animals-available` type). A `custom` section cannot do this job — its content is static
seeded copy with no data binding. The `disclosures` case in
`apps/web/components/storefront/SectionRenderer.tsx` reads the org's
`LicenseDisplayObligation` rows and renders the confirmed set: "Member FDIC" statement,
NCUA official sign, Equal Housing Lender/Opportunity logo, NMLS ID line, FCA register
number (GB). With no captured posture it renders a neutral placeholder per D5 — never a
fabricated claim. Rate-bearing item presentation carries the Reg DD / Reg Z accuracy
posture in the marketing-skill reframes (§7.5) — APY/APR claims must match current
published rates; trigger-term awareness in ad copy.

### 9.4 Capability-map tie (BIAN)

Regulatory posture attaches to the BIAN **Compliance** Business Domain capabilities
(`Regulatory Compliance`, `Guideline Compliance`) in the `bian-banking-v14` perspective —
the same place the BIAN↔CSDM paper anchors compliance traceability — so the capability
page shows jurisdiction readiness where a bank examiner-minded operator expects it.

### 9.5 Onboarding business-context profile

`archetype-business-context.ts` gains a `banking-financial-services` profile whose
`howWeDecide` leads with safety-and-soundness and regulatory obligation ("regulatory
compliance and member/customer trust outrank growth and speed; we never trade examination
posture for short-term revenue"), and whose `supplyChain` names the real vendor shape
(core processor, card network, deposit-insurance regime, credit bureaus).

## 10. Wiring Contract (files to touch)

Following the `hoa-property-management` end-to-end precedent (items 12–14 add the §9
regulatory wiring):

1. `packages/storefront-templates/src/types.ts` — add `"banking-financial-services"` to `ArchetypeCategory`, `"disclosures"` to `SectionType` (§9.3), and optional `vocabulary?: Partial<ArchetypeVocabulary>` on `ArchetypeDefinition` (§7.4)
2. `packages/storefront-templates/src/archetypes/banking-financial-services.ts` — three leaf definitions (§7), incl. credit-union `vocabulary` override
3. `packages/storefront-templates/src/archetypes/index.ts` — register
4. `packages/storefront-templates/src/archetypes/archetypes.test.ts` — coverage
5. `packages/finance-templates/src/profiles.ts` — financial profile (interest income / fee income / interest expense categories; account-based revenue recognition)
6. `packages/db/src/business-capability-perspectives.ts` (+ test) — `bian-banking-v14` perspective (§8)
7. `packages/db/src/seed-storefront-archetypes.ts` — marketing-skill rules (§7.5) + write leaf `vocabulary` into `StorefrontArchetype.customVocabulary` on upsert (§7.4)
8. `apps/web/lib/storefront/industries.ts` (+ test) — "Banking & Financial Services" option
9. `apps/web/lib/storefront/archetype-vocabulary.ts` — vocabulary (§7.4)
10. `apps/web/lib/onboarding/archetype-business-context.ts` (+ test) — onboarding context
11. `apps/web/lib/tak/marketing-playbooks.ts` / `apps/web/lib/finance/setup-profile.ts` / `apps/web/lib/public-web-tools.ts` / `apps/web/lib/integrate/contribution-review.ts` — category wiring sweep (grep `hoa-property-management` — list verified 2026-06-09; re-grep at build time)
12. `packages/db/data/license_requirement_reference.json` + `packages/db/src/seed-license-requirements.ts` test — banking authority entries (§9.1); seed test asserts the banking rows land (guard the silent-seed-skip class)
13. `apps/web/components/compliance/OnboardingWizard.tsx` (+ archetype-activation deep link) — required jurisdiction/charter capture for this category (§9.2), persisting to `OrganizationLicenseProfile` / `OrganizationLicenseRecord` / `PersonLicenseRecord` / `LicenseDisplayObligation`
14. `apps/web/components/storefront/SectionRenderer.tsx` — `disclosures` section case rendering captured display obligations, with the D5 placeholder state (§9.3)

Reference data (this PR, already in repo): `docs/Reference/bian/` JSON + README + the
v7.6 integration PDF (LFS).

## 11. Verification

- Unit: archetype shape tests (every leaf passes the existing `archetypes.test.ts`
  invariants), perspective resolution test (`banking-financial-services` → BIAN + common
  perspectives), finance profile + industries tests.
- Seed: fresh-install seed run upserts 3 new archetypes; re-seed is idempotent;
  soft-deleted archetypes stay deleted (existing invariant).
- Functional (per `structural-verification-is-not-functional`): on the canonical install
  or CI sandbox lease, drive onboarding selecting *Credit Union*, confirm the **required
  jurisdiction/charter step** captures "federal credit union / US" and derives
  NCUA + NCUSIF posture, confirm member vocabulary on the items surface, the BIAN
  capability map on the capability page, the NCUA/Equal-Housing disclosures section on the
  storefront, and an end-to-end storefront inquiry on a share-certificate item.
- Seed: license-requirement seed run asserts the §9.1 banking entries upsert (count
  assertion, not log eyeballing); archetype seed run asserts credit-union
  `customVocabulary` lands (§7.4).
- Disclosures honesty (D5): with no captured posture the storefront disclosures section
  renders the neutral placeholder (assert no "Member FDIC"/NCUA text); after posture
  capture it renders exactly the confirmed obligation set.

## 12. Future Work (out of scope, enabled by the reference data)

- BIAN Service Operation → DPF integration-substrate modeling (the paper's Digital
  Interface / Digital Integration layer) for institutions that connect cores/vendors.
- Wealth-advisory / insurance / fintech leaves on the same category.
- Custom-archetype refinement flow offering the *full* 341-domain landscape as a picker.
- Hive-mind analytics keyed on canonical BIAN Service Domain names across banking installs.
- Semantic-API-informed MCP connector scaffolding for banking vendor integrations.
- Deeper regulatory automation: per-state rule matrices, examination-calendar signals,
  automated renewal tracking against NMLS/FDIC/NCUA records, regulatory-filing readiness
  (builds on `EP-LIC-C64FC2`'s coworker investigation flow once that lands).
