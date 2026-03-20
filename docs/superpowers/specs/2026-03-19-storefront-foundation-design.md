# Storefront Foundation — Design Spec

**Date:** 2026-03-19
**Epic:** EP-STORE-001
**Status:** Draft — awaiting plan

---

## 1. Overview

Add a public-facing storefront to the ODPF platform, enabling the organisation running the platform to sell products and services to potential and existing customers. The storefront is the primary customer entry point — replacing the disconnected `/customer-login` flow with a tenant-aware, publicly accessible surface.

The design is archetype-driven: a pre-wired library of ~35 business templates across 10 market categories (healthcare, trades, professional services, retail, education, pet services, food, fitness, nonprofit, beauty) seeds the storefront with appropriate content and CTA types out of the box. The conversion action (book, buy, inquire, donate) is determined by the archetype and can be overridden per item.

---

## 2. Scope

### In scope

- `Organization` model — canonical platform identity (new)
- `BrandingConfig` — add optional `organizationId` FK; no breaking changes to existing fields
- `packages/storefront-templates` — TypeScript archetype catalog
- 8 new Prisma models: `StorefrontConfig`, `StorefrontArchetype`, `StorefrontSection`, `StorefrontItem`, `StorefrontBooking`, `StorefrontOrder`, `StorefrontInquiry`, `StorefrontDonation`
- `(storefront)` route group in `apps/web` — path-based `/s/[slug]`
- Next.js middleware — route isolation, public data access rules
- Unified sign-in at `/s/[slug]/sign-in` — `CustomerContact` vs `User` table detection and routing
- `(customer-auth)` route refactor — redirect to canonical storefront paths
- Storefront pages — home, item detail, booking flow, inquiry form, cart, donate, sign-in, sign-up, checkout/confirmation
- Shell admin — `/storefront` route group: dashboard, setup wizard, sections manager, items manager, inbox
- Public data layer — `lib/storefront-data.ts` with explicit `PublicStorefrontConfig` type
- Shell layout updated to read org name from `Organization` (with `BrandingConfig.companyName` as display override)
- `packages/storefront-templates` seed migration

### Out of scope (follow-on epics)

- AI Coworker-assisted storefront setup (EP-STORE-002)
- Booking calendar integration — staff availability, diary blocking (EP-STORE-003)
- Custom domain / subdomain routing (EP-STORE-004)
- Payment processing integration — MVP captures orders/bookings without payment (EP-STORE-005)
- CRM enrichment of `CustomerAccount` (EP-STORE-006)

---

## 3. Data Model Stewardship

### Refactoring: `Organization` model

The existing `BrandingConfig` holds `companyName` and `logoUrl` — org identity fields in a theming model. The storefront would be the second consumer of "who runs this instance." Rather than couple a third, fourth, and fifth feature to `BrandingConfig`, a canonical `Organization` model is introduced.

```prisma
model Organization {
  id        String   @id @default(cuid())
  orgId     String   @unique    // format: "ORG-XXXXXX", generated at first-run setup
  name      String              // trading name — primary identity source
  legalName String?             // full legal name if different
  slug      String   @unique    // canonical URL slug — used in /s/[slug]
  industry  String?             // set from archetype during first-run setup
  website   String?
  email     String?             // primary public contact email
  phone     String?
  address   Json?               // { street, city, postcode, country }
  logoUrl   String?             // canonical logo
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  brandingConfig   BrandingConfig?
  storefrontConfig StorefrontConfig?
}
```

**`BrandingConfig` changes — no breaking changes:**
- Add `organizationId String? @unique` FK to `Organization` (nullable)
- `companyName String` remains non-nullable — existing value is preserved as a display override
- Branding queries continue to use the existing `where: { scope: "organization" }` lookup
- The FK is for future linkage convenience only — storefront reads identity from `Organization` directly, not via `BrandingConfig`
- Migration: adds nullable `organizationId` column; existing rows get `NULL`; populated when first-run wizard creates the `Organization` record

**Shell layout update (not a breaking change):**
- Current: `activeBranding?.companyName ?? "Open Digital Product Factory"`
- Updated: `organization?.name ?? activeBranding?.companyName ?? "Open Digital Product Factory"`
- `Organization` is queried alongside `BrandingConfig` in the shell layout server component
- `BrandingConfig.companyName` continues to work as a display override for installs that set it explicitly

**First-run setup wizard** creates the `Organization` record before anything else, generating `orgId` as `"ORG-" + nanoid(6).toUpperCase()`.

### Future refactoring opportunities (not in this epic)

| Opportunity | Signal | Priority |
|---|---|---|
| Shared address model | `EmployeeAddress` is employee-only; `Organization.address` (JSON), future location models all need addresses | Medium |
| `CustomerAccount` enrichment | Only has `name`/`status` — no industry, size, website | Low — CRM epic |
| Slug governance | `Team`, `Department`, `Portfolio`, `Organization` slugs are all independent | Low — naming policy doc |

---

## 4. New Data Models

### `StorefrontArchetype`

Seeded from `packages/storefront-templates`. Not user-created.

```prisma
model StorefrontArchetype {
  id              String   @id @default(cuid())
  archetypeId     String   @unique    // e.g. "veterinary-clinic"
  name            String              // "Veterinary Clinic"
  category        String              // "healthcare-wellness"
  ctaType         String              // "booking" | "purchase" | "inquiry" | "donation"
  itemTemplates   Json                // Array<{ name, description, priceType, ctaType? }>
  sectionTemplates Json               // Array<{ type, title, sortOrder }>
  formSchema      Json                // Array<FormField> — archetype-specific CTA fields
  tags            String[]            // ["appointment", "pets", "healthcare"]
  isActive        Boolean @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### `StorefrontConfig`

One per organisation install. References `Organization` for identity; adds storefront-specific fields only.

```prisma
model StorefrontConfig {
  id              String        @id @default(cuid())
  organizationId  String        @unique
  organization    Organization  @relation(fields: [organizationId], references: [id])
  archetypeId     String
  archetype       StorefrontArchetype @relation(fields: [archetypeId], references: [id])
  tagline         String?
  description     String?       @db.Text
  heroImageUrl    String?
  contactEmail    String?
  contactPhone    String?
  // No address field — physical address sourced from Organization.address.
  // If a storefront-specific address is ever needed (e.g. shopfront ≠ registered office),
  // add it in a follow-on migration at that point.
  socialLinks     Json?         // { facebook?, instagram?, linkedin?, tiktok?, … }
  isPublished     Boolean       @default(false)
  customDomain    String?       // nullable — reserved for EP-STORE-004
  portfolioId     String?       // nullable — future: per-portfolio storefronts
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  sections        StorefrontSection[]
  items           StorefrontItem[]
  bookings        StorefrontBooking[]
  orders          StorefrontOrder[]
  inquiries       StorefrontInquiry[]
  donations       StorefrontDonation[]
}
```

### `StorefrontSection`

Ordered page sections per storefront.

```prisma
model StorefrontSection {
  id           String           @id @default(cuid())
  storefrontId String
  storefront   StorefrontConfig @relation(fields: [storefrontId], references: [id], onDelete: Cascade)
  type         String           // "hero" | "about" | "items" | "team" | "gallery" |
                                // "contact" | "testimonials" | "donate" |
                                // "animals-available" | "custom"
  title        String?
  content      Json             // typed per section type — schema in storefront-templates
  sortOrder    Int              @default(0)
  isVisible    Boolean          @default(true)
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt

  @@index([storefrontId, sortOrder])
}
```

### `StorefrontItem`

Customer-facing products, services, or offerings.

```prisma
model StorefrontItem {
  id             String           @id @default(cuid())
  itemId         String           @unique
  storefrontId   String
  storefront     StorefrontConfig @relation(fields: [storefrontId], references: [id], onDelete: Cascade)
  name           String
  description    String?          @db.Text
  category       String?
  priceAmount    Decimal?
  priceCurrency  String           @default("GBP")
  priceType      String?          // "fixed"|"from"|"per-hour"|"per-session"|"free"|"donation"|"quote"
  imageUrl       String?
  ctaType        String           // inherits from archetype, overridable per item
  ctaLabel       String?          // "Book Now", "Buy", "Get a Quote", "Donate", "Enquire"
  bookingConfig  Json?            // { durationMinutes, leadTimeDays, bufferMinutes }
  isActive       Boolean          @default(true)
  sortOrder      Int              @default(0)
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt

  @@index([storefrontId, isActive, sortOrder])
}
```

### Transaction models

All four use **soft item references** — `itemId` is stored as a plain string, not a FK with cascade. This preserves historical transaction records if an item is later deleted. The server actions that create transactions must validate that the `storefrontId` belongs to a published storefront (`isPublished: true`) before writing.

All four include `createdAt`/`updatedAt` to support inbox date columns and date-range filtering.

`customerContactId` is nullable — unauthenticated submissions store `customerEmail` only. Records can be linked post-signup by matching email to `CustomerContact.email`.

#### `StorefrontBooking`
```prisma
model StorefrontBooking {
  id                String    @id @default(cuid())
  bookingRef        String    @unique   // format: "BK-XXXXXXXX"
  storefrontId      String
  storefront        StorefrontConfig @relation(fields: [storefrontId], references: [id])
  itemId            String            // soft ref — no FK cascade
  customerContactId String?           // nullable FK to CustomerContact
  customerEmail     String
  customerName      String
  customerPhone     String?
  scheduledAt       DateTime
  durationMinutes   Int
  notes             String?   @db.Text
  status            String    @default("pending")  // pending|confirmed|cancelled|completed
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([storefrontId, status])
  @@index([customerEmail])
  @@index([scheduledAt])
}
```

#### `StorefrontOrder`
```prisma
model StorefrontOrder {
  id                String    @id @default(cuid())
  orderRef          String    @unique   // format: "ORD-XXXXXXXX"
  storefrontId      String
  storefront        StorefrontConfig @relation(fields: [storefrontId], references: [id])
  customerContactId String?
  customerEmail     String
  items             Json      // [{ itemId, name, qty, unitPrice, currency }] — immutable snapshot
  totalAmount       Decimal
  currency          String    @default("GBP")
  status            String    @default("pending")  // pending|confirmed|fulfilled|cancelled
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([storefrontId, status])
  @@index([customerEmail])
}
```

#### `StorefrontInquiry`
```prisma
model StorefrontInquiry {
  id                String    @id @default(cuid())
  inquiryRef        String    @unique   // format: "INQ-XXXXXXXX"
  storefrontId      String
  storefront        StorefrontConfig @relation(fields: [storefrontId], references: [id])
  itemId            String?           // soft ref — nullable for general inquiries
  customerContactId String?
  customerEmail     String
  customerName      String
  customerPhone     String?
  message           String?   @db.Text
  formData          Json?             // archetype-specific additional fields
  status            String    @default("new")  // new|in-review|responded|closed
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([storefrontId, status])
  @@index([customerEmail])
}
```

#### `StorefrontDonation`
```prisma
model StorefrontDonation {
  id                String    @id @default(cuid())
  donationRef       String    @unique   // format: "DON-XXXXXXXX"
  storefrontId      String
  storefront        StorefrontConfig @relation(fields: [storefrontId], references: [id])
  customerContactId String?
  donorEmail        String
  donorName         String?
  amount            Decimal
  currency          String    @default("GBP")
  campaignId        String?
  message           String?   @db.Text
  isAnonymous       Boolean   @default(false)
  status            String    @default("pending")  // pending|received|acknowledged
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([storefrontId, status])
  @@index([donorEmail])
}
```

---

## 5. New Package: `packages/storefront-templates`

TypeScript package consumed by `apps/web` and (later) the AI Coworker setup agent (EP-STORE-002).

### Structure

```
packages/storefront-templates/
  src/
    types.ts              — ArchetypeDefinition, SectionTemplate, ItemTemplate, FormField,
                            SectionContentSchema per type
    archetypes/
      index.ts            — exports all archetypes as flat array
      healthcare-wellness.ts
      beauty-personal-care.ts
      trades-maintenance.ts
      professional-services.ts
      education-training.ts
      pet-services.ts
      food-hospitality.ts
      retail-goods.ts
      fitness-recreation.ts
      nonprofit-community.ts
    sections/
      schemas.ts          — typed content schemas per section type
    seed.ts               — flat array for DB seeding; consumed by migration seed script
  package.json
  tsconfig.json
```

### Archetype catalog (~35 archetypes)

| Category | Archetypes | Primary CTA |
|---|---|---|
| Healthcare & Wellness | `veterinary-clinic`, `dental-practice`, `physiotherapy`, `counselling`, `optician` | `booking` |
| Beauty & Personal Care | `hair-salon`, `barber-shop`, `nail-salon`, `beauty-spa`, `personal-trainer` | `booking` |
| Trades & Maintenance | `facilities-maintenance`, `plumber`, `electrician`, `cleaning-service`, `landscaping` | `inquiry` |
| Professional Services | `it-managed-services`, `legal-services`, `accounting`, `marketing-agency`, `consulting` | `inquiry` |
| Education & Training | `corporate-training`, `tutoring`, `music-school`, `driving-school` | `purchase` + `inquiry` |
| Pet Services | `pet-grooming`, `pet-care`, `kennel` | `booking` |
| Food & Hospitality | `restaurant`, `catering`, `bakery` | `booking` / `inquiry` / `purchase` |
| Retail & Goods | `retail-goods`, `artisan-goods`, `florist` | `purchase` |
| Fitness & Recreation | `gym`, `yoga-studio`, `dance-studio` | `purchase` + `booking` |
| Non-profit & Community | `pet-rescue`, `animal-shelter`, `community-shelter`, `charity`, `sports-club` | `donation` + `inquiry` |

Each archetype exports:
- 4–8 seed `itemTemplates` (name, description, priceType hint, optional ctaType override)
- Ordered `sectionTemplates` tailored to business type (e.g. `pet-rescue` gets `animals-available` + `donate`; `restaurant` gets `gallery` + `booking`)
- `formSchema` — archetype-specific inquiry/booking form fields

---

## 6. Route Architecture

### New route group

```
apps/web/app/
  (storefront)/
    s/
      [slug]/
        layout.tsx              — public shell; fetches StorefrontConfig by org slug;
                                  injects CSS vars; 404 if storefront not published
        page.tsx                — home; renders StorefrontSection[] in sortOrder
        item/
          [itemId]/
            page.tsx            — item detail + CtaButton
        book/
          [itemId]/
            page.tsx            — booking flow: date picker → customer form → confirm
        inquire/
          page.tsx              — general storefront inquiry (no item)
          [itemId]/
            page.tsx            — item-specific inquiry form
        cart/
          page.tsx              — cart (purchase CTA; client component with CartProvider)
        checkout/
          page.tsx              — confirmation page (see §8 for URL contract)
        donate/
          page.tsx              — donation page (nonprofit archetypes)
        sign-in/
          page.tsx              — unified sign-in (two-step email detection)
        sign-up/
          page.tsx              — new customer registration
```

**Item-specific inquiry URL:** The item detail page (`item/[itemId]/page.tsx`) links inquiry CTAs to `/s/[slug]/inquire/[itemId]`. The general inquiry CTA (storefront-level) links to `/s/[slug]/inquire`.

**Checkout URL contract:** All four transaction types post to server actions that write the transaction record and redirect to:
```
/s/[slug]/checkout?ref=BK-XXXXXXXX&type=booking
/s/[slug]/checkout?ref=ORD-XXXXXXXX&type=order
/s/[slug]/checkout?ref=INQ-XXXXXXXX&type=inquiry
/s/[slug]/checkout?ref=DON-XXXXXXXX&type=donation
```
The confirmation page reads `ref` + `type` from `searchParams`, fetches the matching transaction record (validated against the storefront slug), and renders the appropriate confirmation content.

### Shell admin routes (inside existing `(shell)`)

```
(shell)/storefront/
  page.tsx                      — dashboard (stats tiles, live link, publish toggle)
  setup/
    page.tsx                    — first-time archetype wizard (3 steps; redirects to /storefront if config exists)
  sections/
    page.tsx                    — section manager (reorder, show/hide, inline edit)
  items/
    page.tsx                    — items manager (CRUD table)
  inbox/
    page.tsx                    — unified transaction inbox (all four types)
  settings/
    page.tsx                    — tagline, hero image, contact info, social links, slug
```

---

## 7. Middleware & Route Isolation

```
/s/*                          → always public; no session required; never resolves to (shell)
/portal/*                     → customer session required (type "customer"); else redirect to
                                /s/[org.slug]/sign-in — slug resolved from single Organization record
/customer-login               → 301 redirect to /s/[org.slug]/sign-in
/customer-signup              → 301 redirect to /s/[org.slug]/sign-up
/customer-link-account        → redirect preserved; internal redirect targets updated to storefront paths
/customer-complete-profile    → redirect preserved; internal redirect targets updated to storefront paths
/(shell)/*                    → employee session required (User table); else → /login
/api/storefront/*             → public; rate-limited; no auth token required
/api/*                        → existing employee auth; unchanged
```

**Slug resolution for unauthenticated redirects:** The `/customer-login` and `/customer-signup` redirects are legacy-bookmark fallbacks — they will be hit rarely. For these cases the middleware performs a single `Organization` DB lookup (one row) to resolve the slug and issues the redirect. No caching is required — this is a low-frequency path, not a hot path. All new customer traffic arrives at `/s/[slug]/*` directly.

An employee with a valid session browsing `/s/*` is allowed — they browse as a member of the public. The sign-in step detects their identity before any credential is accepted.

---

## 8. Unified Sign-in Flow

**`/s/[slug]/sign-in`** — two-step flow:

**Step 1 — Email only:** Visitor submits email. Server action performs two lookups:
1. Check `CustomerContact` table for matching `email`
2. Check `User` table for matching `email`

**Step 2 — Route by result:**

| Email found in | Action |
|---|---|
| `CustomerContact` | Show password field → authenticate → redirect `/portal` |
| `User` | Redirect to `/login?from=storefront&slug=[slug]` — no password entered on storefront |
| Neither | Show "create an account" prompt → link to `/s/[slug]/sign-up` |

Employees never enter their password on the storefront. The redirect to `/login` happens before the password step. No credential cross-contamination.

### `(customer-auth)` cleanup

| Old route | New behaviour |
|---|---|
| `/customer-login` | Server-side: look up single `Organization` record, 301 to `/s/[org.slug]/sign-in`. No email lookup required — single-org install has one canonical storefront. |
| `/customer-signup` | 301 to `/s/[org.slug]/sign-up` using same single-org slug resolution |
| `/customer-link-account` | Kept; internal redirect targets updated from `/customer-login` to `/s/[org.slug]/sign-in` |
| `/customer-complete-profile` | Kept; internal redirect targets updated |

No existing customer sessions are invalidated. Portal auth (`/portal/*`) is unchanged.

---

## 9. Public Data Layer

**`lib/storefront-data.ts`** — server-only module. Rules enforced at module boundary:

- Only returns `StorefrontConfig` where `isPublished: true`
- Only returns `StorefrontItem` where `isActive: true`
- Returns `PublicStorefrontConfig` — explicit allowlist of fields:

```ts
type PublicStorefrontConfig = {
  // from StorefrontConfig
  tagline: string | null
  description: string | null
  heroImageUrl: string | null
  contactEmail: string | null
  contactPhone: string | null
  socialLinks: SocialLinks | null
  archetypeId: string
  // from Organization (via relation)
  orgName: string
  orgSlug: string
  orgLogoUrl: string | null
  orgAddress: StorefrontAddress | null   // sourced from Organization.address
  // from BrandingConfig.tokens (Json) — the data layer extracts the full token tree;
  // the storefront layout injects CSS variables from tokens.palette.* as needed.
  // BrandingConfig is queried via the existing scope: "organization" lookup, not via
  // the new organizationId FK (which is not yet populated until first-run wizard runs).
  brandingTokens: Record<string, unknown> | null
  // resolved
  sections: PublicSection[]
  items: PublicItem[]
}
```

`brandingTokens` gives the storefront layout access to the full token palette. The layout component extracts `tokens.palette.accent` (and any other palette keys) for CSS variable injection. No `primaryColor`/`accentColor` columns exist on `BrandingConfig` — colour data lives in `BrandingConfig.tokens` as a JSON tree.

Fields explicitly excluded: `organizationId`, `portfolioId`, `customDomain`, `isPublished`, `createdAt`, `updatedAt`, `id`, any internal employee/agent/compliance data.

All storefront pages import exclusively from this module. The module never imports from `(shell)` components or internal server modules.

---

## 10. Storefront Admin

### Setup wizard (`/storefront/setup`)

**Re-entry guard:** If `StorefrontConfig` already exists for this organisation, the setup route immediately redirects to `/storefront`. This prevents duplicate record errors on the `organizationId @unique` constraint.

Three steps for new setup:

1. **Pick archetype** — searchable grid by category; each card shows name, CTA type, brief description
2. **Review seeded content** — preview of sections and items from archetype templates; inline edits before committing
3. **Branding basics** — business name (defaults from `Organization.name`), tagline, hero image

On complete:
- Creates `StorefrontConfig` (`isPublished: false`)
- Creates `StorefrontSection[]` from archetype `sectionTemplates`
- Creates `StorefrontItem[]` from archetype `itemTemplates`
- Redirects to `/storefront` dashboard with "Preview your storefront" link and publish button

The wizard is the manual version of what the AI Coworker (EP-STORE-002) will later do conversationally. Both write to the same `StorefrontConfig`, `StorefrontSection`, and `StorefrontItem` tables.

### Dashboard (`/storefront`)

Stats tiles scoped to the archetype CTA type — a booking-only business does not see an Orders tile. Live storefront URL. Publish/unpublish toggle. Recent inbox entries.

### Inbox (`/storefront/inbox`)

Unified feed across all four transaction types, newest first.
- Columns: type badge (`BOOKING` / `ORDER` / `INQUIRY` / `DONATION`), customer name/email, item name, date (`createdAt`), status
- Click opens a detail drawer: all fields + status lifecycle dropdown
- Filters: type, status, date range (uses `createdAt` on all transaction models)

---

## 11. Security

| Concern | Approach |
|---|---|
| Route isolation | Middleware — `/s/*` never resolves to `(shell)` pages |
| Tenant data isolation | Admin queries derive `storefrontId` from session org identity — client-supplied IDs rejected |
| CSRF | Server actions (Next.js built-in CSRF protection) |
| Rate limiting | Storefront transaction server actions rate-limited per IP using existing infrastructure |
| Public data scope | `lib/storefront-data.ts` — `PublicStorefrontConfig` explicit allowlist; no internal fields |
| Guest submissions | `customerContactId` nullable; `customerEmail` required; post-signup linking by email |
| Transaction write guard | Server actions validate `storefront.isPublished === true` before writing any transaction record |
| Orphaned soft refs | Confirmation page validates `ref` param against the storefront slug before rendering; invalid refs return 404 |

---

## 12. Dev & Sandbox

Path-based routing means zero special configuration in development:
- `localhost:3000/s/acme-vet` works immediately
- Middleware isolation testable locally
- No DNS, subdomain proxy, or env vars required for storefront to function
- Custom domain (EP-STORE-004) is gated behind nullable `customDomain` field — no dev impact
- Org slug resolved in middleware from single `Organization` record — same query works in dev, sandbox, and production

---

## 13. Future Epics

| Epic | Scope |
|---|---|
| EP-STORE-002 | AI Coworker-assisted storefront setup — conversational configuration via Build Studio + sandbox pipeline |
| EP-STORE-003 | Booking calendar integration — staff availability, diary blocking, customer reminders |
| EP-STORE-004 | Custom domain / subdomain routing |
| EP-STORE-005 | Payment processing — connect orders/bookings to payment gateway |
| EP-STORE-006 | CRM enrichment — `CustomerAccount` industry, size, website from storefront sign-up |
