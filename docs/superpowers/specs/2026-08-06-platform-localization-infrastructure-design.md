# Platform Localization Infrastructure — Design & Research

- **Status:** Draft (research + planning) — 2026-08-06
- **Epic:** `EP-6B33A840` — *Platform Localization Infrastructure — language-agnostic surfaces, an all-surface localization process, and incremental locale migration*
- **Scope:** `platform`
- **Kernel decision ledger:** `DI-B1874796EB16` (epic/altitude structure → new platform epic, high confidence)
- **Predecessor work absorbed / consolidated:** `EP-ORG-LOCALE-CURRENCY` (`BI-0530BB74`), the i18n-framework half of `EP-MULTICOUNTRY-HR` (`BI-7E54AA3A`), and `docs/superpowers/plans/2026-07-18-org-locale-currency-spine.md` (currency/locale spine, kernel ledger `DI-92BCDA20FB94`).
- **Driving customer:** the Mexico manufacturer (Infinitum, Austin OEM with Tijuana + Coahuila plants) — first concrete locale is Spanish (`es-MX`) + Mexican pesos (`MXN`). The mechanism is language-agnostic; Mexico is the first migration, not the design center.

---

## 1. Problem

DPF renders every surface in hardcoded English and has no way to present the platform in another language. A Mexican plant workforce cannot read the People, onboarding, or pay surfaces in Spanish. Separately, money/date/number formatting is only partially derived from the org's locale — a mature org-locale/currency **spine exists** but its adoption across surfaces is incomplete and ~67 files still hardcode `en-GB` formatting.

The request has three sequential parts, and the platform is at very different maturity on each:

1. **Refactor to handle localization in any language** — make every surface language-agnostic (externalize copy, resolve a locale, derive all formatting from it). *UI-copy i18n is greenfield; the money/locale spine is ~60% built.*
2. **A repeatable process to localize across all surfaces** — so that when a feature ships in English, its strings are externalized and queued for translation, and the codebase can't silently regress. *Entirely missing.*
3. **Incrementally migrate to new languages** — add locales one at a time over time, Spanish first. *A large upfront cost that lowers the marginal cost of every subsequent language.*

## 2. Goals / Non-goals

**Goals**
- A single, standards-based i18n framework wired into the App Router, with a per-user + per-org + request locale-resolution chain and a fallback to `en-US`.
- Every user-facing string extracted into an `en` base catalog that is the source of truth; all money/date/number formatting derived from the resolved locale.
- A CI guard + coverage reporting that make un-localized copy a build-time defect, not a manual review catch.
- A paved road that reduces adding the *N+1*-th language to catalog authoring + QA, with no framework or plumbing work.
- Ship `es-MX` as the first migrated locale on the surfaces the Mexican workforce touches.

**Non-goals (this epic)**
- Mexican statutory payroll, statutory IDs (RFC/CURP/NSS), and per-entity multi-currency payroll — those remain in `EP-MULTICOUNTRY-HR` (`BI-FF176A24`, `BI-390B2EBB`, `BI-6770ADCD`) and *consume* this infrastructure.
- Machine-translation quality tooling / TMS vendor selection beyond a thin adapter seam (evaluated later via the `tool-evaluation` skill).
- RTL (right-to-left) layout — designed-for but not delivered until a RTL locale is scheduled.

## 3. Current substrate (code-grounded, 2026-08-06)

| Area | Verdict | Evidence |
|---|---|---|
| UI i18n framework | **ABSENT (greenfield)** | No `next-intl`/`i18next`/`react-intl`/`@lingui` dep in `apps/web/package.json`; no `locales/`/`messages/`/`i18n/` dir; no `[locale]` route; no `useTranslation`. Hardcoded English is universal (e.g. `apps/web/lib/actions/setup-constants.ts:40`). |
| Locale plumbing | **EXISTS, org-scoped, maturing** | `apps/web/lib/org-locale/org-locale.ts:143` `resolveOrgLocale(db)`; `OrgSettings.locale @default("en-US")` + `countryCode` (`schema.prisma:12836`). **No per-user locale, no `Accept-Language` negotiation, no `[locale]` routing.** |
| Currency | **EXISTS, moderate** | `OrgSettings.baseCurrency @default("USD")` (`schema.prisma:12835`); `formatMoney` (`org-locale.ts:95`, imported by 58 files); multi-currency `ExchangeRate` (`schema.prisma:12800`) + `currency.ts` FX. |
| Date/number formatting | **PARTIAL** | Central TZ-aware `datetime.ts` **but passes `undefined` locale** (`datetime.ts:63`) — not org-locale-aware. No central number formatter. `en-GB` literals in ~67 files (e.g. `finance.ts:756`). |
| Country/region/timezone | **EXISTS, mature** | `Country/Region/City` (`schema.prisma:608`); `homeCountryCode` capture in onboarding; timezone `@default("UTC")` pervasive. Locale codes live only in a hardcoded 30-entry map in `org-locale.ts`. |
| Specs/plans | **PARTIAL** | `plans/2026-07-18-org-locale-currency-spine.md` delivered Phase 1; Phase 2 (adopt formatter across ~40 surfaces) + Phase 3 (re-denomination) deferred. **No UI-i18n design doc exists — this is it.** |

**Load-bearing distinction:** build on `org-locale.ts` + `OrgSettings` + `Country`/timezone substrate and *finish* the deferred formatter adoption; treat **UI-copy internationalization as net-new**.

## 4. Research & Benchmarking (AGENTS.md §7)

Standards adopted: **BCP-47** language tags (`es-MX`, `en-US`), **Unicode CLDR** locale data, **ICU MessageFormat** for pluralization/gender/interpolation.

**Framework comparison (React/Next.js App Router, 2026):**

| Option | Fit | Verdict |
|---|---|---|
| **next-intl** | Purpose-built for the Next.js App Router; native React Server Component support, middleware-based locale detection, route integration, ICU MessageFormat, typed message keys. ~1.8M weekly npm downloads, steepest growth curve tracking App Router adoption. | **Adopt.** Best App-Router fit; ICU aligns with CLDR; least glue code. |
| react-i18next / next-i18next | Framework-agnostic, largest ecosystem (~8.9M weekly), but heavier on the App Router (layers multiple libs) and key-suffix plural format (`key_one`/`key_other`) rather than inline ICU. | Reject for this app — heavier and less RSC-native; would be the pick only if we needed cross-framework reuse. |
| Lingui | Build-time extraction, unused messages never shipped, `.po` pipeline. | Reject — optimizes for a `.po`/build-extraction workflow we don't have; next-intl's runtime model is simpler for our catalog scale. |

**Enforcement / tooling:** `eslint-plugin-i18next` / `eslint-plugin-i18n-text` (disallow English string literals in JSX, fail CI on non-zero) + an extraction/coverage CLI (i18next-cli class) for translation-status reporting. These make un-localized copy a build-time defect and produce per-locale coverage.

Sources: [next-intl vs react-i18next vs Lingui (2026)](https://blog.codercops.com/blog/react-app-i18n-2026), [i18nexus i18next vs next-intl](https://i18nexus.com/posts/i18next-vs-next-intl), [eslint-plugin-i18next](https://github.com/edvardchen/eslint-plugin-i18next), [i18next-cli](https://github.com/i18next/i18next-cli).

## 5. Proposed architecture

### 5.1 Locale resolution chain (single source of truth)

Resolve the *active locale* per request in priority order, then thread it through both copy lookup and formatting:

```
per-user preferredLocale  →  OrgSettings.locale  →  Accept-Language (negotiated against available locales)  →  en-US
```

- Extend the existing org spine (`resolveOrgLocale`) rather than parallel it — add a per-user `preferredLocale` (new column on the user/principal) and a request-context resolver that layers user > org > header > default.
- The resolved locale drives (a) next-intl message lookup and (b) the formatters. `datetime.ts` (`:63`) and a new central number formatter must consume the resolved locale instead of `undefined`.

### 5.2 Catalog model

- `en` is the base catalog and the source of truth; keys are authored in code as ICU messages.
- Non-`en` catalogs are overlays; a missing key falls back cleanly to `en` (no empty render, ever).
- Namespaced by surface (People, onboarding, finance, storefront, admin) to keep bundles lean and translation batches shippable.

### 5.3 Three phases (map to backlog)

**Phase 1 — Language-agnostic refactor (infrastructure)**
1. Adopt next-intl + locale-resolution plumbing (per-user + request negotiation, `en` scaffold, middleware, typed keys). *(narrowed from `BI-7E54AA3A`)*
2. Externalize all hardcoded UI copy into the `en` base catalog across existing surfaces. *(net-new — the large mechanical refactor)*
3. Derive **all** money/date/number formatting from the resolved locale: finish the deferred spine adoption across the ~40/67 residual surfaces, thread the locale into `datetime.ts`, add a central number formatter, complete existing-data re-denomination. *(repointed `BI-0530BB74` + its 2026-07-18 plan)*

**Phase 2 — All-surface process + enforcement**
4. CI guard failing on new hardcoded user-facing strings (eslint-plugin-i18next / i18n-text). **Dry-run repo-wide first** and baseline-allow pre-existing strings until (2) lands, to avoid a guard that fires thousands of times on day one.
5. Translation coverage + missing-key reporting surface + a **pseudo-locale** (`en-XA`-style) that visually flags any string that escaped externalization.
6. Weave a localization step into the dev process: *feature ships English → strings externalized → queued for translation* — as an extension of the documentation-impact discipline, integrated with `EP-PROCESS-SPINE`.

**Phase 3 — Incremental locale migration**
7. An "add a locale" paved road: scaffold a catalog, source + QA translations, coverage-gate, and activate the locale in setup + org settings + the per-user picker. Optionally promote the 30-entry code map to a DB-backed locale catalog.
8. Author the `es-MX` Spanish catalog for the highest-traffic surfaces (People/employee, onboarding, pay) as the first concrete migration. *(split from `BI-7E54AA3A`)*

### 5.4 Economics

Phases 1–2 are the big upfront cost; they are paid once. Phase 3 is repeatable and cheap: each new language becomes catalog authoring + QA against an already-instrumented codebase, which is exactly the "high upfront, lower over time" shape the request calls for. The Phase-2 guard is what protects the investment — without it, every new English feature silently re-introduces un-localized surface.

## 6. Backlog decomposition

Epic `EP-6B33A840` (platform). Two BIs are consolidated in (repointed/narrowed), six are net-new. Mexico packs stay in `EP-MULTICOUNTRY-HR` and depend on this epic.

| BI | Title | Phase | Disposition |
|---|---|---|---|
| `BI-7E54AA3A` | i18n framework + locale-resolution plumbing (next-intl, ICU, per-user + request negotiation) | 1 | **narrowed + repointed** (Spanish split off) |
| `BI-156058AA` | Externalize all hardcoded UI copy into the `en` base catalog across every surface | 1 | net-new (xlarge) |
| `BI-0530BB74` | Derive all money/date/number formatting from the resolved locale (finish spine adoption, thread `datetime.ts`, central number formatter, re-denomination) | 1 | **repointed** |
| `BI-520958A8` | CI guard against new hardcoded user-facing strings (dry-run first, baseline-allow) | 2 | net-new |
| `BI-90813F65` | Translation coverage + missing-key reporting + pseudo-locale QA | 2 | net-new |
| `BI-5DEAC272` | Localization dev-process step: feature-ships-English → externalize → queue-for-translation | 2 | net-new |
| `BI-AC01D10D` | "Add a locale" paved road / migration engine | 3 | net-new |
| `BI-F05DD74D` | `es-MX` Spanish catalog authoring (first migrated locale) | 3 | net-new (split from `BI-7E54AA3A`) |

`EP-ORG-LOCALE-CURRENCY` is absorbed (its sole BI repointed); the epic is closed/superseded with a pointer here.

## 7. Risks & mitigations

- **Guard-storm on day one** — a hardcoded-string lint fired against a fully-English codebase produces thousands of hits. *Mitigation:* dry-run repo-wide, baseline-allow existing, gate only new/changed lines until the externalization sweep lands.
- **Formatting drift** — 67 files still hardcode `en-GB`. *Mitigation:* the same guard class catches `toLocaleString("en-GB")` literals; the number-formatter helper gives a single migration target.
- **Translation quality for statutory/HR copy** — legal terms (aguinaldo, IMSS) must not be machine-translated blindly. *Mitigation:* human QA gate in the Phase-3 paved road; the payroll pack owns its own domain glossary.
- **RSC/client boundary** — next-intl handles both, but message loading must respect the server/client split. *Mitigation:* namespace by surface; load server-side by default.

## 8. Open questions (for founder ratification where noted)

1. **Per-user vs per-org locale precedence** — proposed user > org > header > `en-US`. (WWMD-scoreable; defaulting to user-first.)
2. **DB-backed locale catalog vs code map** — proposed: keep the code map for Phase 1, promote to data in Phase 3 only if org-configurable locales are needed.
3. **Translation sourcing** — human, machine-with-review, or TMS vendor — deferred to a `tool-evaluation` at Phase 3; thin adapter seam kept in Phase 1.

---

*Grounds in: `apps/web/lib/org-locale/org-locale.ts`, `docs/superpowers/plans/2026-07-18-org-locale-currency-spine.md`, `EP-MULTICOUNTRY-HR`, `EP-PROCESS-SPINE`. Kernel ledger `DI-B1874796EB16`.*
