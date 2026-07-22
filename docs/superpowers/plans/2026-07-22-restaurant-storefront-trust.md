# Restaurant public storefront: customer trust, brand & archetype-gated journeys

- **Backlog item:** BI-4A68EDF6 (`Restaurant public storefront needs customer trust, brand, and archetype-gated journeys`), epic EP-UX-COGLOAD.
- **Date:** 2026-07-22
- **Surface:** external Claude Code build, worktree `restaurant-storefront-trust-30cc39`.

## Backlog coverage

- Decision: atomic
- Parent: BI-4A68EDF6
- Receipt: cmrvoh31n07dx01rwlcjc6kkj
- Rationale: One cohesive UX fix to a single surface (the public `/s/[slug]` storefront). The eight change areas share the same new `public-trust` SSOT and route registries and are sequencing-only, not independently shippable — shipping any subset (gating without recovery, footer without the policies page) would leave broken links or half-states. The coordinating BIs are separate PRs, deliberately kept disjoint.
- Dependencies: none blocking. Coordinates with (disjoint from) BI-2B2FCB2B (#3390 mobile), BI-8E74C749 (#3386 forms), BI-3DA1DFDC/BI-0E4A1228 (booking lifecycle/handoff), BI-C764BE03 (`/portal` auth).

## Problem

A live public/customer trust audit (2026-07-22) found the Restaurant storefront at
`/s/<slug>` is navigable but does not read as a trustworthy restaurant. Concretely:
the browser title/brand fell back to the platform default, there was no site-wide
trust content (location/contact/hours, booking/cancellation, dietary/allergen,
privacy/terms, payment/deposit), repeated `Book Now` links had no item-specific
accessible name, item/booking pages did not explain what the customer was committing
to or what happens next, unsupported archetype journeys (`/donate`, `/order`,
`/checkout`) dead-ended on the internal 404 whose recovery links point at
`/workspace` and `/docs`, and the inquiry confirmation read like checkout plumbing.

## Design grounding

- **Specs/plans reviewed:** `search_specs_and_plans` + `rg docs/superpowers` for
  storefront/trust — no existing public-storefront-trust spec owns this; the
  archetype substrate is `docs/superpowers/specs/2026-07-21-archetype-provisioning-playbook-design.md`
  and the value-stream doc `docs/architecture/archetype-business-value-streams.md`
  (`attract · capture · qualify · deliver · settle · retain`). This BI hardens the
  **attract/capture** stages for `food-hospitality`.
- **Code substrate reviewed (`rg` + reads):** `apps/web/app/(storefront)/s/[slug]/*`
  (layout + all page routes), `apps/web/lib/release/storefront-data.ts`
  (`getPublicStorefront`), `apps/web/lib/release/storefront-types.ts`,
  `apps/web/lib/storefront/archetype-vocabulary.ts`, `cta-labels.ts`,
  `apps/web/components/storefront/*` (ContactSection, CtaButton, ItemCard,
  StorefrontNav, SectionRenderer), `apps/web/lib/operating-hours-read.ts`
  (`profileHoursToSchedule`), and `packages/storefront-templates/src/archetypes/food-hospitality.ts`.
- **Decision:** *extend* existing substrate — no new tables, enums, epics, or
  primitives. `getPublicStorefront` already returns brand/contact/address/timezone;
  we surface it. New leaf modules only (a trust SSOT lib + presentational
  components + one policies route).
- **Source of truth for trust copy:** new `apps/web/lib/storefront/public-trust.ts`,
  archetype-**category** keyed (never fabricated per-org), falling back to a safe
  generic profile so no legal/payment/dietary claim is invented.

## Coordination (disjoint from in-flight PRs)

- **#3386** (BI-8E74C749) owns the per-field accessible **form contract** inside
  `SignInForm` / `SignUpForm` / `BookingForm`. This BI does **not** touch those
  components — it adds site-wide + page-level trust context around them.
- **#3383 / #3387** (BI-0E4A1228 / BI-3DA1DFDC) own `SlotBookingFlow`,
  `slot-booking-fields`, `booking-summary`, and the owner-side handoff. This BI does
  **not** touch those — it adds trust copy in the booking *page wrapper* above the flow.
- **BI-C764BE03** owns the `/portal/*` customer-auth 404. This BI scopes recovery to
  the `/s/<slug>` storefront segment only (a new segment `not-found`), leaving the
  global `not-found.tsx` and `/portal` untouched.

## Changes

1. **Brand inheritance** — `generateMetadata` in the storefront layout titles every
   public page with the storefront name + tagline (+ OpenGraph), replacing the
   platform default.
2. **Site-wide trust footer** — `StorefrontTrustFooter` rendered in the layout:
   location, contact, confirmed opening hours (only when confirmed — never invented),
   and links to the policies page. Data from `getPublicStorefront` + a new
   `getPublicOperatingHours` (reuses `profileHoursToSchedule`).
3. **Public trust SSOT** — `public-trust.ts`: `resolveTrustProfile(category)`
   (booking/cancellation/dietary/payment/account copy) and
   `isJourneySupported(storefront, journey)` (derives donation/order/booking support
   from configured items/sections).
4. **Archetype journey gating** — `/donate` and `/order` render a customer-safe
   `StorefrontUnavailable` (recovery into the storefront) when the journey isn't
   configured, instead of the internal 404.
5. **Customer-safe 404 recovery** — new `s/[slug]/not-found.tsx` recovers the slug
   from the pathname and links back to storefront home / contact / sign-in.
6. **Item & booking context** — "what happens next", booking/cancellation policy,
   dietary note, and a contact fallback; item-specific `aria-label` on repeated CTAs
   (`CtaButton` gains an optional `itemName`).
7. **Confirmation copy** — checkout confirmation explains what happens next per
   request type and offers customer recovery, so inquiry success no longer reads as
   checkout plumbing.
8. **Auth vocabulary + policies page** — sign-in/sign-up inherit brand + reservation
   vocabulary and link terms/privacy; a new `/s/[slug]/policies` page is the honest
   home for booking/cancellation, dietary/allergen, payment/security, privacy, terms.

## Tests (smoke + unit)

- `public-trust.test.ts` — journey gating, trust profiles, confirmed-hours loader.
- `StorefrontTrustFooter.test.tsx`, `StorefrontUnavailable.test.tsx`, `not-found.test.tsx`.
- `CtaButton.test.tsx` — item-specific accessible name.
- `storefront-trust.smoke.test.tsx` — brand metadata, item/booking trust context,
  donation/order gating (+ supported), confirmation copy, auth vocabulary, inquiry +
  policies pages.

## Verification substrate

Source-only worktree (unpopulated `node_modules`) — local vitest/tsc/build cannot
run here (AGENTS §5 "where each gate runs"). The required CI **Typecheck**, **Unit
Tests**, and **Prod Build** jobs are the authoritative gate for this PR.
