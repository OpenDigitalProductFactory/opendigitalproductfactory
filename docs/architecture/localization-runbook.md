# Localization runbook

How DPF decides a viewer's language, text direction, time zone and currency, and how to extend it. Epic `EP-6B33A840`.

**Where the rules come from:**
- Design: [`docs/superpowers/specs/2026-09-25-localization-foundation-design.md`](../superpowers/specs/2026-09-25-localization-foundation-design.md)
- Architecture: [`docs/superpowers/specs/2026-09-24-localization-and-multi-currency-architecture-design.md`](../superpowers/specs/2026-09-24-localization-and-multi-currency-architecture-design.md)

## Where things live

| Concern | Home |
|---|---|
| Locale registry, Accept-Language negotiation, text direction | `packages/i18n` (`@dpf/i18n`): no dependencies, native `Intl` only |
| The viewer's `LocaleContext` (pure) | `apps/web/lib/org-locale/locale-context.ts` |
| Per-request binding (session, cookie, headers, DB) | `apps/web/lib/i18n/locale-context.server.ts` (`getLocaleContext()`) |
| Org currency / locale / country | `apps/web/lib/org-locale/org-locale.ts` over `OrgSettings` |
| A person's own language and time zone | `Principal.preferredLanguage`, `Principal.timeZone`; set on **Admin → Settings → Language and region** |

Read the context with `await getLocaleContext()` in server code. It never throws. Never read `Accept-Language`, `OrgSettings.locale` or a `"en-US"` literal directly.

## How a viewer's language is chosen

The first match wins:

1. **Admin preview.** The `dpf-locale` cookie, honoured for admins only. It accepts supported locales and the pseudo-locales.
2. **The person's saved language** (`Principal.preferredLanguage`).
3. **The org's default language.** This is `OrgSettings.defaultLanguage`, which arrives with L0.7.
4. **The browser's `Accept-Language`,** negotiated against *supported* locales only.
5. **`en-US`.**

**Text direction** (`ltr` or `rtl`) is derived from the language's script, never stored. The root layout renders `<html lang dir>` from it.

**Formatting** (numbers, dates) follows an explicitly chosen real language. Otherwise it stays on `OrgSettings.locale`. The time zone is the person's, then the org's, then UTC.

## Locale statuses

| Status | Meaning | Who can select it |
|---|---|---|
| `supported` | Fully usable | Everyone, including through browser negotiation |
| `pseudo` | `en-XA` (accented, expanded text) and `ar-XB` (right-to-left): generated QA locales | Admins only |
| `planned` | Known but not yet translated, e.g. `es-419`, `es-MX`, `es-US`, `ar` | Nobody, until the locale passes the L3.1 activation gate |

## Checking a screen for right-to-left readiness

Sign in as an admin. Open **Admin → Settings → Language and region** and set **Language** to *Pseudo-locale (right-to-left)*. The page switches to `dir="rtl"`.

Until L0.6 lands, layouts that use physical left/right styling will not mirror. Record what you see as L0.6 input.

## Adding a locale

Add a canonical BCP-47 tag to `LOCALES` in `packages/i18n/src/locales.ts` with status `planned`. The registry tests check canonical form and script-derived direction. Promote it only through the L3.1 activation gate.
