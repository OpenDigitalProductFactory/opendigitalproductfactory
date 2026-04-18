# Business Setup Unification — Design Spec

**Date:** 2026-04-11
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Scope:** Refactor the user journey so "business setup" feels like one seamless flow instead of two overlapping ones, while keeping underlying domain models cleanly separated.

**Dependencies:**
- `docs/superpowers/specs/2026-03-26-business-model-roles-design.md` (BusinessModel + roles)
- `docs/superpowers/specs/2026-04-04-business-model-portal-vocabulary-design.md` (portal vocabulary)
- `apps/web/lib/actions/setup-constants.ts` (9-step onboarding)
- `apps/web/components/storefront-admin/SetupWizard.tsx` (storefront setup wizard)
- `apps/web/components/admin/BusinessModelBuilder.tsx` (admin business models page)

---

## 1. Problem Statement

Today the platform has three distinct concepts that all involve "setting up your business":

1. **Storefront Setup Wizard** (`/storefront`) — asks "choose your business type" (StorefrontArchetype), then collects business name, description, target market, company size, geographic scope, and CTA type. Creates a `StorefrontConfig` and populates `BusinessContext`.

2. **Business Models admin page** (`/admin/business-models`) — lists 8 built-in operating model templates (SaaS, Marketplace, E-commerce, etc.) with governance roles. Allows cloning and creating custom models.

3. **Organization Settings** (`/admin/settings`) — basic org identity (name, contact, address).

The UX collision:
- A new user encounters "Choose your business type" in the Storefront Wizard (Step 6 of 9 in onboarding) and sees things like "Consulting," "Dental Practice," "Hair Salon" — these are **customer-facing portal archetypes**.
- If they then visit Admin > Business Models, they see a completely different "business type" taxonomy: "SaaS / Subscription," "Professional Services / Consulting," "Marketplace / Platform" — these are **product operating models** with governance roles.
- Both claim to be "your business type" but they are answering different questions.
- `BusinessContext` is created as a side-effect of storefront setup (line 119-150 of `route.ts`), making it impossible to have business context without a storefront.

**The deeper problem:** This platform targets small businesses, and most of them *do* need an online portal — but for many of them it isn't a "store." An HOA needs a Community Portal where homeowners submit maintenance requests, read bylaws, and pay assessments — homeowners aren't customers and assessments aren't products. A consulting firm needs a Client Portal for project updates and document sharing — clients aren't shoppers. A nonprofit needs a Supporter Hub for donations and volunteer sign-ups — supporters aren't buyers. Every one of these businesses needs a portal, but the Storefront Wizard's vocabulary ("Choose your business type," "Items / Services," "CTA type") frames the entire experience through a retail lens that doesn't fit.

**Net effect:** Users perceive the platform as confused about what their business is. Two separate "business type" concepts with overlapping vocabulary create cognitive overhead and erode trust. Non-retail businesses feel like they're being shoehorned into a shopkeeper's setup flow when their relationship with their stakeholders is fundamentally different.

---

## 2. Current-State Analysis

### 2.1 Data Flow Today

```
Onboarding Step 6: "Storefront"
  └── SetupWizard.tsx
       ├── Step 1: Pick StorefrontArchetype (e.g., "Consulting")
       ├── Step 2: Preview sections/items
       ├── Step 3: Business identity (name, description, size, scope)
       ├── POST /api/storefront/admin/setup
       │    ├── Creates StorefrontConfig (portal config)
       │    ├── Upserts BusinessContext (business strategy context)
       │    ├── Updates Organization.industry
       │    └── Seeds ServiceProvider, availability, booking config
       └── Step 4: Financial setup

Admin > Business Models (separate, later):
  └── BusinessModelBuilder.tsx
       ├── View 8 built-in templates (SaaS, Marketplace, etc.)
       ├── Clone / Create custom models
       └── Assign to DigitalProduct (via product detail page)
```

### 2.2 Models and Their True Purposes

| Model | True Purpose | Currently Populated By |
|-------|-------------|----------------------|
| `Organization` | Legal/operational identity (name, slug, address, logo) | Account bootstrap (Step 1), org settings |
| `BusinessContext` | Strategic context: what the business does, who it serves, how it makes money | Storefront wizard (side-effect only) |
| `StorefrontArchetype` | Customer-facing portal template (sections, items, CTA type, vocabulary) | Seed data + custom creation |
| `StorefrontConfig` | Portal instance configuration (design, sections, items, booking) | Storefront wizard |
| `BusinessModel` | Product operating model template with governance roles | Seed data + admin CRUD |
| `BusinessProfile` | Operational profile (hours, deployment windows, blackouts) | Seed data + operating hours step |

### 2.3 The Overlap

The Storefront Wizard collects data that belongs to three different domains:

| Wizard Field | Actual Domain | Should Live On |
|-------------|---------------|---------------|
| Business name | Organization identity | `Organization.name` (already updates it) |
| URL slug | Portal configuration | `StorefrontConfig` (via Organization) |
| Business description | Business strategy | `BusinessContext.description` |
| Target market | Business strategy | `BusinessContext.targetMarket` |
| Company size | Business strategy | `BusinessContext.companySize` |
| Geographic scope | Business strategy | `BusinessContext.geographicScope` |
| Archetype selection | Portal template | `StorefrontConfig.archetypeId` |
| Tagline | Portal presentation | `StorefrontConfig.tagline` |
| Hero image | Portal presentation | `StorefrontConfig.heroImageUrl` |

The wizard conflates "tell us about your business" with "configure your customer portal." For an HOA, a law firm, or an internal IT team, the entire storefront wizard is the wrong frame — they shouldn't have to think in terms of "items," "CTA types," or "hero images" just to tell the platform what their organization does.

---

## 3. Research & Benchmarking

### 3.1 Systems Compared

| Platform | Architecture | Key Pattern |
|----------|-------------|-------------|
| **Shopify** | Unified `Shop` object, setup guide with adaptive checklist | Business type question → feature activation, single entity |
| **Wix** | Progressive questionnaire → template recommendation | Business profile as selector, not destination |
| **Square** | `Merchant` (identity) + `Location` (operational context) | Two-tier: thin identity + rich operational config |
| **Medusa v2** | `Store` (identity) + `SalesChannel` (storefront) + `Region` (operations) | Strict module isolation, cross-module links |
| **Vendure** | `Seller` (identity) + `Channel` (storefront/operations) | Seller is deliberately thin; Channel carries config |

### 3.2 Patterns Adopted

1. **Two-tier identity pattern** (Square, Medusa, Vendure): Separate the thin business identity entity from rich operational/storefront configuration. DPF already has this with `Organization` + `StorefrontConfig`, but `BusinessContext` is trapped as a storefront side-effect.

2. **Business classification drives feature activation** (Shopify, Wix): The "what kind of business are you?" question should inform downstream configuration, not be collected redundantly in multiple places.

3. **Progressive questionnaire before template selection** (Wix): Understand the business first, then recommend the right portal archetype — not the other way around.

### 3.3 Patterns Rejected

1. **Shopify's unified `Shop`**: Combining everything into one entity creates coupling. DPF's multi-model approach is correct for a platform that must support diverse operating models.

2. **Store-centric vocabulary for non-store businesses**: Square's onboarding adapts based on business vertical — a restaurant sees "menu items," not "products." Wix's questionnaire understands the business before recommending a template. The assumption that every portal is a "storefront" with "items" and "customers" breaks down for HOAs (homeowners, assessments, bylaws), consultancies (clients, engagements, deliverables), and nonprofits (supporters, campaigns, donations). The portal vocabulary spec (EP-STORE-006) already defines the right labels — the setup flow needs to use them from the start.

### 3.4 Anti-Patterns Avoided

1. **Conflating business identity with storefront config** — the current bug
2. **Making strategic context dependent on portal creation** — the current dependency
3. **Using the same "business type" label for two different taxonomies** — the current vocabulary collision

---

## 4. Proposed Approaches

### Approach A: "Business Context First" (Recommended)

**Principle:** Decouple `BusinessContext` creation from storefront setup. Make it the first thing collected — before the storefront wizard, before business models.

**Changes:**
- Add a new "Business Profile" step to onboarding (before Storefront) that creates `BusinessContext` independently
- Storefront wizard reads from `BusinessContext` to pre-select the archetype and pre-fill fields
- Business Models admin page links to `BusinessContext.industry` for suggested model matching
- Clear terminology: "Your Business" vs "Your Portal" vs "Your Operating Model"

**Pros:**
- Cleanest separation of concerns
- Works for every type of small business — HOAs, consulting firms, nonprofits, and traditional retail alike
- `BusinessContext` becomes genuinely canonical, not a storefront side-effect
- The portal step inherits the right vocabulary from day one: an HOA sees "Set up your Community Portal" not "Set up your Storefront"
- Existing data models stay intact — no schema changes needed
- AI coworker gets full business context before the portal exists, so it can assist with portal setup itself

**Cons:**
- Adds one more setup step (mitigated by collapsing operating-hours into it)
- Users see business questions twice if they also do storefront setup (mitigated by pre-filling)

### Approach B: "Unified Wizard with Sections"

**Principle:** Keep the storefront wizard but restructure it into clearly labeled phases: "About Your Business" → "Your Portal" → "Financial Setup."

**Changes:**
- Restructure SetupWizard.tsx into three phases with clear headers
- Phase 1 (Business) creates `BusinessContext` via a separate API endpoint
- Phase 2 (Portal) creates `StorefrontConfig` using data from Phase 1
- Phase 3 (Finance) stays the same

**Pros:**
- Fewer navigation steps — feels like one flow
- Familiar pattern for users who expect a wizard

**Cons:**
- Still couples business context to the storefront flow (can't have one without starting the other)
- Doesn't solve the portal-free business scenario
- Wizard grows longer

### Approach C: "AI-Guided Single Conversation"

**Principle:** Replace the wizard with a conversational onboarding via the AI coworker. User describes their business in natural language; the system extracts business context, suggests an archetype, and configures everything.

**Changes:**
- Remove the storefront wizard
- Add a conversational setup prompt to the COO agent
- Agent creates `BusinessContext`, suggests `StorefrontArchetype`, and configures `StorefrontConfig`

**Pros:**
- Most natural UX — progressive disclosure at its finest
- Matches the platform's AI-native positioning

**Cons:**
- Requires reliable local AI (which we don't always have)
- Non-deterministic outcomes
- Hard to "re-run" or modify specific fields
- Significantly more complex to build and test

---

## 5. Recommended Approach: A — "Business Context First"

### 5.1 Canonical Terminology

To eliminate the vocabulary collision, establish clear terminology:

| Concept | Label (UI) | Label (Admin) | Data Model | Domain |
|---------|-----------|--------------|------------|--------|
| What your business is | "Your Business" | Business Context | `BusinessContext` | Strategy |
| Your customer-facing portal | "Your Portal" | Portal / Storefront | `StorefrontConfig` + `StorefrontArchetype` | Customer delivery |
| Your product operating model | "Operating Model" | Business Models | `BusinessModel` + `BusinessModelRole` | Governance |
| Your organization | "Organization" | Organization | `Organization` | Identity |
| Your operational hours | "Operating Hours" | Business Profile | `BusinessProfile` | Operations |

**Key rules:**

1. The phrase "business type" must never appear in the UI without disambiguation.
2. The word "storefront" must never appear as a generic label — use the vocabulary-specific label from EP-STORE-006 (Community Portal, Client Portal, Supporter Hub, Booking Portal, Storefront, etc.). Only actual retail businesses see the word "Storefront."
3. The word "customer" must never be used generically for portal users. HOA portals serve **homeowners**, consulting portals serve **clients**, nonprofit portals serve **supporters**. The stakeholder label comes from the archetype vocabulary.

**Prompts by context:**

- "Tell us about your business" → populates `BusinessContext` (universal — every small business)
- "Set up your [Community Portal / Client Portal / Storefront / ...]" → creates `StorefrontConfig` using vocabulary from `BusinessContext`
- "What operating model does this product follow?" → assigns `BusinessModel` (product-level, separate concern)

### 5.2 Information Architecture

```text
Onboarding Flow (revised):
  Step 1: Account Bootstrap        → Organization, User
  Step 2: AI Providers             → ProviderConfig
  Step 3: Branding                 → BrandingConfig
  Step 4: Your Business (NEW)      → BusinessContext, Organization.industry
  Step 5: Your Portal (ADAPTED)    → StorefrontConfig (vocabulary from BusinessContext)
  Step 6: Operating Hours           → BusinessProfile
  Step 7: Platform Development     → ContributionConfig
  Step 8: Build Studio             → (tour)
  Step 9: Workspace                → (tour)
```

The old "org-settings" step is absorbed into "Your Business." The old "operating-hours" step stays. The setup step count stays at 9 (we removed one, added one).

**The key insight:** Step 4 is the universal step — every small business completes it. Step 5 then adapts: a hair salon sees "Set up your Booking Portal," an HOA sees "Set up your Community Portal," a nonprofit sees "Set up your Supporter Hub." The business already told the platform who its stakeholders are (homeowners, clients, supporters, customers) so the portal wizard speaks their language instead of defaulting to retail.

### 5.3 Proposed Setup Flow

#### Step 4: "Your Business"

**Collects:**
- Business description (what you do) — `BusinessContext.description`
- Target market (who you serve) — `BusinessContext.targetMarket`
- Industry category — `BusinessContext.industry`, `Organization.industry`
- Company size — `BusinessContext.companySize`
- Geographic scope — `BusinessContext.geographicScope`
- Revenue model hint (how you make money) — `BusinessContext.revenueModel`
- Contact details (email, phone) — `Organization.email`, `Organization.phone`

**Smart defaults:** Pre-fill industry from branding URL analysis (already in `SetupContext.suggestedArchetypeId`). Map archetype categories to industry values.

**API endpoint:** New `POST /api/business-context/setup` that creates/updates `BusinessContext` and `Organization` fields without touching `StorefrontConfig`.

#### Step 5: "Your Portal" (revised storefront wizard)

Because `BusinessContext` already exists from Step 4, the portal wizard can now speak the business's own language from the very first screen. The archetype is pre-selected, and the vocabulary adapts to the stakeholder relationship — not a generic "storefront" frame:

| Business Type | Portal Label | Stakeholders | What They See |
| ------------- | ------------ | ------------ | ------------- |
| Hair salon, yoga studio, dentist | Booking Portal | Clients, Patients | "Set up your Booking Portal — let clients book appointments online" |
| Restaurant, catering | Venue Portal | Guests, Diners | "Set up your Venue Portal — let guests reserve tables and view menus" |
| Retail shop, florist, bakery | Storefront | Customers | "Set up your Storefront — showcase products and take orders" |
| HOA, property management | Community Portal | Homeowners | "Set up your Community Portal — homeowners can submit issues, read bylaws, and pay assessments" |
| Consulting, legal, accounting | Client Portal | Clients | "Set up your Client Portal — clients can view engagements and request services" |
| Nonprofit, charity, pet rescue | Supporter Hub | Supporters, Donors | "Set up your Supporter Hub — accept donations and share impact updates" |
| Education, tutoring, music school | Academy Portal | Students | "Set up your Academy Portal — students can enrol and access course materials" |

**Changes from current wizard:**
- Step 1 ("Choose your business type") becomes "Choose your portal template" with archetype pre-selected from `BusinessContext.industry`
- Step 3 ("Your business identity") is **removed** — this data was already collected in Step 4
- Wizard steps become: Choose Template → Preview → Financial Setup (3 steps, down from 4)
- Business name, description, size, scope are read from `BusinessContext` (not collected again)
- Only portal-specific fields remain: URL slug, tagline, hero image
- The portal vocabulary from EP-STORE-006 drives all labels: an HOA sees "Community Portal" not "Storefront," a nonprofit sees "Supporter Hub," etc.

**The difference from today:** An HOA board member no longer sees "Choose your business type" above a grid of retail-flavoured archetype cards. Instead, the platform already knows from Step 4 that this is an HOA. Step 5 opens with "Set up your Community Portal" and shows homeowner-relevant sections (Assessments, Maintenance Requests, Bylaws) — not "Items / Services" and "Hero Image." The vocabulary from EP-STORE-006 is applied from the first screen, not retrofitted after setup.

### 5.4 What Stays Separate in the Data Model and Why

| Model | Stays Separate | Reason |
|-------|---------------|--------|
| `BusinessContext` | Yes | Strategic context for AI coworkers. Must exist without a portal. |
| `StorefrontArchetype` | Yes | Portal template blueprint. Different taxonomy from business classification. |
| `StorefrontConfig` | Yes | Portal instance. One org has one portal, but the portal's vocabulary, sections, and stakeholder framing vary radically by business type. |
| `BusinessModel` | Yes | Product governance roles. Entirely different domain (IT4IT, not customer-facing). |
| `BusinessProfile` | Yes | Operational hours/windows. Used by deployment governance, not customer-facing. |
| `Organization` | Yes | Root identity entity. Already canonical. |

**No models are merged.** The fix is in the UX flow and API layer, not the data model. The models were correctly designed — the problem is that `BusinessContext` creation is coupled to `StorefrontConfig` creation in the API route. Decoupling them means the portal wizard can inherit the right vocabulary and stakeholder framing from the business context instead of collecting business identity from scratch through a retail-centric lens.

### 5.5 Route / Component Changes

| File | Change | Type |
|------|--------|------|
| `apps/web/lib/actions/setup-constants.ts` | Replace `"org-settings"` with `"business-context"` in SETUP_STEPS; update STEP_ROUTES and STEP_LABELS | Modify |
| `apps/web/app/(shell)/storefront/settings/business/page.tsx` | New canonical page: Business Context editor (quick-edit form for returning users) | Create |
| `apps/web/components/admin/BusinessContextForm.tsx` | New component: form for business description, target market, industry, size, scope | Create |
| `apps/web/app/api/business-context/setup/route.ts` | New API: creates/updates BusinessContext and Organization fields, independent of storefront | Create |
| `apps/web/components/setup/SetupOverlay.tsx` | Update STEP_WELCOME messages for renamed steps | Modify |
| `apps/web/components/storefront-admin/SetupWizard.tsx` | Remove Step 3 (business identity). Read business data from BusinessContext. Reduce to 3 wizard steps. | Modify |
| `apps/web/app/api/storefront/admin/setup/route.ts` | Remove BusinessContext upsert (moved to new endpoint). Read from existing BusinessContext for pre-fill. | Modify |
| `apps/web/components/admin/AdminTabNav.tsx` | Rename "Settings" tab to "Organization"; add/rename entry for "Business Context" if not already present | Modify |
| `apps/web/app/(shell)/admin/settings/page.tsx` | Slim down to pure org identity (name, address, logo). Business strategy fields move to business-context page. | Modify |

### 5.6 Business + Admin Navigation Reorganization

Current admin tabs include both "Business Models" and "Settings" without clear hierarchy. After the storefront/business consolidation, the business-operational entries live under the canonical `/storefront` workspace while Admin keeps governance/configuration concerns:

| Tab | URL | Content |
|-----|-----|---------|
| Access | `/admin` | Access control |
| Branding | `/admin/branding` | Visual identity |
| **Your Business** | `/storefront/settings/business` | Business description, market, industry, size, scope |
| **Organization** | `/admin/settings` | Legal name, contact, address (slim) |
| Business Models | `/admin/business-models` | Operating model templates + roles |
| Portal | `/storefront` | Customer-facing portal config |
| Operating Hours | `/storefront/settings/operations` | Business hours, deployment windows |
| Platform Dev | `/admin/platform-development` | Contribution mode |
| Prompts | `/admin/prompts` | AI prompt management |
| Skills | `/admin/skills` | Skill definitions |
| Issue Reports | `/admin/issue-reports` | Issue tracking |

**Note:** "Storefront" tab label should be dynamic per portal vocabulary spec (EP-STORE-006). For now, "Portal" is a safer default than "Storefront" given the vocabulary design already in progress.

---

## 6. Migration / Backward Compatibility

### 6.1 Data Migration

**None required.** The `BusinessContext` model already exists and has the right fields. The change is in *when* and *how* it gets populated, not its structure.

For existing installations where `BusinessContext` was created via the storefront wizard: the data is already correct. The new "Your Business" step will detect an existing `BusinessContext` and show the quick-edit form instead of the wizard.

### 6.2 Setup Progress Migration

Existing `PlatformSetupProgress` records have `steps` JSON with `"org-settings"` as a key. The step rename to `"business-context"` requires a one-time migration:

```sql
-- Rename step key in existing setup progress records
UPDATE "PlatformSetupProgress"
SET steps = steps - 'org-settings' || jsonb_build_object('business-context', steps->'org-settings')
WHERE steps ? 'org-settings';
```

This can be a data-only migration or applied in the setup-progress loader as a runtime normalization (check for old key, treat as new key).

### 6.3 API Compatibility

- `POST /api/storefront/admin/setup` continues to work but no longer creates `BusinessContext`. If `BusinessContext` doesn't exist when this endpoint is called, it falls back to creating one (backward-compatible).
- New `POST /api/business-context/setup` endpoint is additive.

---

## 7. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Users feel the new step is redundant if they plan to set up a portal | Medium | Low | Pre-fill portal wizard from BusinessContext; "skip" available |
| Existing users who already completed setup see a new "incomplete" step | Medium | Medium | Detect existing BusinessContext and auto-mark step as complete |
| Portal vocabulary rename (Storefront → Portal) creates confusion during transition | Low | Low | Phase the label change; keep URL paths as `/storefront` per EP-STORE-006 |
| BusinessModel admin page still feels disconnected from business setup | Low | Low | Add a contextual link: "Your business is classified as [industry]. See operating model templates that match." |
| Setup step count stays at 9 despite removing one — users may feel it's long | Low | Low | The steps are skipable; the overlay makes progress visible |

---

## 8. Phased Implementation Plan

### Phase 1: Decouple BusinessContext (P0 — Foundation)

**Goal:** BusinessContext can be created independently of StorefrontConfig.

| Task | File(s) | Effort |
|------|---------|--------|
| Create `POST /api/business-context/setup` endpoint | `apps/web/app/api/business-context/setup/route.ts` | S |
| Create `BusinessContextForm.tsx` component | `apps/web/components/admin/BusinessContextForm.tsx` | M |
| Create canonical business settings page (quick-edit for returning users) | `apps/web/app/(shell)/storefront/settings/business/page.tsx` | S |
| Update `setup-constants.ts`: rename `org-settings` → `business-context`, update routes/labels | `apps/web/lib/actions/setup-constants.ts` | S |
| Update `SetupOverlay.tsx`: new welcome message for `business-context` step | `apps/web/components/setup/SetupOverlay.tsx` | S |
| Add migration to rename step key in existing `PlatformSetupProgress` | `packages/db/prisma/migrations/` | S |

### Phase 2: Slim Down Storefront Wizard (P1 — UX Cleanup)

**Goal:** Storefront wizard no longer collects business identity. Reads from BusinessContext.

| Task | File(s) | Effort |
|------|---------|--------|
| Refactor `SetupWizard.tsx`: remove Step 3 (business identity fields) | `apps/web/components/storefront-admin/SetupWizard.tsx` | M |
| Update `route.ts`: remove BusinessContext upsert; read existing BusinessContext for defaults | `apps/web/app/api/storefront/admin/setup/route.ts` | M |
| Pre-select archetype from `BusinessContext.industry` mapping | `apps/web/components/storefront-admin/SetupWizard.tsx` | S |
| Update storefront page to pass BusinessContext data to wizard | `apps/web/app/(shell)/storefront/page.tsx` | S |

### Phase 3: Terminology & Navigation (P1 — Polish)

**Goal:** Clear vocabulary; no "business type" ambiguity.

| Task | File(s) | Effort |
|------|---------|--------|
| Update `AdminTabNav.tsx`: rename "Settings" → "Organization"; add "Your Business" tab | `apps/web/components/admin/AdminTabNav.tsx` | S |
| Rename storefront wizard Step 1 heading: "Choose your business type" → "Choose your portal template" | `apps/web/components/storefront-admin/SetupWizard.tsx` | S |
| Slim `/admin/settings` page to pure org identity (remove business strategy fields if any) | `apps/web/app/(shell)/admin/settings/page.tsx` | S |
| Add contextual link from BusinessContext page to Business Models: "See operating model templates for [industry]" | `apps/web/components/admin/BusinessContextForm.tsx` | S |

### Phase 4: Cross-Linking & Intelligence (P2 — Enhancement)

**Goal:** Business context informs downstream features proactively.

| Task | File(s) | Effort |
|------|---------|--------|
| Suggested BusinessModel matching: show "recommended" badge on models that match BusinessContext.industry | `apps/web/app/(shell)/admin/business-models/page.tsx` | M |
| AI coworker: inject BusinessContext into all route contexts (not just storefront routes) | `apps/web/lib/tak/route-context.ts` | S |
| Build Studio: use BusinessContext for feature ideation prompts | `apps/web/lib/explore/feature-build-data.ts` | S |

---

## 9. What This Does Not Include

- **Merging `BusinessModel` and `StorefrontArchetype`** — these are different domains (governance vs. customer delivery) and must stay separate
- **Renaming `/storefront` URL paths to `/portal`** — deferred to EP-STORE-006 as a breaking change
- **Renaming `StorefrontConfig` to `PortalConfig`** in the database — deferred (requires migration)
- **Conversational onboarding** (Approach C) — too dependent on AI reliability; could be a future enhancement
- **Auto-detecting business type from URL** — already exists in setup context; this spec uses it but doesn't extend it
- **Multi-organization support** — out of scope; the platform targets single small businesses
- **BusinessModel assignment to Organization** — BusinessModels are assigned to DigitalProducts, not orgs; this spec doesn't change that relationship
- **Stakeholder-type data model** — adding `StakeholderType` to CRM models (homeowner vs client vs supporter) is a future schema change noted in EP-STORE-006
