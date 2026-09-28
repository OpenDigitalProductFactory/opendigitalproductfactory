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

## Authoring UI copy

User-facing copy lives in the message catalog, not in JSX. Two rules:

- **Catalogs.** They sit at `packages/i18n/src/messages/<locale>/<namespace>.json`, and **en-US is the source of truth**. Register a new namespace in `SOURCE_CATALOG` (`packages/i18n/src/catalog.ts`).
- **Keys.** They are typed from the en-US JSON, so an unknown key fails typecheck.

Use the translator that matches where the code runs:

| Where | How |
|---|---|
| Server components and actions | `const t = await getT("errors"); t("notFound.storefront.heading")` |
| Client components | `const t = useT("setup"); t("steps.branding")` |

A client component's namespace must be provided by a `MessagesProvider` above it. The root layout provides `errors` and `setup`, and a page can add a provider for its own subtree.

**Message syntax** is a subset of Unicode MessageFormat 2.0:

{% raw %}
```text
Hello, {$name}!
{$amount :currency currency=$code}
{$when :date}
.input {$count :number}
.match $count
0 {{No items}}
one {{One item}}
* {{{$count} items}}
```
{% endraw %}

The formatter handles `:number`, `:integer`, `:currency`, `:datetime`, `:date`, `:time` and `:string`, with `.input` / `.match` on exact, plural-category and `*` keys.

Markup, `.local` and unknown functions are rejected when a catalog loads. A missing key falls back **per key**: regional, then macro-language, then en-US (`es-MX` → `es-419` → `es` → `en-US`). A key missing everywhere renders as the key itself, never as an empty string.

**Pseudo-locales** are generated from en-US, never authored:

| Locale | What it does | What it catches |
|---|---|---|
| `en-XA` | Accents the text, lengthens it by 35% and brackets it | Copy that escaped the catalog (it stays plain English) and truncation |
| `ar-XB` | Mirrors the text and runs the page right-to-left | Right-to-left layout problems |

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

## The localization guard

`scripts/check-no-unlocalized-ui.mjs` (BI-4690CB37) is a ratchet in the repo guard loop (`pnpm check:guards`). It counts four categories per file. A new file must count zero, and an existing file's count may not grow.

| Category | What it catches | Use instead |
|---|---|---|
| `jsx-copy` | Multi-word English JSX text; capitalized `placeholder`, `aria-label`, `title` and `alt` values | The message catalog (L0.2) |
| `locale-literal` | `"en-GB"` / `"en-US"`, and `toLocale*String("xx")` with a literal locale | `getLocaleContext()` and the shared formatters |
| `physical-direction` | `ml/mr/pl/pr`, `left/right`, `border-l/r`, `rounded-l/r`, `text-left/right`, plus the equivalent inline styles | Logical classes: `ms/me`, `ps/pe`, `start/end`, `border-s/e`, `rounded-s/e`, `text-start/end` |
| `money-prefix` | `` `$${…}` `` templates and a literal `>$<`. SQL placeholders and spreadsheet absolute references are ignored. | `formatMoney` |

When you migrate a surface and its count drops, run `node scripts/check-no-unlocalized-ui.mjs --update` to retighten the baseline (`scripts/unlocalized-ui-baseline.txt`).

The counts are a regex approximation. That is by design: the ratchet only has to be monotonic.
