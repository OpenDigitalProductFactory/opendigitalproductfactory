---
status: active
---

# Localization foundation design (L0.1–L0.3)

This is the canonical design for the first localization slice.

| | |
|---|---|
| **Epic** | `EP-6B33A840` |
| **Items** | `BI-6EA9E25A` (L0.1), `BI-9A44B227` (L0.2), `BI-4690CB37` (L0.3) |
| **Parent architecture** | `docs/superpowers/specs/2026-09-24-localization-and-multi-currency-architecture-design.md` §5.1–5.4, §5.13. That spec holds the full gap analysis and research. This document narrows it to what these three items build. |
| **Plan** | `docs/superpowers/plans/2026-09-25-localization-foundation-l0-1-to-l0-3.md` (steps, files, verification) |
| **Decision** | `DI-ADAE8489B6A2`: an owned catalog over native `Intl`, not next-intl |

## Problem

- **Everything is fixed to English.** The root layout hard-codes `<html lang="en">` and sets no `dir` (`apps/web/app/layout.tsx:45`). All UI copy is English literals in JSX. There is no per-viewer locale; only the org-level `OrgSettings.locale` exists.
- **There is no guard against more English-only code.** Every new screen adds English literals, physical left/right styling and hardcoded locales. The measured baseline is about 1,023 physical-direction classes, 176 hardcoded `"en-GB"`/`"en-US"` literals and 25 `$`-prefixed money templates.
- **Translation cannot start yet.** No language can be added, and no screen can be proven ready for translation or right-to-left (RTL), until there is a locale resolver, a catalog, and a guard against regression.

## Objectives

**OBJ-LOCALE-RESOLVE:** Every page renders the viewer's language and text direction from one resolver. Staff can choose their language and timezone.

**OBJ-CATALOG:** UI copy has one owned, typed home with an English source. Missing translations fall back per key and never render blank.

**OBJ-PSEUDO:** Any screen can be checked for translation and RTL readiness with generated pseudo-locales, at zero translation cost.

**OBJ-NO-REGRESSION:** English-only and direction-bound debt can only shrink.

**OBJ-ENGLISH-UNCHANGED:** English output for existing users is unchanged. The only intended difference is `lang="en"` becoming `lang="en-US"`.

## Design

### Locale model and resolution (L0.1)

- **Where the code lives.** A new workspace package, `packages/i18n` (`@dpf/i18n`), holds everything framework-free:
  - the supported-locale registry: tag, script, direction, plural categories, and a status of `supported`, `pseudo` or `planned`
  - Accept-Language negotiation (RFC 4647 lookup against `supported` locales, falling back through the macro-language, e.g. `es-MX` → `es-419` → `es`)
  - direction derivation

  The package has no npm dependencies, and `apps/mobile` can consume it later. Next.js bindings stay in `apps/web/lib/i18n`, and the org spine stays in `apps/web/lib/org-locale`.
- **Direction is derived, never stored.** It comes from `new Intl.Locale(tag).maximize().script`, checked against {Arab, Hebr, Thaa, Syrc, Nkoo, Adlm, Rohg}.
- **Resolution order for internal viewers** (first match wins):
  1. the admin-only preview cookie `dpf-locale`
  2. `Principal.preferredLanguage`
  3. the org default language
  4. `Accept-Language`, negotiated against the `supported` locales
  5. `en-US`

  The result is `LocaleContext { language, formatLocale, dir, timeZone, displayCurrency, measurementSystem }`. The currency comes from the existing `orgCurrencyFromSettings`. Nothing is added to `proxy.ts`. The server resolves once per request, under React `cache`.
- **Preferences.** Two nullable columns on `Principal`: `preferredLanguage` and `timeZone`, added in an additive migration with no backfill. The cookie follows the existing `dpf-nav-mode` precedent.
- **Layouts.** The root layout becomes `async` and renders `<html lang dir>`. The storefront layout renders `lang` and `dir` from the org default; the visitor chain is L2.1, which is out of scope here.

### Message catalog (L0.2)

- **Catalog files.** Catalogs live at `packages/i18n/messages/<locale>/<namespace>.json`, with `en-US` as the source of truth.
- **Typed keys without a generator.** The key union is inferred from the `en-US` JSON type through a recursive `Paths<T>`, so an unknown key is a compile error and there is no build-time artifact.
- **Message syntax.** A strict subset of Unicode MessageFormat 2.0:
  - placeholders `{$x}`
  - the functions `:number`, `:integer`, `:currency`, `:datetime`, `:date` and `:time`
  - `.input` and `.match` on plural categories (via `Intl.PluralRules`) or exact keys, with `*` as the fallback

  Anything outside the subset is rejected at catalog load. A vendored subset of the Unicode MF2 conformance tests pins behaviour. Native `Intl.MessageFormat` replaces the parser once it ships.
- **Lookup.** Keys fall back per key through the regional, then macro-language, then `en-US` catalogs. A key missing everywhere renders the key itself and warns in development.
- **Pseudo-locales.** These are generated, never authored, and both preserve placeholders:
  - `en-XA`: accents the text, pads it by 35%, and wraps it in brackets
  - `ar-XB`: wraps the text in U+202E…U+202C, with an RTL direction
- **Bindings.**
  - `getT(namespace)` for server components and server actions
  - `<MessagesProvider>` in the root layout, which ships only the namespaces a subtree declares
  - `useT(namespace)` for client components
- **Pilots.**
  - `app/not-found.tsx`: 10 strings, a client component
  - `lib/actions/setup-constants.ts` `STEP_LABELS`: 12 strings, rendered by three consumers

### Ratchet guard (L0.3)

- **Guard and baseline.** `scripts/check-no-unlocalized-ui.mjs` joins the auto-discovered `check-no-*` family (`scripts/check-guards.mjs`). Its baseline is `scripts/unlocalized-ui-baseline.txt` (`path⇥category⇥count`), created with a budget header: owner `platform-architecture`, expiry `2027-03-31`.
- **What it counts** in `apps/web/{app,components,lib}` and `packages/*/src`, excluding tests, generated files and `packages/i18n`:

  | Category | Matches |
  |---|---|
  | `jsx-copy` | bare JSX text; capitalized `placeholder`, `aria-label`, `title` and `alt` values |
  | `locale-literal` | `"en-GB"`, `"en-US"`, and `toLocale*String` with a string-literal locale |
  | `physical-direction` | Tailwind `ml/mr/pl/pr/left/right/border-l/border-r/rounded-l/rounded-r/text-left/text-right` and their inline-style equivalents |
  | `money-prefix` | `` `$${ `` and a `>$<` literal |

- **Pass/fail rules.** A new file must count zero. An existing file must not grow. A shrink prints the `--update` guidance. It is a repository-owned guard, not an eslint plugin (absorb-dont-adopt).

## Acceptance criteria

| AC | Objectives | Criterion |
|---|---|---|
| AC-LANG-DIR | OBJ-LOCALE-RESOLVE, OBJ-PSEUDO | With `ar-XB` selected, the root element renders `dir="rtl"`. With no preference, it renders `lang="en-US"` and `dir="ltr"`. |
| AC-CHAIN | OBJ-LOCALE-RESOLVE | Unit tests cover each rung of the resolution order, and a non-admin's preview cookie is ignored. |
| AC-PREFERENCE | OBJ-LOCALE-RESOLVE | Staff can set a language (supported locales only; admins also see pseudo-locales) and a timezone, which persist on `Principal`. The migration applies on a populated database. |
| AC-TYPED-KEYS | OBJ-CATALOG | An unknown catalog key fails `pnpm --filter web typecheck`. |
| AC-MF2 | OBJ-CATALOG | The vendored MF2 conformance subset passes. Plural output is correct for `en`, `es`, `ar` (six categories) and `ru`. Out-of-subset syntax fails catalog lint. |
| AC-FALLBACK | OBJ-CATALOG | `es-MX` resolves an `es-419` key, then falls back to `en-US`. A key missing everywhere never renders empty. |
| AC-PILOTS | OBJ-CATALOG, OBJ-PSEUDO, OBJ-ENGLISH-UNCHANGED | The 22 pilot strings come from the catalog. In `en-US` they render pixel-identical to before. In `en-XA` no raw English remains. In `ar-XB` the pilot pages read right-to-left on the running portal. |
| AC-GUARD | OBJ-NO-REGRESSION | Adding `ml-2` or `"en-GB"` to any file fails `pnpm check:guards`, and removing it passes. The baseline totals are within 10% of the measured counts (≈1,023 / 176 / 25). |
| AC-NO-DEPS | OBJ-CATALOG, OBJ-NO-REGRESSION | No npm dependency is added by any of the three items. |
| AC-ENGLISH | OBJ-ENGLISH-UNCHANGED | Portal pages sampled in English show no visual difference, and `/workspace` TTFB regresses by no more than 5%. |

## Alternatives considered

- **next-intl (rejected).** It is the best App Router fit, but it adds next-intl and intl-messageformat and retires nothing. The absorb-dont-adopt commandment (weight 2.0) decided this under `DI-ADAE8489B6A2`, margin 2.92.
- **i18next / react-i18next (rejected).** It carries the same dependency cost, fits React Server Components less well, and uses suffix-key plurals.
- **Lingui (rejected).** It is built around a `.po` extraction workflow that DPF does not use.
- **AI translate-at-render (rejected).** It gives no stable strings, cannot be reviewed, and has a per-render cost.
- **MF1 (ICU) syntax instead of MF2 (rejected).** MF2 has been stable since CLDR 47 and is what native `Intl.MessageFormat` will parse, so our parser can be deleted rather than migrated.
- **Storing the preference on `User` (rejected).** `Principal` is the canonical identity for people and agents, and `User` is only the auth record.
- **Locale-prefixed routes, `/[locale]/…` (rejected for now).** Staff surfaces don't need crawlable locale URLs. Public `hreflang` belongs to L2.1.

## Standards

BCP 47 and RFC 4647, the Unicode CLDR (plural rules, likely subtags), Unicode MessageFormat 2.0 (CLDR 47), W3C `lang`/`dir` guidance, CSS Logical Properties, and WCAG 2.2 SC 3.1.1.

## Out of scope

- Translations of any language
- The external-audience language chain (L2.1)
- Replacing the formatting helpers (L0.5)
- Migrating physical to logical classes (L0.6)
- Externalizing copy beyond the two pilots (L0.4)
- The mobile app (L3.5)
