---
status: active
---

# Localization foundation: LocaleContext, owned message catalog, ratchet guard (L0.1–L0.3)

- **Epic:** `EP-6B33A840`
- **Backlog items:**
  - `BI-6EA9E25A` (L0.1): the umbrella for this plan
  - `BI-9A44B227` (L0.2)
  - `BI-4690CB37` (L0.3)
- **Canonical design (objectives and acceptance criteria):** `docs/superpowers/specs/2026-09-25-localization-foundation-design.md`
- **Spec:** `docs/superpowers/specs/2026-09-24-localization-and-multi-currency-architecture-design.md`, §5.1–5.4, §5.13 and §9.
- **Kernel decisions:**
  - `DI-ADAE8489B6A2`: an owned catalog over native `Intl`, not next-intl.
  - `DI-685582FAB30C` and `DI-38049EA347F8`: context only.
- **Precondition:** `BI-6030131C` (the currency-defaults fix). It adds `resolveOrgBaseCurrency` / `orgCurrencyFromSettings` to `lib/org-locale`, which L0.1 extends.

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time: one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Goal

When these three items land:
- Every page renders its `lang` and `dir` from one resolver.
- UI copy has one owned home: a typed catalog with an English source.
- Pseudo-locales can prove a screen is ready for translation, and for RTL, without any translation spend.
- A guard stops the English-only and direction-bound debt from growing.

English output stays byte-identical. Nothing is translated yet.

## Grounding (verified on `origin/main`, 2026-09-25)

| Fact | Evidence |
|---|---|
| Root layout is a server component with fixed `<html lang="en">`, no `dir`, and no providers. | `apps/web/app/layout.tsx:43-58` (html at L45, body at L46) |
| Storefront layout is an async server component with no locale. | `apps/web/app/(storefront)/s/[slug]/layout.tsx:32-73` |
| The session carries `user.id`, `principalId?` and `type`. | `apps/web/lib/govern/auth.ts:69-83`, `322-330` |
| `Principal` has no locale or preference field, and neither does `User`. | `packages/db/prisma/schema/core-identity.prisma:8` (User), `:183` (Principal) |
| The org spine (`baseCurrency`, `locale`, `countryCode`) exists. | `core-identity.prisma:925-938`; `apps/web/lib/org-locale/org-locale.ts` |
| A cookie-preference precedent exists (`dpf-nav-mode`), read via `(await cookies())` in the shell layout. | `apps/web/lib/navigation/nav-mode.ts:8`; `app/(shell)/layout.tsx:167` |
| `proxy.ts` has no locale logic and sets no cookies; it only sets the `x-pathname` request header. | `apps/web/proxy.ts:83-104` |
| Guards named `scripts/check-no-*.mjs` are auto-discovered, with their sibling `*.test.mjs` run first. | `scripts/check-guards.mjs:117-158` |
| The closest literal-pattern ratchet. | `scripts/check-no-hand-rolled-loading.mjs` (exports `scan`, `parseBaseline`, `diff`) |
| New baselines must carry an owner and expiry budget header. | `scripts/check-no-expired-baseline-budgets.mjs:14-24,130-137`; helpers in `scripts/lib/baseline-budget.mjs` |
| The CI test inventory must list new `scripts/**/*.test.mjs`. | `scripts/ci-policy-test-inventory-allowlist.txt` |
| Workspace package wiring pattern. | `main`/`types` → `src/index.ts`, `exports` subpaths (`packages/integration-shared`), `workspace:*` dependency, `transpilePackages` (`apps/web/next.config.mjs:32`), vitest alias (`apps/web/vitest.config.ts:113-180`) |
| Pilot surfaces. | `apps/web/app/not-found.tsx` (client component, 10 strings); `apps/web/lib/actions/setup-constants.ts:35-48` (12 `STEP_LABELS`) |

## Design choices this plan fixes

1. **Home.** The pure, framework-free parts live in a new workspace package, `packages/i18n` (`@dpf/i18n`). That covers the locale registry, negotiation, direction, the MessageFormat 2 subset, pseudo-locales, catalog types and the catalogs themselves. Both `apps/web` and `apps/mobile` can consume it (L3.5 `BI-59CBBBB1`), and it has **no npm dependencies**. Next-specific bindings (request resolution, `getT`, the client provider) stay in `apps/web/lib/i18n`, and `lib/org-locale` remains the single home of the org spine. If the mobile workspace split `BI-2FD295F3` lands first, the package is linked across workspaces rather than duplicated.
2. **Typed keys without a generator.** The key union is inferred from the `en` catalog's JSON type through a recursive `Paths<T>` type. That means no derived artifact and no build step: an unknown key is a compile error, and adding a key needs no regeneration.
3. **Message syntax.** A strict subset of Unicode MessageFormat 2.0: placeholders `{$x}`, the functions `:number`, `:integer`, `:currency`, `:datetime`, `:date` and `:time`, and `.input` / `.match` with plural (CLDR categories via `Intl.PluralRules`) or exact-string keys, plus `*` as the fallback. Anything outside the subset is rejected by a catalog lint, never rendered. A conformance fixture set, taken from the Unicode MF2 test suite for the supported subset, keeps us aligned with the standard. When native `Intl.MessageFormat` ships, it replaces the parser and nothing else changes.
4. **Locale preference storage.**
   - Staff and operators: nullable `Principal.preferredLanguage` and `Principal.timeZone`, added in an additive migration.
   - Pseudo-locale and preview switching: an admin-only `dpf-locale` cookie, following the nav-mode precedent.
   - External audiences come later, in L2.1 `BI-56ECBA05`.
5. **Resolution chain (internal viewers):**
   1. the preview cookie (admin only)
   2. `Principal.preferredLanguage`
   3. `OrgSettings.defaultLanguage`, added in L0.7 and read here when present
   4. `Accept-Language` negotiated against the registry's `supported` locales
   5. `en-US`

   `dir` is derived from `new Intl.Locale(tag).maximize().script` against the set {Arab, Hebr, Thaa, Syrc, Nkoo, Adlm, Rohg}, never stored. Resolution is read-only and happens in the server layout. Nothing is added to `proxy.ts`.
6. **Guard.** `scripts/check-no-unlocalized-ui.mjs` joins the auto-discovered `check-no-*` family. Its baseline is `scripts/unlocalized-ui-baseline.txt`, created with a budget header (owner `platform-architecture`, expiry 2027-03-31). It is not an eslint plugin (absorb-dont-adopt).

## Phase 1: L0.1 `BI-6EA9E25A`, LocaleContext (independently shippable)

**Deliverable.** Every page renders `lang`/`dir` from one resolver. Staff can pick a language and timezone. Admins can preview a pseudo-locale.

| Step | Files | Test first (red → green) |
|---|---|---|
| 1.1 Create `@dpf/i18n` with `locales.ts`, the registry (tag, script, dir, pluralCategories, status). It covers `en-US` (supported), `en-XA` and `ar-XB` (pseudo), and `es-419`, `es-MX`, `es-US` and `ar` (planned). | `packages/i18n/{package.json,tsconfig.json,src/index.ts,src/locales.ts}`; wiring in `apps/web/next.config.mjs`, `apps/web/vitest.config.ts` and `apps/web/package.json` | `locales.test.ts`: every entry is canonical BCP-47 (`Intl.getCanonicalLocales`), and `dir` agrees with `maximize().script` |
| 1.2 `negotiate.ts`: RFC 4647 lookup over `Accept-Language` q-values against the `supported` set, falling back through macro-language (`es-MX → es-419 → es`). `direction.ts`: tag → `ltr` or `rtl`. | `packages/i18n/src/{negotiate,direction}.ts` | Cases: `es-MX,es;q=0.9` → `es-MX` when supported and `en-US` when not; `ar` → `rtl`; `he` → `rtl`; `ur-PK` → `rtl`; `en` → `ltr`; malformed header → default |
| 1.3 A pure `resolveLocaleContext(inputs)` in `lib/org-locale` returns `{ language, formatLocale, dir, timeZone, displayCurrency, measurementSystem }`. The currency comes from `orgCurrencyFromSettings`. | `apps/web/lib/org-locale/locale-context.ts` (+ test) | The chain order in design choice 5, one case per rung. A non-admin's preview cookie is ignored. |
| 1.4 A server binding `getLocaleContext()` reads `auth()`, `cookies()`, `headers()`, the Principal and OrgSettings once per request (React `cache`). | `apps/web/lib/i18n/locale-context.server.ts` | Mocked `next/headers` plus `@dpf/db`, in the style of the setup-route test |
| 1.5 The root layout becomes `async` and renders `<html lang={language} dir={dir}>`. The storefront layout sets `lang`/`dir` on its wrapper from the org default, because the visitor chain is L2.1. | `apps/web/app/layout.tsx`, `app/(storefront)/s/[slug]/layout.tsx` | A layout test asserts the attributes. With no preference, the output string is unchanged: `lang="en-US"` replaces `lang="en"`, and that is the only diff, which is intended. |
| 1.6 Migration: `Principal.preferredLanguage String?` and `Principal.timeZone String?`. Additive and nullable, with no backfill. | `packages/db/prisma/schema/core-identity.prisma`; `packages/db/prisma/migrations/<ts>_principal_locale_preferences/migration.sql` | The migration applies against a populated DB (the local-CI migration gate) |
| 1.7 A "Language and region" control. Staff set their own language (only `supported` locales, plus pseudo-locales for admins) and timezone. It lives on the existing admin settings surface until a personal preferences page exists. | a new server action in `apps/web/lib/actions/locale-preferences.ts`; UI in `app/(shell)/admin/settings` | Action test: a non-admin cannot select pseudo-locales, and invalid tags are refused |

**Verification.**
- `pnpm --filter @dpf/i18n exec vitest run`, the affected web tests, and `pnpm --filter web typecheck`.
- `pnpm --filter web build`.
- The migration gate.
- **Portal check:** as admin, pick `ar-XB`. The `/workspace` root has `dir="rtl"`, and switching back restores `ltr`. As a seeded non-admin persona, the pseudo-locale options are absent.

**Docs impact.** This adds `docs/architecture/localization-runbook.md`, covering the locale chain, the registry and how to add a locale stub. The theme runbook's direction section waits for L0.6.

**Rollback.** Revert the PR. The migration's columns are nullable and unused by older code, so they can stay (the migration is forward-only).

## Phase 2: L0.2 `BI-9A44B227`, owned message catalog (independently shippable; depends on Phase 1)

**Deliverable.** UI copy resolves through `t(key, args)` from typed catalogs. The two pilot surfaces are served from the catalog in `en`, `en-XA` and `ar-XB`.

| Step | Files | Test first |
|---|---|---|
| 2.1 Catalog layout: `packages/i18n/messages/<locale>/<namespace>.json`, with `en-US` as the source. `Paths<T>` key inference. | `packages/i18n/src/catalog.ts` | Type test (`expectTypeOf`): a known key is accepted and an unknown key is a type error |
| 2.2 MF2 subset: tokenizer, parser to an AST, and a formatter over `Intl.PluralRules`/`NumberFormat`/`DateTimeFormat`. Out-of-subset syntax throws at load. | `packages/i18n/src/mf2/{parse,format}.ts` | Vendored conformance fixtures (subset of the Unicode MF2 test suite, with the licence notice carried) in `packages/i18n/test/mf2-conformance/`. Plural coverage for `en` (one/other), `es` (one/many/other), `ar` (zero/one/two/few/many/other) and `ru`. |
| 2.3 Fallback chain: regional → macro-language → `en-US`, per key. A missing key never renders empty. In development it renders the key and warns once. | `packages/i18n/src/lookup.ts` | `es-MX` finds an `es-419` key, falls back to `en-US`, and a missing key everywhere returns the key string |
| 2.4 Pseudo-locales, generated rather than authored. `en-XA` accents Latin letters, pads text by 35%, and brackets it as `⟦…⟧`. `ar-XB` wraps text in U+202E … U+202C and flips direction. Both preserve MF2 placeholders. | `packages/i18n/src/pseudo.ts` | Placeholders survive; the expansion ratio is ≥ 1.3; ICU plural branches are all transformed |
| 2.5 Web bindings. `getT(namespace)` for RSC and server actions, using Phase 1's `getLocaleContext`. A `<MessagesProvider>` in the root layout ships only the namespaces a subtree declares. A `useT(namespace)` hook for client components. | `apps/web/lib/i18n/{t.server.ts,MessagesProvider.tsx,use-t.ts}` | Server: `getT("errors")("notFound.heading")` in `en-US` and `en-XA`. Client: jsdom render of a component using `useT` |
| 2.6 A catalog lint as part of the package test: every non-English catalog's keys ⊆ the `en` keys, and every message parses within the subset. | `packages/i18n/test/catalog-lint.test.ts` | It fails on a stray key and on unsupported MF2 syntax |
| 2.7 **Pilot 1:** `app/not-found.tsx` (client, 10 strings including the `{name}` interpolation) moves to an `errors` namespace. **Pilot 2:** `setup-constants.ts` `STEP_LABELS` (12 strings) become keys in a `setup` namespace. The label map keeps its shape for its three consumers (`SetupProgressBar`, `BuildStudio`, `build-exec-types`), resolved through `getT` where rendered. | the pilot files plus `packages/i18n/messages/en-US/{errors,setup}.json` | The existing pilot tests stay green; new tests assert the `en-XA` rendering |

**Verification.**
- Package and affected web tests, typecheck and `pnpm --filter web build`.
- **Portal check** across the not-found page and the setup progress bar:
  - In `en-US`, the pixels match the pre-change screenshots.
  - In `en-XA`, all 22 strings appear pseudo-localized, with no raw English left.
  - In `ar-XB`, the text shows mirrored and the layout reads RTL. RTL layout defects on these pages are recorded as L0.6 inputs, not fixed here.

**Docs impact.** The localization runbook gains an "authoring UI copy" section: keys, namespaces, MF2 subset examples and pseudo-locale QA. Add a one-line AGENTS.md §9 pointer (a rule plus a runbook link) once L0.3 enforces it.

**Rollback.** Revert the PR. The pilots return to literals, and no data is involved.

## Phase 3: L0.3 `BI-4690CB37`, localization ratchet guard (independently shippable; no dependency on Phases 1–2, so it can land first)

**Deliverable.** A shrink-only guard over four categories, with a checked-in baseline whose counts can only fall.

| Step | Files | Test first |
|---|---|---|
| 3.1 `scan(file)` counts four categories. **(a)** `jsx-copy`: bare JSX text starting with a letter, plus capitalized `placeholder`, `aria-label`, `title` and `alt` string literals. **(b)** `locale-literal`: `"en-GB"`/`"en-US"` literals and a `toLocale*String(` whose first argument is a string literal. **(c)** `physical-direction`: Tailwind `(^|\s|:)-?(ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)-?`, plus the inline `marginLeft`/`marginRight`/`paddingLeft`/`paddingRight`/`left:`/`right:`/`textAlign:"left"\|"right"` forms. **(d)** `money-prefix`: `` `$${ `` and a `>$<` JSX literal. | `scripts/check-no-unlocalized-ui.mjs` | `scripts/check-no-unlocalized-ui.test.mjs` with fixtures for each category, including false positives that must not count: `mr-` inside a word, `text-right` inside a comment, `$` in a regex |
| 3.2 Scope: `apps/web/{app,components,lib}` and `packages/*/src`, excluding tests, `*.generated.*` and `packages/i18n` (which intentionally holds locale literals). The baseline format is `path\tcategory\tcount`, created with `formatTxtBudgetHeader` (owner `platform-architecture`, expiry `2027-03-31`). | `scripts/unlocalized-ui-baseline.txt` | `parseBaseline`/`diff`: a new file with any count fails; a grown count fails; a shrunk count passes and prints `--update` guidance |
| 3.3 Register the guard's self-test in `scripts/ci-policy-test-inventory-allowlist.txt`. The loop runs it; the allowlist is shrink-only for other entries, and this entry is required. | allowlist | `pnpm check:guards` runs the new guard; ci-policy test inventory passes |
| 3.4 Generate the baseline from `main` with `--update`. Spot-check its totals against the spec §3 measurements: about 1,023 physical-direction, 176 locale literals and 25 `$${` prefixes. A variance above 10% means the regex is wrong and gets fixed before landing. | baseline | This comparison is itself the verification |

**Verification.**
- `node --test scripts/check-no-unlocalized-ui.test.mjs`, `pnpm check:guards`, and the pregate preflight.
- A throwaway commit that adds `ml-2` to a component fails the guard; reverting it passes. The outcome is recorded as evidence.

**Docs impact.** The runbook's "the guard says my file grew" section: which replacement to use for each category (`t()`, `format.*`, logical classes, `formatMoney`). AGENTS.md §9 gets one line and the runbook link. That edit rides in this PR because this is the PR that makes the rule enforced.

**Rollback.** Revert the PR. The guard and baseline are self-contained.

## Order, risks and cross-cutting checks

**Order.** Phase 3 (L0.3) and Phase 1 (L0.1) can proceed in parallel. Phase 2 (L0.2) follows Phase 1. Each phase is its own branch, workroom, PR and gate.

| Risk | Mitigation |
|---|---|
| Root layout becomes `async` and reads the session on every render. It is already `force-dynamic`, and `auth()` is called by `(shell)/layout.tsx` today. | Wrap in React `cache` so it resolves once per request. Measure TTFB on `/workspace` before and after, and flag any regression over 5%. |
| `lang="en"` → `lang="en-US"` changes an attribute value that screen readers read. | Both values are valid, and `en-US` is more precise. Covered by an accessibility spot-check in the Phase 1 portal check. |
| The MF2 subset is too narrow for real copy. | The catalog lint fails loudly. Widen the subset through the conformance fixtures, never by special-casing. |
| Guard regexes produce false positives, and the baseline is noisy. | Step 3.4 validates against the independently measured §3 counts. The self-test fixtures pin the known false-positive shapes. |
| Client bundle growth from catalogs. | Namespaces load per subtree, and the pilots add under 2 KB. Record the `pnpm --filter web build` First Load JS before and after in the PR. |
| `apps/mobile` workspace split (`BI-2FD295F3`) lands mid-flight. | `@dpf/i18n` has no dependencies and is consumed by path. The split links it; it does not fork it. |

**Guard obligations every phase must pass** (seen on recent PRs):
- the module-size ratchet: new files under 800 LOC
- the design-grounding trailer, citing the `apps/web/lib/org-locale` substrate
- the convergence-impact trailer: an image-carried change auto-converges on self-upgrade
- the data-impact gate for Phase 1's migration
- the docs-impact decision
- the process-spine decision for new source modules, if prompted

## Traceability to the canonical design

The objective and acceptance ids are defined in `docs/superpowers/specs/2026-09-25-localization-foundation-design.md`.

| Deliverable | Objectives | Contracts and acceptance | Flow |
|---|---|---|---|
| `L0.1-locale-context` (`BI-6EA9E25A`) | OBJ-LOCALE-RESOLVE, OBJ-PSEUDO, OBJ-ENGLISH-UNCHANGED | AC-LANG-DIR, AC-CHAIN, AC-PREFERENCE, AC-NO-DEPS, AC-ENGLISH | Phase 1: L0.1 |
| `L0.2-message-catalog` (`BI-9A44B227`) | OBJ-CATALOG, OBJ-PSEUDO, OBJ-ENGLISH-UNCHANGED | AC-TYPED-KEYS, AC-MF2, AC-FALLBACK, AC-PILOTS, AC-NO-DEPS | Phase 2: L0.2 |
| `L0.3-ratchet-guard` (`BI-4690CB37`) | OBJ-NO-REGRESSION | AC-GUARD, AC-NO-DEPS | Phase 3: L0.3 |

## Backlog coverage

- **Decision:** `decomposed`
- **Umbrella:** `BI-6EA9E25A` (L0.1)
- **Deliverables:**
  - `L0.1-locale-context` → `BI-6EA9E25A`. Depends on: none. Precondition: `BI-6030131C`.
  - `L0.2-message-catalog` → `BI-9A44B227`. Depends on: `L0.1-locale-context`.
  - `L0.3-ratchet-guard` → `BI-4690CB37`. Depends on: none.
- Receipt: blocked-by: plan-phase initiative readiness for BI-6EA9E25A is unmet (IRD-832698B5AD65: RESEARCH_REQUIRED, CANONICAL_DESIGN_REQUIRED, SPEC_APPROVAL_REQUIRED, REVIEW_REQUIRED). The spec needs independent design-checklist (AGT-WS-REVIEW) and architecture (AGT-WS-EA) review before coverage can be minted.
- **Before implementation starts:**
  - Add OBJ/AC markers to the spec.
  - Drive the reviewer chain.
  - Record coverage with `record_plan_backlog_coverage` and replace the line above with the receipt id.
