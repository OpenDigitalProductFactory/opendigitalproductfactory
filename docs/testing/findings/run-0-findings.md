# Run 0 — Findings (Pilot / Calibration + software-platform)

**Date:** 2026-06-11  
**Install:** Fresh install (Tier 1) — D:\DPF at PR #1560 (detached HEAD)  
**Auditor:** Claude (autonomous)  
**Backup:** `docs/testing/backlog-snapshots/pre-audit-2026-06-11.dump` — verified (1 org / 1,297 BIs / 91 epics)

---

## Harness Validation Log

| Step | Result | Notes |
|------|--------|-------|
| Backup rehearsal | PASS | 26 MB dump; restore row counts match (1/1,297/91) |
| Inventory confirmation | WARN | 46 archetypes seeded; 53+ expected — see Finding 1 |
| Provider bootstrap | WARN | Docker Model Runner active (gemma4); no Anthropic auto-config — see Finding 3 |
| Coworker health gate | PASS | COO "Jiminy" responded via Docker Model Runner; named self, described role correctly |
| Swap verification | DEFERRED | No UI path for archetype swap; Tier 2 DB reset is the mechanism (by design) |
| Reference-number check | DEFERRED | No customers seeded; deferred to Run 1 |
| Timing calibration | N/A | Portal at PR #1560 (very old install); timing not representative |

---

## Findings

---

### FINDING-001

```
RUN: 0
ARCHETYPE: all
INSTALL MODE: fresh-install
PHASE: Harness / Inventory
OBSERVATION: pnpm install from D:\DPF seeded 46 archetypes. DB query confirms 46 rows in StorefrontArchetype. Archetype selector UI shows 12 categories (Beauty, Education, Fitness, Food, Healthcare, HOA, Nonprofit, Pet, Professional, Retail, Software, Trades).
EXPECTED: 53 archetypes per audit plan (note: origin/main is now at 56 per PR #1729). Missing: community-bank, credit-union, mortgage-lending, small-town-municipality, law-enforcement-agency + rental family (equipment-rental, vehicle-rental, coworking-space, tool-library at minimum).
SEVERITY: important
CANDIDATE BI TITLE: Fresh install seed missing banking, civic, and rental archetype families (10+ archetypes)
CANDIDATE EPIC: EP-ARCHETYPE or new EP-SEED-COMPLETENESS
UX FIT: Operators in banking, civic, and rental sectors cannot select their archetype on fresh install — they fall through to "custom operating model" with no template guidance.
```

---

### FINDING-002

```
RUN: 0
ARCHETYPE: all
INSTALL MODE: fresh-install
PHASE: Harness / Procedural
OBSERVATION: D:\DPF is in detached HEAD at b875eabcd (PR #1587). Origin/main is at d6b1af0ef (PR #1729) — 142 PRs ahead. Portal container image was built at d30ed5b82 (PR #1560). fresh-install.ps1 uses D:\DPF as source for seed scripts; portal runs from the pre-built image.
EXPECTED: For valid audit results, D:\DPF should be on origin/main. The audit plan assumes fresh install reflects the current codebase. Running 169 PRs behind means portal features, seed data, and coworker prompts tested do not reflect the current platform state.
SEVERITY: important
CANDIDATE BI TITLE: Audit harness: fresh-install.ps1 requires D:\DPF to be on origin/main — detached HEAD produces stale results
CANDIDATE EPIC: EP-AUDIT-PROCESS
UX FIT: Procedural gap — affects audit validity, not end-user UX directly. Blocks meaningful regression detection.
```

---

### FINDING-003

```
RUN: 0
ARCHETYPE: software-platform
INSTALL MODE: fresh-install
PHASE: Harness / Provider Bootstrap
OBSERVATION: .env contains no ANTHROPIC_API_KEY. After fresh install, Providers page shows Claude/Anthropic (API Key) = "needs credentials / unconfigured". Claude/Anthropic (OAuth Subscription) = "3/4 models / unconfigured". Only Docker Model Runner (local, gemma4) is active.
EXPECTED: Per zero-click-provider-setup principle: "OAuth = the only step; everything else automatic." A fresh install with no LLM credentials should at minimum surface a clear first-run prompt to connect a provider. The COO responds via local gemma4, which is lower quality than frontier models.
SEVERITY: minor
CANDIDATE BI TITLE: Fresh-install first-run prompt to connect LLM provider missing — operator must discover Providers & Routing independently
CANDIDATE EPIC: EP-PROVIDER-UX or EP-ZERO-CLICK
UX FIT: New operator lands at workspace, gets gemma4-quality responses, has no indication that connecting Anthropic or another provider would give better results. Provider discovery is buried under Platform > AI Operations.
```

---

### FINDING-004

```
RUN: 0
ARCHETYPE: software-platform
INSTALL MODE: fresh-install
PHASE: D (Finance) — D1 Currency Default
OBSERVATION: Financial setup wizard (both in storefront/setup and finance/settings/setup) defaults to GBP as the first/selected currency. No locale detection. Confirmed via JS: document.querySelector('select').value === 'GBP'.
EXPECTED: Currency default should use browser locale (navigator.language) or geo-IP heuristic. For a software-platform archetype, USD is the most likely base currency globally. At minimum, the order should reflect global SaaS prevalence (USD, EUR, GBP, ...) rather than defaulting GBP-first.
SEVERITY: minor
CANDIDATE BI TITLE: Finance setup defaults to GBP with no locale detection — wrong default for non-UK installs
CANDIDATE EPIC: EP-FINANCE-SETUP or EP-LOCALISATION
UX FIT: US/global operators must manually change currency. UK operators get a lucky default. Inconsistent with zero-friction onboarding goal.
```

---

### FINDING-005

```
RUN: 0
ARCHETYPE: software-platform
INSTALL MODE: fresh-install
PHASE: D (Finance) — Finance Setup Persistence
OBSERVATION: Completed financial setup via storefront/setup wizard (selected USD, No VAT, clicked "Set Up Finances" — confirmed "Finances configured" screen). Navigated to finance/configuration — shows CONFIGURED: No. Finance > Settings > Setup page shows setup form again with GBP default (not USD as previously set). finance/settings/setup repeatedly shows as uncompleted.
EXPECTED: Completing the storefront financial wizard should mark the org as finance-configured and persist the currency/VAT selection. Re-entering finance/settings/setup should show current values, not the default form.
SEVERITY: important
CANDIDATE BI TITLE: Financial setup wizard does not persist configuration — finance module shows CONFIGURED: No after completion
CANDIDATE EPIC: EP-FINANCE-SETUP
UX FIT: Operator completes setup, believes finances are ready, but finance module remains in unfinished state. Creates confusion about what's actually configured. "Complete your financial setup" banner continues to appear.
```

---

### FINDING-006

```
RUN: 0
ARCHETYPE: software-platform
INSTALL MODE: fresh-install
PHASE: D (Finance) — Archetype Profile Mapping
OBSERVATION: Finance > Settings > Setup shows PROFILE SOURCE: "Professional Services". The current archetype is software-platform.
EXPECTED: software-platform should have its own finance profile (or inherit from a specific parent). SaaS finance has distinct characteristics: MRR/ARR tracking, deferred revenue, R&D capitalisation, infrastructure/hosting as primary COGS. "Professional Services" baseline doesn't capture these SaaS-specific dimensions.
SEVERITY: minor
CANDIDATE BI TITLE: Software-platform archetype falls back to professional-services finance profile — no SaaS-specific finance defaults
CANDIDATE EPIC: EP-ARCHETYPE or EP-FINANCE-SETUP
UX FIT: Operator setting up a SaaS company sees generic consulting/services finance framing. No MRR, ARR, or R&D expense categories pre-populated. Leads to generic Chart of Accounts that doesn't fit SaaS.
```

---

### FINDING-007

```
RUN: 0
ARCHETYPE: software-platform
INSTALL MODE: fresh-install
PHASE: D (Finance) — Tax Profile
OBSERVATION: OrganizationTaxProfile table is empty after completing financial setup with VAT=No, currency=USD. No tax profile row was inserted.
EXPECTED: Setting VAT=No and completing financial setup should create an OrganizationTaxProfile record with at minimum: homeCountryCode, taxModel=none/exempt, setupStatus=draft. The tax remittance surface (finance/settings/tax) shows "SETUP: Draft / REGISTRATIONS: 0" which confirms the intent exists but the actual record wasn't written.
SEVERITY: important
CANDIDATE BI TITLE: Financial setup wizard does not write OrganizationTaxProfile record — tax configuration state orphaned
CANDIDATE EPIC: EP-FINANCE-SETUP or EP-TAX
UX FIT: Tax Remittance surface has no source record to work from. Operator who later tries to configure tax finds no prior state. Requires discovering the setup was incomplete and re-entering it.
```

---

### FINDING-008

```
RUN: 0
ARCHETYPE: software-platform
INSTALL MODE: fresh-install
PHASE: O (AI Coworker Intelligence) — O1 Tax Setup
OBSERVATION: Asked COO: "As a software platform business, what tax obligations should I be aware of? Specifically around VAT on digital services and US sales tax." COO responded: "I could not find any specific knowledge articles regarding VAT on digital services or US sales tax obligations for a software platform in the knowledge base. Since tax laws are highly specific to jurisdiction and business model, I recommend you consult with a qualified tax professional or legal counsel."
EXPECTED: Level 3 maturity — COO should know: (1) EU VAT on digital services (VAT MOSS / OSS; threshold varies by country); (2) UK digital services VAT (20%, no £85k threshold for digital services sold to consumers); (3) US sales tax nexus (Wayfair ruling; economic nexus at $100k/200 transactions threshold in most states); (4) software-platform-specific R&D tax credits (UK: R&D tax relief; US: Section 41). Actual response: Level 1 (generic — consult a professional).
SEVERITY: important
CANDIDATE BI TITLE: COO has no SaaS-specific tax knowledge — Level 1 maturity on digital services VAT and US sales tax nexus questions
CANDIDATE EPIC: EP-COWORKER-KNOWLEDGE or EP-ARCHETYPE-INTELLIGENCE
UX FIT: Operator asks the one question every SaaS founder has early on ("do I need to charge VAT?") and gets a non-answer. The coworker fails its core value proposition of AI-native business intelligence.
```

---

### FINDING-009

```
RUN: 0
ARCHETYPE: software-platform
INSTALL MODE: fresh-install
PHASE: O (AI Coworker Intelligence) — O7 Circular Confusion
OBSERVATION: Asked COO: "What is DPF and what does it do? Who are our target customers?" COO responded: "The Digital Product Factory (DPF) framework defines a Digital Product as anything that runs code... Regarding our target customers, I do not have that specific information... could you tell me which product or feature you are referring to?"
EXPECTED: Level 3 — COO should recognise: (1) This org IS running DPF as its product (software-platform archetype = the org sells DPF); (2) Target customers are the business archetypes DPF serves (plumbers, restaurants, gyms, etc.); (3) DPF is both the platform and the product. Actual: Level 2 — COO knows what DPF is conceptually but doesn't contextualise the org as DPF's operator/seller. Asks "which product are you referring to" rather than answering from the org's perspective.
SEVERITY: important
CANDIDATE BI TITLE: COO loses context that org IS operating DPF — fails circular self-reference check for software-platform archetype
CANDIDATE EPIC: EP-COWORKER-KNOWLEDGE or EP-ARCHETYPE-INTELLIGENCE
UX FIT: The one archetype where the platform must recognise itself as the product fails the most basic product-knowledge question. An investor or customer asking the COO "what does your company do?" gets a confused response.
```

---

### FINDING-010

```
RUN: 0
ARCHETYPE: software-platform
INSTALL MODE: fresh-install
PHASE: K (Operator Day-to-Day) — K4 Business Health KPIs / Currency Display
OBSERVATION: Customer/Revenue page shows "£0 open" for pipeline despite attempting USD currency setup. Finance configuration shows BASE CURRENCY: USD in the config hub, but the customer module renders GBP symbol (£).
EXPECTED: Currency symbol in all revenue/pipeline views should reflect the configured base currency. If USD is set, pipeline should show $0. The inconsistency between the finance config display (USD) and the customer module display (GBP) indicates currency is partially persisted — config hub reads one source, display components read another.
SEVERITY: minor
CANDIDATE BI TITLE: Currency symbol inconsistency — customer/pipeline shows £ when finance config shows USD as base currency
CANDIDATE EPIC: EP-FINANCE-SETUP or EP-LOCALISATION
UX FIT: Operator who set up USD sees pound signs in their pipeline/revenue views. Creates confusion about what currency the business is operating in. Ties to Findings 4 and 5 (setup wizard doesn't persist currency properly).
```

---

## Summary

**10 findings accumulated. Pausing for remediation.**

| # | Severity | Phase | Title |
|---|----------|-------|-------|
| 001 | important | Seed | 10+ archetypes missing from fresh install (banking/civic/rental) |
| 002 | important | Procedural | Install at PR #1560 — 169 PRs behind origin/main |
| 003 | minor | Provider | No first-run LLM provider prompt — Docker Model Runner fallback silent |
| 004 | minor | D1 | GBP default currency — no locale detection |
| 005 | important | D/Finance | Setup wizard doesn't persist finance configuration (CONFIGURED: No) |
| 006 | minor | D/Finance | software-platform falls back to Professional Services finance profile |
| 007 | important | D/Tax | OrganizationTaxProfile not written by setup wizard |
| 008 | important | O1 | COO Level 1 on SaaS tax — no digital services VAT / Wayfair knowledge |
| 009 | important | O7 | COO circular confusion — doesn't know org IS operating DPF |
| 010 | minor | K4 | Currency symbol mismatch (£ in customer module, USD in config hub) |

**Next:** Address these 10 findings, then resume from Run 1 (plumber / Sandra Hooper).
