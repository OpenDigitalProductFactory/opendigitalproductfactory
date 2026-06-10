# BIAN-Grounded Banking Archetypes Design

- **Status:** Draft for review
- **Author:** Claude (directed by maintainer: "incorporate BIAN for the banking archetypes")
- **Date:** 2026-06-09
- **Related specs:** `2026-05-29-vehicle-equipment-rental-archetype-design.md` (new-archetype precedent), `2026-05-22-customer-surface-archetype-activation-design.md` (capability activation), `2026-04-04-business-model-portal-vocabulary-design.md` (vocabulary contract)
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

### 3.5 Anti-patterns identified

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

`banking-financial-services`: itemsLabel "Products & Rates", singleItemLabel "Product",
categoryLabel "Product Family", priceLabel "Rate / Fee", portalLabel "Banking Portal",
stakeholderLabel "Customers" *(leaf-level override to "Members" for credit-union follows
the existing archetype-wins resolution; if vocabulary remains category-keyed in v1, use
"Customers & Members")*, teamLabel "Bankers", inboxLabel "Applications", agentName
"Relationship Manager" *(BIAN Business Domain: Relationship Management)*.

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

## 9. Wiring Contract (files to touch)

Following the `hoa-property-management` end-to-end precedent:

1. `packages/storefront-templates/src/types.ts` — add `"banking-financial-services"` to `ArchetypeCategory`
2. `packages/storefront-templates/src/archetypes/banking-financial-services.ts` — three leaf definitions (§7)
3. `packages/storefront-templates/src/archetypes/index.ts` — register
4. `packages/storefront-templates/src/archetypes/archetypes.test.ts` — coverage
5. `packages/finance-templates/src/profiles.ts` — financial profile (interest income / fee income / interest expense categories; account-based revenue recognition)
6. `packages/db/src/business-capability-perspectives.ts` (+ test) — `bian-banking-v14` perspective (§8)
7. `packages/db/src/seed-storefront-archetypes.ts` — marketing-skill rules (§7.5)
8. `apps/web/lib/storefront/industries.ts` (+ test) — "Banking & Financial Services" option
9. `apps/web/lib/storefront/archetype-vocabulary.ts` — vocabulary (§7.4)
10. `apps/web/lib/onboarding/archetype-business-context.ts` (+ test) — onboarding context
11. `apps/web/lib/tak/marketing-playbooks.ts` / `apps/web/lib/finance/setup-profile.ts` — category wiring sweep (grep `hoa-property-management` for the full list at build time)

Reference data (this PR, already in repo): `docs/Reference/bian/` JSON + README + the
v7.6 integration PDF (LFS).

## 10. Verification

- Unit: archetype shape tests (every leaf passes the existing `archetypes.test.ts`
  invariants), perspective resolution test (`banking-financial-services` → BIAN + common
  perspectives), finance profile + industries tests.
- Seed: fresh-install seed run upserts 3 new archetypes; re-seed is idempotent;
  soft-deleted archetypes stay deleted (existing invariant).
- Functional (per `structural-verification-is-not-functional`): on the canonical install
  or CI sandbox lease, drive onboarding selecting *Credit Union*, confirm member
  vocabulary on the items surface, BIAN capability map on the capability page, and an
  end-to-end storefront inquiry on a share-certificate item.

## 11. Future Work (out of scope, enabled by the reference data)

- BIAN Service Operation → DPF integration-substrate modeling (the paper's Digital
  Interface / Digital Integration layer) for institutions that connect cores/vendors.
- Wealth-advisory / insurance / fintech leaves on the same category.
- Custom-archetype refinement flow offering the *full* 341-domain landscape as a picker.
- Hive-mind analytics keyed on canonical BIAN Service Domain names across banking installs.
- Semantic-API-informed MCP connector scaffolding for banking vendor integrations.
