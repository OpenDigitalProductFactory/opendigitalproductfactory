---
status: active
---

# Localization & Multi-Currency Architecture: Research, Gap Analysis, Design

- **Status:** Design. Research and gap analysis are complete. The epic and backlog are filed.
- **Date:** 2026-09-24
- **Epic:** `EP-6B33A840`, *Localization & multi-currency architecture*. The id is reused from the 2026-08-06 draft; that epic never landed in this backlog.
- **Scope:** `platform`
- **Kernel decision ledger:**
  - `DI-ADAE8489B6A2`: the UI message layer. Absorb an owned catalog over native `Intl`, rather than adopting next-intl or translating with AI at render time. High confidence, margin 2.92.
  - `DI-685582FAB30C`: functional currency on a staged `LegalEntity` (§9.1).
  - `DI-38049EA347F8`: Arabic is the first RTL locale (§9.4).
- **Supersedes:** `docs/superpowers/specs/2026-08-06-platform-localization-infrastructure-design.md`. That draft picked next-intl, did not cover multi-currency, and had no model for external audiences or seeded content.
- **Absorbs:** the deferred Phases 2–3 of `docs/superpowers/plans/2026-07-18-org-locale-currency-spine.md`, whose Phase 1 is delivered.

---

## 1. Problem

DPF is English-only and single-currency in practice, but it is becoming a global platform. Most archetypes are local businesses, and the ones that cross country boundaries feel this first. Examples are manufacturers with plants in Mexico, nonprofits whose donors and adopters speak Spanish, and MSPs whose customers span several countries. Four needs are distinct and must not be conflated:

1. **Operators and staff** use the portal in their own language.
2. **External audiences** meet the org in *their* language: storefront visitors, donors, customers, email and PDF recipients, and people who write in to the mailroom. This is often not the operator's language.
3. **Money is correct across currencies.** A gift is stored in the currency the donor saw, books reconcile in one functional currency, and every conversion cites a rate.
4. **Each install is shaped by where it is.** Currency, languages, timezone, units, address format and week start are proposed from the org's country at onboarding.

The immediate deliverable is architecture, not translations. Today's English must run through the new architecture first: a resolver, a catalog, formatters, logical layout and a guard. After that, each region (a language, its formatting, currency and tax, and jurisdiction) is budgeted as catalog and pack work, with no platform engineering.

## 2. Goals and non-goals

**Goals**
- One `LocaleContext`, resolved per viewer or per recipient, drives language, formatting, direction, timezone, display currency and units everywhere.
- Every UI string, outbound message and seeded label reaches the screen through the catalog. English is the source catalog.
- The layout is direction-agnostic, so enabling an RTL language does not require a UI rewrite.
- Money carries its currency with ISO-4217 precision, and conversions carry rate provenance.
- A ratchet guard makes regressions impossible and makes progress visible.
- A paved "add a locale" road, with coverage gates and a per-region budget template.

**Non-goals (this epic)**
- Statutory payroll, statutory IDs and country regulatory content. These belong to the jurisdiction and multi-country HR epics (`EP-A47377D1`, `EP-6F60DB83`, `BI-50DF2A92`, `BI-9252B9EA`), which consume this infrastructure.
- Translating model-facing prompts and skills. The platform's working language stays English (§5.9).
- Choosing a TMS vendor. The supply chain is owned (§5.14); a vendor seam is evaluated only if volume demands one.

## 3. Current substrate and gap analysis (code-grounded, `origin/main` @ `99ca786beed`)

| Area | Verdict | Evidence |
|---|---|---|
| UI i18n framework | **Absent** | No i18n dependency in any `package.json`, and no `messages/` or `locales/` directory. There are 0 `t()`/`useTranslations` calls and 1,370 non-test `.tsx` files in `apps/web` with literal English (e.g. `app/not-found.tsx:93-94`). |
| `<html lang/dir>` | **Hardcoded** | `apps/web/app/layout.tsx:45` is `<html lang="en">` with no `dir`. The storefront layout sets neither. |
| Locale resolution | **Org-only** | `OrgSettings.locale` (default `"en-US"`), `baseCurrency` (`"USD"`) and `countryCode` live in `core-identity.prisma:925-938`. `resolveOrgLocale` is in `lib/org-locale/org-locale.ts`, backed by a hand-kept 30-country map. There is no viewer language, Accept-Language handling or `[locale]` routing. |
| Per-person language | **Almost absent** | The only field is `PatientProfile.preferredLanguage` (`verticals-care.prisma:13`), and nothing reads it. User, Principal, EmployeeProfile, CustomerContact and CustomerAccount have no language field. |
| Onboarding | **Country captured, not propagated** | Setup captures country in `Organization.address` JSON. `OrgSettings.countryCode` is written only by `applyOrgCountry` (`lib/actions/currency.ts:45-60`), which is called only from tax setup (`tax-remittance.ts:129`). No language is captured. `BusinessContext.operatesIn/sellsTo/employsIn` use `us/eu/uk` slugs, not ISO codes. |
| Formatting | **Fragmented** | `Intl` is used in 57 files. There are 176 `"en-GB"`/`"en-US"` literals, and at least 30 finance pages define their own local `formatMoney` in `en-GB`. Only 7 files import `@/lib/org-locale`. `datetime.ts:63` passes an `undefined` locale. The shared `formatMoney` defaults to 0 fraction digits, which drops cents on invoices. Public token pages (`s/pay`, `s/quote`) and `invoice-pdf.tsx:66` hardcode en-GB. |
| RTL readiness | **None** | About 1,023 physical-direction Tailwind classes and 0 logical ones. About 263 physical inline style properties. 0 `rtl:` variants. The font is Inter (not bundled, no Arabic or Hebrew glyphs). The theme runbook does not mention direction. Tailwind v4.3 already provides logical utilities. |
| Currency reference | **Absent** | About 45 free-string `currency` fields, defaulting to `"USD"`. There is no ISO-4217 table and no minor units. `countries.json` has no currency (`BI-BAC971B2`). |
| Multi-currency | **Stored, not used** | `ExchangeRate` and an ECB fetch exist. `convertAmount` and `calculateFxGainLoss` have 0 callers. `JournalLine` has one currency and no functional amount. The ledger falls back to `"GBP"` (`ledger-service.ts:426,517`), and 14 of 19 finance profiles default to GBP. `costUsd`-style fields have no currency column. |
| Live money defects | **Open** | `BI-3921EBF6`: donations are stored in a currency the donor never saw. `BI-685ADDCD`: the cockpit reports "Unavailable" on a mixed-currency total. |
| External comms | **English-only** | Email composers in `lib/shared/email.ts` have no language parameter and no `lang` attribute. Mailroom classify, reply and fallback are English. |
| Seeded content | **English prose in rows** | About 1,157 archetype labels, plus role, occupation and taxonomy registries (384 taxonomy rows), 87 agents, 250 English-only country names, and 59 seed scripts. |
| AI coworkers | **No response-language contract** | `lib/tak/prompt-assembler.ts` has no language input. The org locale is injected only as context. Speech-to-text already returns a detected language. |
| Address and phone | **US-shaped** | The org address picker offers only US states. There is no postal validation. `DEFAULT_PHONE_COUNTRY="US"`. Timezone derivation is by US state only. The `Region` table (4,963 rows) is underused. |
| Timezone | **Adequate base** | Storage is UTC. The org timezone is `BusinessProfile.timezone`. Per-site and per-schedule timezones exist. There is no per-user timezone. |

**Verdict:** the money and locale spine is about 40% built and correctly placed. UI and content localization is greenfield. The work is mostly **convergence**: one resolver, one formatter, one catalog, and one money invariant, applied across many surfaces that each solved part of the problem locally.

## 4. Research and benchmarking (AGENTS.md §7)

**Standards adopted**

| Standard | Used for |
|---|---|
| BCP 47 | Language tags, including the `-u-` extensions for calendar (`ca`) and numbering system (`nu`) |
| Unicode CLDR | Plural rules, formats, territory→currency/language data, first day of week |
| ISO 4217 | Currency codes and minor units |
| ISO 3166-1/-2 | Countries and subdivisions (already in `Country`/`Region`) |
| Unicode MessageFormat 2.0 | Message syntax. Stable since CLDR 47; the TC39 `Intl.MessageFormat` proposal is at stage 2. |
| W3C | `lang`/`dir` authoring guidance |
| CSS Logical Properties | Direction-agnostic layout |
| WCAG 2.2 SC 3.1.1/3.1.2 | Language of page and language of parts |

**Frameworks compared (UI copy)**

| Option | Assessment | Verdict |
|---|---|---|
| next-intl | Best App-Router fit, ICU MF1, middleware routing. Adds next-intl and intl-messageformat and retires nothing. | Rejected. Absorb-dont-adopt (commandment, w=2.0) favours owning the thin layer. |
| i18next / react-i18next | Largest ecosystem. Key-suffix plurals; heavier on RSC. | Rejected, for the same dependency reason and a worse RSC fit. |
| Lingui | Build-time extraction, `.po` workflow. | Rejected. Optimizes for a workflow DPF does not have. |
| **Owned layer over native `Intl`** | `Intl.PluralRules/NumberFormat/DateTimeFormat/RelativeTimeFormat/ListFormat/DisplayNames/Locale` already cover formatting and CLDR data in Node and browsers. DPF owns only catalog loading, key typing and an MF2 subset. | **Adopted** (`DI-ADAE8489B6A2`). There is a swap seam to native `Intl.MessageFormat` when it ships, which retires our parser. |

**Content and money models compared (ERP and commerce leaders)**

| Product | Pattern | DPF takes |
|---|---|---|
| Odoo (16+) | Translatable fields stored as a JSONB locale map in the owning row (`{"en_US": …, "fr_FR": …}`). This replaced the `ir.translation` side table to remove joins. Company currency plus a per-document currency with dated rates. | JSONB `LocalizedText` for org-authored content (§5.7). Transaction versus functional currency with dated rates (§5.10). |
| ERPNext / Frappe | Per-user language. A translation table for UI strings, and account currency versus company currency on ledger entries. | Per-user language. Functional-currency amounts on journal lines. |
| Shopify Markets / Saleor | Per-market language and presentment currency, separate from the shop's base currency. Per-model translation records (Saleor). | The **presentment currency** concept (what the payer saw) as distinct from functional currency. Saleor's per-model translation tables are rejected in favour of the Odoo JSONB pattern (one home, no joins). |

Sources:
- [Unicode CLDR 47: MessageFormat 2.0 Stable](http://blog.unicode.org/2025/03/unicode-cldr-47-release-messageformat-2.html)
- [TC39 proposal-intl-messageformat](https://github.com/tc39/proposal-intl-messageformat)
- [Odoo PR #97692: store translated fields as JSONB](https://github.com/odoo/odoo/pull/97692)
- [Odoo 16 translations docs](https://www.odoo.com/documentation/16.0/developer/howtos/translations.html)
- W3C Internationalization, "Structural markup and right-to-left text in HTML"

## 5. Architecture

### 5.1 Locale axes: kept separate on purpose

A "locale" is several independent choices. Conflating them is how today's code ended up formatting USD with en-GB grouping.

| Axis | Owner | Example |
|---|---|---|
| **Language** (UI and content) | viewer or recipient | `es-419` |
| **Format locale** (numbers, dates) | derived from language + region, overridable | `es-US` for a US org's Spanish donor |
| **Direction** | derived from the language's script | `rtl` for `ar`, `he`, `fa`, `ur` |
| **Timezone** | viewer > site > org | `America/Mexico_City` |
| **Currency** | the *document*, not the viewer | an invoice in MXN is always MXN |
| **Functional currency** | org (later, legal entity) | `USD` |
| **Measurement system** | org | metric, us, or uk |
| **Calendar / numbering system** | viewer preference via BCP-47 `-u-ca-`/`-u-nu-` | `fa` → Persian calendar |
| **Jurisdiction** | legal entity, site or worker | owned by the jurisdiction epics |

### 5.2 `LocaleContext` resolution (single source of truth)

`LocaleContext` is an extension of `lib/org-locale`, not a parallel module. It is resolved once per request or per outbound message and passed down. Nothing below it reads a locale on its own.

```
Internal viewer:    Principal.preferredLanguage → OrgSettings.defaultLanguage
                    → Accept-Language ∩ supported locales → en-US
External audience:  ?lang → cookie → CustomerContact.preferredLanguage
                    → Accept-Language ∩ OrgSettings.enabledLanguages → OrgSettings.defaultLanguage
Outbound message:   recipient.preferredLanguage → OrgSettings.defaultLanguage
```

- External audiences are only offered languages the **org has enabled**, even if the platform catalog has more.
- `dir` is derived, never stored: `new Intl.Locale(tag).maximize().script` is checked against the RTL script set {Arab, Hebr, Thaa, Syrc, Nkoo, Adlm, Rohg}.
- Root and storefront layouts render `<html lang dir>` from the context. User-generated fragments carry `dir="auto"` or `<bdi>`, which satisfies WCAG 3.1.2.

### 5.3 Reference data (absorbed as vendored data, like `countries.json`)

- **Supported-locale registry.** Each entry has a tag, script, direction, plural category set, status (`planned`, `beta`, `supported`) and coverage. It is CLDR-derived and checked in.
- **Currency authority (`BI-BAC971B2`).** ISO-4217 code, minor units (JPY 0, USD 2, BHD/KWD/TND 3), and active flag. The ~45 `currency` columns become constrained to it.
- **Territory data.** Country → currencies, official and widely spoken languages, first day of week, measurement system, and timezones. This drives instance shaping (§5.11).
- **Names come from `Intl.DisplayNames`,** not translated tables, for countries, languages, currencies and regions.

### 5.4 Message layer (owned; `DI-ADAE8489B6A2`)

- Catalogs live at `messages/<locale>/<namespace>.json`. `en` is the source of truth. A generated TypeScript key union makes an unknown key a compile error.
- The syntax is an **MF2 subset**: `{$name}`, `{$n :number}`, `{$amt :currency}`, `{$d :datetime}`, and `.match` on plural and select categories. It is implemented over `Intl.PluralRules`/`NumberFormat`/`DateTimeFormat`. MF2 is chosen over MF1 because it is the stable Unicode successor and what native `Intl.MessageFormat` will parse, so our parser can be deleted later.
- `getT(namespace)` is used in RSC and server actions. A client provider ships only the namespaces a page uses.
- The fallback chain is regional, then macro-language, then `en` (e.g. `es-MX → es-419 → es → en`). A missing key never renders blank.
- **Pseudo-locales** are generated, never authored:
  - `en-XA`: accented and 35% expanded. It catches untranslated leftovers and truncation.
  - `ar-XB`: RTL bidi pseudo. It verifies layout with zero translation spend.
- Per-org terminology overrides reuse `StorefrontArchetype.customVocabulary`, not a new store.
- It becomes a workspace package so `apps/mobile` consumes the same catalogs (`BI-59CBBBB1`; see also the mobile workspace split `BI-2FD295F3`).

### 5.5 Formatting (one module)

A single `format` surface beside `org-locale` provides `money`, `number`, `percent`, `date`, `time`, `dateRange`, `relative`, `list`, `unit` and `displayName`. Every function takes a `LocaleContext`.

- Money uses the currency's minor units by default.
- Dates are stored in UTC and rendered in the context's timezone and calendar.
- All local helpers and locale literals are deleted, not wrapped.

### 5.6 Direction and script (RTL-ready now, visually identical in LTR)

- A codemod moves physical properties to logical ones: Tailwind `ml→ms`, `text-left→text-start`, `border-l→border-s`, and inline `marginLeft→marginInlineStart`. Reviewed exceptions use `rtl:` variants.
- **Mirroring rules:**
  - Mirror navigation chevrons, back and forward controls, progress direction and drawer sides.
  - Do not mirror media playback controls, clocks, checkmarks, logos, or numbers and phone numbers (which stay LTR inside `<bdi>`).
- **Fonts:** script-aware `--dpf-font-*` stacks with self-hosted WOFF2 subsets (Noto Sans Arabic and Hebrew; Noto Nastaliq Urdu later), under OFL with attribution carried. They load only when the active script needs them.
- `docs/architecture/theme-aware-styling-runbook.md` gains a direction section, and the guard enforces logical properties.

### 5.7 Three content classes (each has one home)

| Class | Examples | Mechanism |
|---|---|---|
| **A. Platform-seeded reference** | archetype labels, roles, occupations, taxonomy, skill titles, departments | Rows carry a stable key and keep their English value as fallback. Display resolves through the `seed.*` catalog. A seed guard requires keys on new display strings. |
| **B. Org-authored, for external audiences** | storefront sections and items, tagline, policies, donation copy, email signatures | A `LocalizedText` JSONB locale map in the owning row (Odoo pattern), read through `pickLocalized(value, ctx)` with the fallback chain. Per-language status is missing, AI draft, or approved. AI drafts; a human approves; legally binding text never publishes from an unapproved draft. |
| **C. User-generated and transactional** | notes, messages, inbound mail, case records | Not translated at rest. `detectedLanguage` is recorded. On-demand translation is shown as a labelled view with provenance, never as a replacement for the original. |

### 5.8 External audiences and outbound communications

- A contact's language is set once, from the negotiated visitor locale at first contact (donation, inquiry, sign-up) or from mailroom detection. Both the contact and the operator can edit it.
- Every outbound composer takes the **recipient's** context: email (catalog namespaces `email.*`, HTML `lang`/`dir`) and PDFs (invoice, receipt, quote, in the document's transaction currency with a script-capable font).
- Where a jurisdiction requires a document language or bilingual output (Quebec, Mexican fiscal documents), the requirement is read from the jurisdiction layer. There is no hardcoded country rule.
- Public pages emit `hreflang` alternates for enabled languages.

### 5.9 AI coworkers

- The prompt assembler receives `LocaleContext`. Conversational replies use the viewer's language. Drafts addressed to an external party use the recipient's language.
- **The working language stays English:** reasoning, tool arguments, evidence, backlog and doctrine. Only user-facing output is localized, and it carries a `language` tag. This keeps governance, search and review single-language.
- Mailroom detects the inbound language, records it, and proposes it as the contact's preference.
- Statutory, legal and financial boilerplate comes only from approved catalog or `LocalizedText` sources, never from free generation.
- Language coverage becomes a capability axis in model selection. This is not provider pinning.

### 5.10 Money model

- **Currency authority:** every currency column is constrained to ISO-4217 (§5.3). Normalization of existing strings is part of the same migration. Unknown values are flagged, never guessed.
- **Three currencies:**
  - **Transaction** currency is on every money document.
  - **Functional** currency belongs to the document's `LegalEntity` (§9.1, L1.0). Each install starts with one primary entity. `OrgSettings.baseCurrency` becomes the org's presentation currency.
  - **Presentment** currency is what the payer saw. For the storefront it equals the transaction currency. Missing presentment is the root cause of `BI-3921EBF6`.
- **Posting:** `JournalLine` gains functional debit and credit, `rate`, `rateDate` and `rateSource`, taken from effective-dated `ExchangeRate` rows. If no rate exists, posting is held; the rate is never silently 1.0. Revaluation uses the already-declared `fx-revaluation` source.
- **Aggregation:** totals across currencies either convert with a cited rate or show a per-currency breakdown, never "Unavailable" (`BI-685ADDCD`).
- **Vendor-currency fields** (`costUsd`, `amountUsd`, `budgetKUsd`) stay USD because that is their source of truth. They are documented as such and converted for display with a cited rate. The cents fields gain a currency.
- **Rounding** uses currency minor units. Existing amounts are **never re-denominated** without an operator decision.

### 5.11 Instance shaping at onboarding

When the operator chooses a country, the platform **proposes** each value below from territory data. The operator confirms each one; nothing is silently applied.

| Proposed value | Examples |
|---|---|
| Functional currency | USD, MXN |
| Default operator language | en, es-MX |
| Languages enabled for external audiences | A US org is offered `en` plus `es`. A Canadian org is offered `en` plus `fr`. |
| Timezones (multi-zone countries offer all) | America/Mexico_City |
| Measurement system | metric, us |
| Week start | Monday |
| Address format and region list | from `Region` |
| Phone default | from the org country |

The business-context step calls `applyOrgCountry`, which fixes the gap in §3. The `BusinessContext` scope arrays move to ISO codes, with `EU` as a named group. Finance profiles follow the org country rather than defaulting to GBP.

### 5.12 Addresses, phones and units

- Per-country address metadata is vendored, in the libaddressinput data style with attribution. It covers field order, required fields, labels and postal regexes.
- The form renders from the metadata, and regions come from `Region`.
- Timezone derivation works by region for multi-zone countries.
- Units are displayed with `Intl.NumberFormat` `style:"unit"` according to `measurementSystem`. This ties to the mileage jurisdiction packs (`BI-1C8B56DA`).

### 5.13 Enforcement: localization ratchet guard

A repo-owned guard in the existing pregate/policy-guard family, not an eslint plugin dependency. It works like the module-size ratchet: a per-file baseline that may only shrink, and new files must be at zero. Categories:

- bare JSX text and capitalized `placeholder`/`aria-label`/`title` literals
- `"en-GB"`/`"en-US"` literals and `toLocale*` without a context
- physical-direction classes and inline styles
- `$`-prefixed money templates
- seed display strings without keys

The baseline counts in §3 are the starting point. Progress is the counts reaching zero.

### 5.14 Translation supply chain and the "add a locale" road

1. **Scaffold** the locale: create the catalogs, register it as `planned`, and wire it into the pseudo checks.
2. **AI draft.** A coworker drafts from the English catalog plus key context (route, description, maximum length) and a glossary.
3. **Human review.** A named language reviewer approves each namespace. Approvals are recorded as evidence.
4. **Coverage.** Coverage is reported per locale, namespace and tier-1 surface.
5. **Activation gate:** tiered by namespace. Only reviewed strings count. The thresholds are in §9.3.
6. **Delivery process.** A new string ships in `en` only, and missing translations queue automatically. The English PR is never blocked. This extends documentation-impact discipline; it is not a new gate.

**Per-region budget template** (what "add region X" costs):

| Line | Contents |
|---|---|
| Language catalog | By tier |
| Formatting QA | Numbers, dates, units |
| Currency and tax pack | |
| Jurisdiction pack | Owned elsewhere |
| Font and RTL QA | If applicable |
| Legal review | Statutory copy |
| Support readiness | |

## 6. Language tiers

### 6.1 Spanish (first; `BI-8D832CF1`)

- One **neutral Latin American base (`es-419`)**, plus thin regional overlays (`es-MX`, `es-US`, later `es-ES`) for keys that genuinely differ: vocabulary, formality, and legal terms.
- The format locale is independent of language:
  - A US rescue shows `es` copy with USD formatted in `es-US`.
  - A Mexican plant uses `es-MX` with MXN.
- **Tier-1 surfaces:** storefront and donation, outbound mail and PDFs, setup, People self-service and pay.
- Statutory HR terms come from the multi-country HR glossary.

### 6.2 RTL languages (scoped; `BI-4FDFE20C`)

| Language | Plural categories | Digits | Calendar display | Font | Notes |
|---|---|---|---|---|---|
| Arabic `ar` (+regional) | 6 | Latin or Arabic-Indic by region/preference (`-u-nu-`) | Gregorian; Hijri optional (`-u-ca-islamic-umalqura`) | Noto Sans Arabic | Largest reach; regional variants matter |
| Hebrew `he` | 3–4 (incl. two) | Latin | Gregorian; Hebrew optional | Noto Sans Hebrew | |
| Persian `fa` | 2 | Persian | Solar Hijri expected default (`-u-ca-persian`) | Noto Sans Arabic | Week starts Saturday |
| Urdu `ur` | 2 | Latin or Extended Arabic-Indic | Gregorian | Noto Nastaliq Urdu | Taller line height; heaviest shaping |
| Pashto, Sorani, Dhivehi, Yiddish | — | — | — | registry and font entries only | Budget on demand |

Cross-cutting RTL checks:
- mixed-direction input (`dir="auto"`)
- mirroring exceptions
- email-client RTL
- **PDF shaping in `@react-pdf/renderer` is unverified.** It may need the dpf-doctools engine instead.
- mobile `I18nManager`

Storage always stays Gregorian UTC.

### 6.3 Other scripts (note only)

- **CJK:** font size, no word spacing, line breaking, IME input.
- **Indic:** complex shaping.
- **German and Finnish:** text expansion of 30–40%, which `en-XA` already stresses.

## 7. Phasing and backlog (`EP-6B33A840`)

**Phase 0: English runs through the new architecture (no translation spend)**

| Id | BI | Item |
|---|---|---|
| L0.1 | `BI-6EA9E25A` | `LocaleContext` resolver, locale registry, `<html lang dir>`, Principal language and timezone |
| L0.2 | `BI-9A44B227` | Owned message layer, MF2 subset, pseudo-locales |
| L0.3 | `BI-4690CB37` | Localization ratchet guard |
| L0.4 | `BI-550E039F` | Externalize English into `en`, in waves W1–W6 |
| L0.5 | `BI-EE2859C5` | One formatting module; retire local helpers and literals |
| L0.6 | `BI-DE9974F2` | Logical layout, mirroring, bidi, script fonts |
| L0.7 | `BI-6982F7D9` | Onboarding shapes the instance; fix the country propagation gap |

**Phase 1: money correct across currencies**

| Id | BI | Item |
|---|---|---|
| L1.0 | `BI-9BD41BE1` | `LegalEntity` (one primary per install); functional currency, tax profile and ledger scoped to it |
| L1.1 | `BI-BAC971B2` | ISO-4217 authority with minor units (existing, linked) |
| L1.2 | `BI-AEB08F6B` | Transaction, functional and presentment currency; functional journal amounts; rate provenance |

**Phase 2: external audiences**

| Id | BI | Item |
|---|---|---|
| L2.1 | `BI-56ECBA05` | Contact and visitor language, negotiation, switcher |
| L2.2 | `BI-41868A8E` | `LocalizedText` org content, AI draft plus human approval |
| L2.3 | `BI-6E1BAA84` | Outbound mail and PDFs in recipient language and currency |
| L2.4 | `BI-B6D0AEA3` | Seeded reference content keyed, `Intl.DisplayNames` |
| L2.5 | `BI-6B8FD916` | Language-aware coworkers and mailroom |

**Phase 3: budgeted rollout**

| Id | BI | Item |
|---|---|---|
| L3.1 | `BI-344F6DA6` | Add-a-locale road, supply chain, activation gate, budget template |
| L3.2 | `BI-8D832CF1` | Spanish (es-419 + es-MX/es-US) |
| L3.3 | `BI-4FDFE20C` | RTL pack: Arabic first (§9.4), PDF shaping spike, budget sheets |
| L3.4 | `BI-3CD41DCA` | Addresses, phones, units per country |
| L3.5 | `BI-59CBBBB1` | Mobile shares catalogs and RTL |

**Related, owned elsewhere:**
- `BI-3921EBF6` and `BI-685ADDCD`: donation currency, under `EP-5102F494`. They are fixed structurally by L1.2 and tactically in their own epic.
- `BI-1C8B56DA`: mileage and units.
- `BI-4EC1D572`: market footprint "language fit" layer. It reads the locale registry's status.
- `BI-50DF2A92`, `EP-A47377D1`, `EP-6F60DB83`: jurisdiction.
- `BI-9D4A5D22` (BET-9, `EP-8DC217EB`): the canonical Money convention. L1.0 and L1.2 coordinate with it, so there is one convention.
- `BI-4D1139DA`: the legal-entity admin surface. L1.0 absorbs it.

**Order:** L0.1 → L0.2 → L0.3 → L0.5 → L0.6 → L0.7 → L0.4 waves (continuous) → L1 → L2 → L3.

L0.1 through L0.3 are the "core design up front" slice. Once they land, every new feature is authored localizable by default, and the guard stops the English-only debt from growing.

## 8. Risks and mitigations

- **Guard-storm on day one.** Use a baseline ratchet, not a hard ban. New files start at zero.
- **Silent money change.** No migration re-denominates an amount. Currency normalization flags unknowns for the operator.
- **Machine translation of legal text.** Approval is gated, and legally binding content cannot publish from a draft.
- **Server/client bundle bloat.** Namespace-scoped client loading; the server loads by default.
- **Seed drift.** Rows keep their English fallback, and the seed guard requires keys.
- **RTL regressions after the codemod.** Use the `ar-XB` visual check on sampled routes, plus the guard.
- **Our MF2 subset diverges from the standard.** Keep a conformance test subset taken from the Unicode MF2 test suite, and swap to native `Intl.MessageFormat` when it is available.

## 9. Resolved decisions (2026-09-25)

These were the four open questions. Each one was researched against the relevant standards, comparable products and live DPF substrate. Q1 and Q4 were also scored through WWMD.

### 9.1 Functional currency belongs to a legal entity, introduced in stages (`DI-685582FAB30C`, high, margin 2.65)

**Evidence**
- IAS 21 and ASC 830 both define functional currency **per reporting entity**. Presentation currency is a separate choice. Translating a foreign operation creates a translation reserve (CTA) held in equity.
- Odoo (`res.company.currency_id`), ERPNext (company currency), NetSuite OneWorld (subsidiary base currency plus consolidated exchange rates) and Business Central (per-company local currency plus a consolidation company) all scope currency to the entity, never to the database.
- A Mexican plant keeps books in Spanish and in MXN (SAT electronic accounting, RCFF Art. 33), so it is its own entity. A US nonprofit with no foreign entity needs only one entity and remeasures foreign transactions (ASC 830-20).
- DPF today has no `LegalEntity`. `Organization` is the install (install-is-the-tenant, pending ratification). `LedgerAccount` is unique per org. Yet the Mexico payroll backlog already assumes per-entity MXN.

**Decision**
- **Stage 0 (L1.0, `BI-9BD41BE1`):**
  - Add `LegalEntity`, with exactly one primary entity per install seeded from `OrgSettings`.
  - Functional currency lives on the entity and is locked after the first posting.
  - Ledger, fiscal periods, `OrganizationTaxProfile` and `TaxRegistration` are scoped by `legalEntityId`.
  - `OrgSettings.baseCurrency` becomes the org presentation currency, the only org-level currency.
  - No behaviour changes for one-entity installs.
- **Stage 1:** a second entity with its own books.
- **Stage 2:** consolidation (closing, average and historical rates; a CTA account; intercompany eliminations).
- **Rejected:** org-level-only, because it cannot represent a Mexican subsidiary; and full multi-entity now, because the blast radius and effort are too large for today's demand.

### 9.2 External languages are suggested by country, never auto-enabled

**Evidence**
- CLDR `territoryInfo` (Unicode-3.0 licence) gives each country's languages with `populationPercent` and `officialStatus`. It exists precisely to say which languages are useful where.
- Comparable products (Shopify Markets, Wix, Odoo) leave language choice fully manual, so suggestions add value.
- Legal drivers vary by place:
  - Quebec: the Charter of the French Language / Bill 96 requires French at parity.
  - US healthcare: Section 1557 (2024 rule) requires a language-assistance notice in the state's top 15 languages.
  - EU: member states set their own consumer-language rules.
- Risks of auto-enabling: half-translated pages, customers writing in languages staff cannot answer, and machine-translated binding terms.

**Decision (L0.7 `BI-6982F7D9`, L2.1 `BI-56ECBA05`)**
- **Suggest** every official or de facto official language, plus any language at **≥ 5%** of the population.
  - Regional-official languages are suggested by region.
  - Dialect codes are folded into their written language or dropped.
  - Only languages with a DPF locale entry are offered.
- **Why 5%:** it keeps US Spanish (9.6%), Mexican English (13%), Israeli Russian (11%) and UAE Malayalam (7%). It drops long tails around 3% that a small org cannot staff.
- **Flag required languages** from the jurisdiction layer: Quebec French, the US-healthcare 1557 notice, and national languages where required.
- **Never auto-enable.** Enabling needs:
  - the L3.1 T1 gate
  - reviewed legal text
  - a named person who can respond in that language
- **Optional later refinement:** US county-level ACS data (table C16001).

**Expected suggestions**

| Country | Suggested languages |
|---|---|
| US | en + es |
| CA (Quebec) | fr (required) + en |
| CA (elsewhere) | en + fr |
| MX | es + en |
| BE | nl, fr or de by region, + en |
| CH | de, fr, it + en |
| IL | he, ar, en, ru |
| AE | ar, en, ml |

### 9.3 Activation thresholds are tiered by namespace; only reviewed strings count

**Evidence**

| Project | Threshold |
|---|---|
| WordPress core | front-end ≥ 90%, admin ≥ 75% |
| WordPress plugin/theme packs | ≥ 90% |
| KDE | about 90% frameworks, 75% workspace |
| GNOME | "supported" at ≥ 80% |
| Firefox | Nightly at ≥ 30%; Release needs 4- and 5-star strings at ~100% plus active reviewers |
| translatewiki | export at about 13% |
| Microsoft Language Interface Packs | partial UI, with parent-language fallback |
| ISO 18587 | defines full post-editing of machine translation |

UX guidance says mixed-language screens are tolerable in low-stakes UI and damaging at payment, consent and failure moments.

**Decision (L3.1 `BI-344F6DA6`)**

| Tier | Namespaces | Beta | Supported | Per-key fallback |
|---|---|---|---|---|
| **T1** legal, money, outbound | terms and consents, prices, invoices, payments, receipts, outbound email/SMS/PDF, account security | 100% reviewed, or the flow stays whole in English with a notice | 100%, native review to ISO 18587 full post-edit; legal text also reviewed for the jurisdiction | **Never.** Whole-flow English fallback |
| **T2** external-facing UI | storefront, portal, public forms, customer-visible errors | ≥ 60% plus 100% of critical-path keys | ≥ 90%, native review | Allowed, except critical-path keys |
| **T3** internal UI | back office, settings, reports | ≥ 30% | ≥ 80% | Allowed, with a notice |

**Gates**
- **Planned → beta:** a named native reviewer, and the T1 flows done or hidden. The locale is labelled "Beta".
- **Beta → supported:** every tier at its supported bar, a reviewer plus a backup, and one clean release cycle.
- **Regression:**
  - T1 below 100% forces whole-flow English for that flow.
  - T2 or T3 below the supported bar for more than one release demotes the locale to beta.
- Unreviewed AI drafts never count toward "supported".

This replaces the earlier proposal of 100% on tier 1 and 95% elsewhere. A single 95% bar was stricter than any precedent for internal UI, and less specific than the precedents for critical paths.

### 9.4 Arabic is the first RTL locale; Urdu second (`DI-38049EA347F8`, high, margin 1.59)

**Evidence** (scored 1–5 on reach, market fit, legal risk, technical de-risking and US-diaspora demand)

| Language | Total | Rationale |
|---|---|---|
| Arabic | 25 | About 480M speakers. 1.39M US home speakers (ACS). On several state Section 1557 top-15 lists. GCC data-residency law (Saudi PDPL enforced since 2024-09; UAE due 2027-01) favours self-hosted software. Hardest mainstream case (6 plurals, shaping, two digit systems, Hijri), so it de-risks the rest. |
| Urdu | 18 | 246M speakers, 508k in the US. Reuses the Arabic script work. |
| Persian | 13 | OFAC Iran sanctions cloud the market (GL D-2 does not cover a business back office). Ship only after sanctions screening exists. |
| Hebrew | 11 | Proves direction flipping only. Least demand. Cheap to add at any time. |

**Decision (L3.3 `BI-4FDFE20C`)**
- **Base locale:** `ar`, Modern Standard Arabic. Regional files (ar-SA, ar-EG, ar-AE) carry formats only.
- **Digits:** Latin by default via `ar-u-nu-latn`, because CLDR's bare `ar` defaults to Arabic-Indic digits. Arabic-Indic digits are a user preference.
- **Calendar:** Gregorian by default, with Hijri (`-u-ca-islamic-umalqura`) as a display option.
- **Font:** Noto Sans Arabic.
- **Urdu** ships second, in Naskh first, with Nastaliq later.
- **Blocking spike before committing Arabic:** `@react-pdf/renderer` has known Arabic shaping and RTL issues (#2638, #3007, #1636, #1571).
  - Prove the path first: a registered Noto font plus bidi control marks.
  - If it fails, route RTL PDFs through a headless-browser or dpf-doctools renderer.

**Sources**
- [IFRS IAS 21](https://www.ifrs.org/issued-standards/list-of-standards/ias-21-the-effects-of-changes-in-foreign-exchange-rates/)
- [PwC ASC 830](https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/foreign_currency/foreign_currency__2_US/chapter_1_framework__US/13_framework_for_the_US.html)
- [Odoo multi-currency](https://www.odoo.com/documentation/18.0/applications/finance/accounting/get_started/multi_currency.html)
- [NetSuite consolidated rates](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4847555414.html)
- [SAT Art. 33](https://sat.gob.mx/articulo/52512/articulo-33)
- [CLDR territory-language chart](https://www.unicode.org/cldr/charts/48/supplemental/territory_language_information.html)
- [HHS 1557 taglines FAQ](https://www.hhs.gov/civil-rights/for-individuals/section-1557/1557faqs/aggregation_tagline/index.html)
- [McCarthy Tétrault on Bill 96](https://www.mccarthy.ca/en/insights/blogs/consumer-markets-perspectives/french-language-requirements-bill-96-and-june-1-2025-common-misconceptions)
- [WordPress Polyglots FAQ](https://make.wordpress.org/polyglots/handbook/frequently-asked-questions/)
- [Firefox release locales](https://mozilla-l10n.github.io/documentation/products/firefox_desktop/adding_release.html)
- [KDE l10n](https://l10n.kde.org/docs/translation-howto/gui-todo-lists.html)
- [ISO 18587](https://www.iso.org/standard/62970.html)
- [Saudi PDPL transfers (Dentons)](https://www.dentons.com/en/insights/alerts/2025/may/15/saudi-arabias-framework-for-cross-border-data-transfers)
- [OFAC GL D-2](https://www.federalregister.gov/documents/2022/10/13/2022-22233/publication-of-iranian-transactions-and-sanctions-regulations-web-general-license-d-2)
- [react-pdf #3007](https://github.com/diegomura/react-pdf/issues/3007)

## 10. Superseded and absorbed

- `2026-08-06-platform-localization-infrastructure-design.md` is superseded by this document. Its epic id is reused. Its eight BI ids never landed in this backlog. Their scope maps to L0.2 (framework), L0.4 (externalize), L0.5 (formatting), L0.3 (guard), L3.1 (coverage, process, paved road) and L3.2 (Spanish).
- `2026-07-18-org-locale-currency-spine.md`: Phase 1 is delivered and kept. Phase 2 moves to L0.5, and Phase 3 (re-denomination) moves to L1.2 under the "never silently" rule.
