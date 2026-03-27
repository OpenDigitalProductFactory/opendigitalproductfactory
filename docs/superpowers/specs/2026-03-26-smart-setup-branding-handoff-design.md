# EP-SETUP-001: Smart Setup Handoff — Business Name, Type, and Currency Detection from Branding URL

**Status:** Implemented
**Date:** 2026-03-26
**Epic:** Smart Setup Handoff
**Dependencies:** EP-BRANDING-001 (branding wizard + analyze_public_website_branding tool), EP-STORE-001 (storefront archetype catalog + setup wizard), EP-ONBOARD-001 (PlatformSetupProgress.context)

---

## Problem

When a user provides a company URL during the branding step, the platform scrapes logo, colors, and company name — but discards both the company name and the business type signal the URL contains.

**Business name entered twice:** The user types a company name during `account-bootstrap`, then is asked for it again in org settings and in the storefront setup wizard. The URL analysis already returns `companyName` — the platform should use it to pre-fill those subsequent fields.

**Default currency is always GBP:** The finance settings step defaults to GBP regardless of where the business is located. The URL analysis can detect the country from TLD (`.co.uk`, `.com.au`, `.de`), phone number format (`+44`, `04xx`, `+49`), and price symbols (`£`, `€`, `A$`). That country signal should set the default currency so users outside the UK don't have to find and change it.

**Business type entered manually:** Three steps after branding, the storefront setup wizard presents ~37 archetypes (dental practice, hair salon, IT managed services, etc.) and the user must select one manually. The URL already carries strong industry signals — a site with dental clinic keywords almost certainly matches the dental-practice archetype. The platform should use what it already knows.

---

## Goals

1. When a URL is used during branding setup, carry the detected company name forward to pre-fill the business name in the storefront wizard.
2. Detect the business country/currency from the same URL analysis and pre-select the default currency in the storefront financial setup step (overriding the GBP fallback).
3. Detect the likely business archetype and carry it forward to the storefront archetype picker.
4. All suggestions are stored in the setup context so they survive navigation between steps.
5. All suggestions are advisory — the user overrides freely, and pre-fills never overwrite a value the user already explicitly entered.
6. No extra page loads, no extra user input: all three detections run as part of the existing URL analysis call in `importBrandFromUrl`.

---

## Non-Goals

- Using AI/LLM inference for detection — all detection is pure heuristic (keyword matching, TLD lookup, phone pattern matching, currency symbol scanning).
- Detecting from uploaded brand documents (URL-only for now).
- Changing the archetype catalog or archetypes themselves.
- Forcing the user to use any detected suggestion.
- Detection when no URL was used (preset selection or manual branding entry).
- Overwriting a name the user already explicitly entered.

---

## Design

### 1. Extend `BrandingAnalysisResult` and `analyzePublicWebsiteBranding`

**File:** `apps/web/lib/public-web-tools.ts`

The existing `BrandingAnalysisResult` type returned `companyName`, `logoUrl`, `paletteAccent`, `notes`. Extended with five new fields:

```typescript
export type BrandingAnalysisResult = {
  companyName: string | null;
  logoUrl: string | null;
  paletteAccent: string | null;
  notes: string[];
  // NEW
  suggestedArchetypeId: string | null;      // e.g. "dental-practice", "hair-salon"
  suggestedArchetypeName: string | null;    // e.g. "Dental Practice"
  archetypeConfidence: "high" | "medium" | null;
  suggestedCountryCode: string | null;      // ISO 3166-1 alpha-2, e.g. "AU", "DE"
  suggestedCurrency: string | null;         // ISO 4217, e.g. "AUD", "EUR"
};
```

**Archetype detection — heuristic keyword scoring:**

`ARCHETYPE_CATALOG` is a static array of 37 entries, each with an `id`, `name`, and keyword array. `detectArchetype(text)` lowercases the concatenated title + description + textExcerpt and counts keyword hits per archetype. The winner is:

- `"high"` confidence: score ≥ 2 AND at least 2× the runner-up's score
- `"medium"` confidence: score ≥ 1 but not meeting the high threshold
- `null`: no keywords matched

Only `"medium"` or `"high"` confidence results are stored in setup context — weak matches are discarded rather than shown as suggestions.

**Country/currency detection — heuristic cascade:**

`detectCountryAndCurrency(url, textExcerpt)` applies three checks in order:

1. **TLD lookup** — `TLD_TO_COUNTRY` maps 27 ccTLDs to country/currency pairs. `.co.uk` is handled as a special case before the generic TLD check. Generic TLDs (`.com`, `.org`, `.net`, `.io`, `.app`) skip to step 2.
2. **Phone number patterns** — 14 `RegExp` patterns covering international dialing codes (`+44`, `+49`, `+61`, etc.) and UK national format (`0[1-9]\d{8,9}`).
3. **Currency symbols** — Scans body text for `£`, `€`, `A$`, `NZ$`, `C$`, `¥`, `₹`, `S$`.

Returns `{ countryCode: string; currency: string } | null`.

### 2. Store Suggestions in Setup Context

`SetupContext` (defined in `apps/web/lib/actions/setup-constants.ts`) gained seven new optional fields:

```typescript
export type SetupContext = {
  orgName?: string;
  industry?: string;
  hasCloudProvider?: boolean;
  skippedSteps?: string[];
  // NEW — populated by importBrandFromUrl during the branding step
  suggestedCompanyName?: string;
  suggestedArchetypeId?: string;
  suggestedArchetypeName?: string;
  archetypeConfidence?: "high" | "medium";
  suggestedCurrency?: string;
  suggestedCountryCode?: string;
  brandingSourceUrl?: string;
};
```

**Write path:** `importBrandFromUrl` (server action in `apps/web/lib/actions/branding.ts`) calls `updateSetupContext(patch)` immediately after analysis completes. This is fire-and-forget (`await ...catch(() => undefined)`) — a missing or completed setup record is a no-op, never an error.

Fields written per result:

- `suggestedCompanyName`: written whenever `companyName` is non-null.
- `brandingSourceUrl`: always written when a URL was analyzed.
- `suggestedCurrency` + `suggestedCountryCode`: written when the heuristic returns a result (no confidence filter — the signals are either present or absent).
- `suggestedArchetypeId` + `suggestedArchetypeName` + `archetypeConfidence`: written only when confidence is `"medium"` or `"high"`. Low/null matches are not stored.

### 3. New `getSetupContext` and `updateSetupContext` Actions

**File:** `apps/web/lib/actions/setup-progress.ts`

```typescript
// Read the context from the active (incomplete) setup record. Returns null if none.
export async function getSetupContext(): Promise<SetupContext | null>

// Merge a partial patch into the active setup record. No-op if no active setup.
export async function updateSetupContext(patch: Partial<SetupContext>): Promise<void>
```

`updateSetupContext` does a `findFirst` + `update` merge — it never overwrites the whole context, only merges the patch keys.

### 4. Business Name Pre-Fill (Storefront Wizard Step 3)

**File:** `apps/web/components/storefront-admin/SetupWizard.tsx`

`SetupWizard` now accepts `suggestedCompanyName?: string | null`. The `orgName` state is initialized from this prop (`useState(suggestedCompanyName ?? "")`). A note renders below the business name field when the prop is set:

> "Pre-filled from your branding URL — edit if needed"

### 5. Currency Pre-Fill (Storefront Wizard Step 4)

**Files:** `apps/web/components/storefront-admin/SetupWizard.tsx`, `apps/web/components/storefront-admin/FinancialSetupStep.tsx`

`FinancialSetupStep` now accepts `suggestedCurrency?: string | null`. The `baseCurrency` state is initialized as `suggestedCurrency ?? profile?.defaultCurrency ?? "GBP"`. A note renders below the currency selector when a suggestion was applied:

> "Pre-selected based on your website location — change if needed"

A fallback `<option>` is rendered if the suggested currency code is not in the standard 20-option list, ensuring the select always shows the correct value.

### 6. Archetype Pre-Selection (Storefront Wizard Step 1)

**File:** `apps/web/components/storefront-admin/SetupWizard.tsx`

When `suggestedArchetypeId` is set, Step 1 renders:

**Suggestion banner** (above the search field):

```text
Suggested: Hair Salon (high confidence)
Detected from your branding URL — scroll down to find it highlighted
```

**Highlighted card:** The matching archetype card receives a 2px accent border, a slightly tinted background using `color-mix()`, and a small "Suggested for you" label beneath the archetype name. The card is not pre-selected — the user must still click to confirm.

### 7. Server Component Wiring

**File:** `apps/web/app/(shell)/admin/storefront/setup/page.tsx`

The server component calls `getSetupContext()` in parallel with the archetypes DB query and passes all suggestion props to `<SetupWizard>`.

---

## Data Model

No Prisma schema changes. All new state lives in:

- `PlatformSetupProgress.context` (JSON, already exists)
- `SetupContext` TypeScript type (compile-time only)
- `BrandingAnalysisResult` TypeScript type (compile-time only)

---

## Files Affected

**Modified:**

- `apps/web/lib/public-web-tools.ts` — extend `BrandingAnalysisResult` type; add `ARCHETYPE_CATALOG`, `detectArchetype`, `detectCountryAndCurrency` heuristic functions; update `analyzePublicWebsiteBranding` to call both and include results
- `apps/web/lib/actions/setup-constants.ts` — extend `SetupContext` with seven new optional fields
- `apps/web/lib/actions/setup-progress.ts` — add `getSetupContext()` and `updateSetupContext()` server actions
- `apps/web/lib/actions/branding.ts` — extend `BrandImportResult` type; call `updateSetupContext` fire-and-forget after analysis; return new fields to caller
- `apps/web/app/(shell)/admin/storefront/setup/page.tsx` — call `getSetupContext()` in parallel, pass suggestion props to `<SetupWizard>`
- `apps/web/components/storefront-admin/SetupWizard.tsx` — accept suggestion props; add banner + highlighted card in Step 1; pre-fill `orgName` from suggestion; pass `suggestedCurrency` to Step 4
- `apps/web/components/storefront-admin/FinancialSetupStep.tsx` — accept `suggestedCurrency` prop; initialize `baseCurrency` from it; show attribution note

**No new files required.**

---

## Testing Strategy

### Unit Tests

**`apps/web/lib/public-web-tools.test.ts`**

- `analyzePublicWebsiteBranding` returns `null` suggestion fields for generic text with no industry signals
- Archetype detection: `.co.uk` dental site → `suggestedArchetypeId: "dental-practice"`, confidence `"high"`
- Archetype detection: ambiguous text → `suggestedArchetypeId: null`
- Country detection from TLD: `example.de` → `{ countryCode: "DE", currency: "EUR" }`
- Country detection from TLD: `example.co.uk` → `{ countryCode: "GB", currency: "GBP" }`
- Country detection from TLD: `example.com.au` (finalUrl) → `{ countryCode: "AU", currency: "AUD" }`
- Country detection from phone pattern: `+44` in body text → `{ countryCode: "GB", currency: "GBP" }`
- Country detection from currency symbol: `€` in body text → `{ currency: "EUR" }`
- Generic TLD (`.com`) with no other signals → `suggestedCountryCode: null`, `suggestedCurrency: null`

**`apps/web/lib/actions/setup-progress.test.ts`**

- `getSetupContext` returns `null` when no active setup record exists
- `getSetupContext` returns the context object when an active setup record exists
- `updateSetupContext` merges the patch without overwriting existing keys
- `updateSetupContext` is a no-op when no active setup record exists

### Platform QA Plan

See `tests/e2e/platform-qa-plan.md` Phase 1 (SETUP-*) and Phase 11 (STORE-*) for end-to-end test cases covering:

- URL import during branding writes suggestions to context
- Storefront setup wizard shows suggestion banner and highlighted card
- Financial setup shows pre-selected currency with attribution note
- Business name field is pre-filled in Step 3

---

## IT4IT Alignment

This feature enhances the **Engage to Order** value stream (EP-STORE-001 storefront) and the **Plan to Build** value stream (setup/onboarding). Both detections reduce time-to-value by eliminating redundant data entry and manual classification. No new IT4IT concepts are introduced — the feature uses existing `StorefrontArchetype` as the classification taxonomy and `Organization` as the identity anchor.

---

## Related Epics

| Epic | Relationship |
| --- | --- |
| EP-BRANDING-001 | Provides the URL import tool being extended |
| EP-STORE-001 | Provides the archetype catalog and storefront setup wizard |
| EP-ONBOARD-001 | Provides `PlatformSetupProgress` and `SetupContext` used to carry suggestions |
