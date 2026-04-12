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

1. **Storefront Setup Wizard** (`/admin/storefront`) — asks "choose your business type" (StorefrontArchetype), then collects business name, description, target market, company size, geographic scope, and CTA type. Creates a `StorefrontConfig` and populates `BusinessContext`.

2. **Business Models admin page** (`/admin/business-models`) — lists 8 built-in operating model templates (SaaS, Marketplace, E-commerce, etc.) with governance roles. Allows cloning and creating custom models.

3. **Organization Settings** (`/admin/settings`) — basic org identity (name, contact, address).

The UX collision:
- A new user encounters "Choose your business type" in the Storefront Wizard (Step 6 of 9 in onboarding) and sees things like "Consulting," "Dental Practice," "Hair Salon" — these are **customer-facing portal archetypes**.
- If they then visit Admin > Business Models, they see a completely different "business type" taxonomy: "SaaS / Subscription," "Professional Services / Consulting," "Marketplace / Platform" — these are **product operating models** with governance roles.
- Both claim to be "your business type" but they are answering different questions.
- `BusinessContext` is created as a side-effect of storefront setup (line 119-150 of `route.ts`), making it impossible to have business context without a storefront.
- A business that doesn't need a customer-facing portal (e.g., an internal developer platform) has no path to populate `BusinessContext`.

**Worse still:** Many business types have no "store" at all. An HOA manages a community, not a shop. A consulting firm runs a client portal, not a storefront. A nonprofit has a supporter hub. An internal developer platform has no customer-facing presence whatsoever. Yet today, the only path to telling the platform "what kind of business I am" runs through the Storefront Wizard — a page whose very name says "you sell things."

**Net effect:** Users perceive the platform as confused about what their business is. Two separate "business type" concepts with overlapping vocabulary create cognitive overhead and erode trust. Businesses without a traditional "store" feel like second-class citizens.

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

2. **Forcing all businesses through storefront setup**: Square doesn't force every merchant to set up an online store. Wix doesn't force every user to pick a shop template. The assumption that every business needs a "store" is retail-centric — an HOA managing assessments and community announcements, a consulting firm nurturing client relationships, and an internal DevOps team running a platform for developers all need business context but have no use for a storefront wizard.

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
- Works for every type of business — HOAs, consulting firms, nonprofits, internal platforms, and traditional retail alike
- `BusinessContext` becomes genuinely canonical, not a storefront side-effect
- Existing data models stay intact — no schema changes needed
- Portal-free businesses get full AI coworker context without pretending they have a "store"
- The portal step becomes optional: skip it entirely if your business has no customer-facing web presence

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

1. The word "business type" should never appear in the UI without disambiguation.
2. The word "storefront" should never appear as a generic label — use "portal" or the vocabulary-specific label (Community Portal, Client Portal, Supporter Hub, etc.).
3. Portal creation is always optional. The platform must never imply that every business needs one.

**Prompts by context:**

- "Tell us about your business" → populates `BusinessContext` (universal — every business)
- "Do your customers need an online portal?" → gates `StorefrontConfig` creation (optional — only if applicable)
- "Choose your portal template" → selects `StorefrontArchetype` (only if they said yes above)
- "What operating model does this product follow?" → assigns `BusinessModel` (product-level, separate concern)

### 5.2 Information Architecture

```text
Onboarding Flow (revised):
  Step 1: Account Bootstrap        → Organization, User
  Step 2: AI Providers             → ProviderConfig
  Step 3: Branding                 → BrandingConfig
  Step 4: Your Business (NEW)      → BusinessContext, Organization.industry
  Step 5: Your Portal (OPTIONAL)   → StorefrontConfig (pre-filled from BusinessContext)
  Step 6: Operating Hours           → BusinessProfile
  Step 7: Platform Development     → ContributionConfig
  Step 8: Build Studio             → (tour)
  Step 9: Workspace                → (tour)
```

The old "org-settings" step is absorbed into "Your Business." The old "operating-hours" step stays but the setup step count stays at 9 (we removed one, added one).

**The key insight:** Step 4 is the universal step — every business completes it. Step 5 is conditional. A hair salon, restaurant, or retail shop will configure a portal. An HOA *might* set up a Community Portal for homeowner self-service, or might skip it. An internal dev platform or back-office consultancy will skip it entirely. In all cases the AI coworker has full business context from Step 4.

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

#### Step 5: "Your Portal" (optional — revised storefront wizard)

Not every business needs a customer-facing web portal. This step is explicitly **optional** and the onboarding overlay communicates this clearly:

| Business Type | Portal? | What They See |
| ------------- | ------- | ------------- |
| Hair salon, restaurant, yoga studio | Yes — booking portal | Choose template, preview, configure |
| Retail shop, florist, bakery | Yes — storefront | Choose template, preview, configure |
| HOA, property management | Maybe — community portal | "Set up a Community Portal for homeowners, or skip if you manage communications elsewhere" |
| Consulting, legal, accounting | Maybe — client portal | "Set up a Client Portal, or skip if you use external CRM/scheduling" |
| Nonprofit, charity | Maybe — supporter hub | "Set up a Supporter Hub for donations and updates, or skip" |
| Internal dev platform, API service | No | "Your business doesn't need a customer portal — skip this step" |

**Changes from current wizard:**
- Step 1 ("Choose your business type") becomes "Choose your portal template" with archetype pre-selected from `BusinessContext.industry`
- Step 3 ("Your business identity") is **removed** — this data was already collected in Step 4
- Wizard steps become: Choose Template → Preview → Financial Setup (3 steps, down from 4)
- Business name, description, size, scope are read from `BusinessContext` (not collected again)
- Only portal-specific fields remain: URL slug, tagline, hero image
- The portal vocabulary from EP-STORE-006 drives all labels: an HOA sees "Community Portal" not "Storefront," a nonprofit sees "Supporter Hub," etc.

**Skip behavior:** If the user doesn't need a portal, they skip Step 5 entirely. `BusinessContext` still exists and provides full AI coworker context — the coworker knows what the business does, who it serves, and how it operates, regardless of whether a portal exists. This is critical: an HOA board member should be able to ask the AI coworker to "draft a special assessment notice" without ever having configured a "storefront."

### 5.4 What Stays Separate in the Data Model and Why

| Model | Stays Separate | Reason |
|-------|---------------|--------|
| `BusinessContext` | Yes | Strategic context for AI coworkers. Must exist without a portal. |
| `StorefrontArchetype` | Yes | Portal template blueprint. Different taxonomy from business classification. |
| `StorefrontConfig` | Yes | Portal instance. One org may have **zero** or one portal. Zero is a first-class state — an HOA, internal platform, or consultancy that manages client relationships through other channels simply doesn't create one. |
| `BusinessModel` | Yes | Product governance roles. Entirely different domain (IT4IT, not customer-facing). |
| `BusinessProfile` | Yes | Operational hours/windows. Used by deployment governance, not customer-facing. |
| `Organization` | Yes | Root identity entity. Already canonical. |

**No models are merged.** The fix is in the UX flow and API layer, not the data model. The models were correctly designed — the problem is that `BusinessContext` creation is coupled to `StorefrontConfig` creation in the API route. Decoupling them makes "no portal" a natural, supported state rather than a gap in the data.

### 5.5 Route / Component Changes

| File | Change | Type |
|------|--------|------|
| `apps/web/lib/actions/setup-constants.ts` | Replace `"org-settings"` with `"business-context"` in SETUP_STEPS; update STEP_ROUTES and STEP_LABELS | Modify |
| `apps/web/app/(shell)/admin/business-context/page.tsx` | New page: Business Context editor (quick-edit form for returning users) | Create |
| `apps/web/components/admin/BusinessContextForm.tsx` | New component: form for business description, target market, industry, size, scope | Create |
| `apps/web/app/api/business-context/setup/route.ts` | New API: creates/updates BusinessContext and Organization fields, independent of storefront | Create |
| `apps/web/components/setup/SetupOverlay.tsx` | Update STEP_WELCOME messages for renamed steps | Modify |
| `apps/web/components/storefront-admin/SetupWizard.tsx` | Remove Step 3 (business identity). Read business data from BusinessContext. Reduce to 3 wizard steps. | Modify |
| `apps/web/app/api/storefront/admin/setup/route.ts` | Remove BusinessContext upsert (moved to new endpoint). Read from existing BusinessContext for pre-fill. | Modify |
| `apps/web/components/admin/AdminTabNav.tsx` | Rename "Settings" tab to "Organization"; add/rename entry for "Business Context" if not already present | Modify |
| `apps/web/app/(shell)/admin/settings/page.tsx` | Slim down to pure org identity (name, address, logo). Business strategy fields move to business-context page. | Modify |

### 5.6 Admin Tab Reorganization

Current admin tabs include both "Business Models" and "Settings" without clear hierarchy. After this change:

| Tab | URL | Content |
|-----|-----|---------|
| Access | `/admin` | Access control |
| Branding | `/admin/branding` | Visual identity |
| **Your Business** | `/admin/business-context` | Business description, market, industry, size, scope |
| **Organization** | `/admin/settings` | Legal name, contact, address (slim) |
| Business Models | `/admin/business-models` | Operating model templates + roles |
| Portal | `/admin/storefront` | Customer-facing portal config |
| Operating Hours | `/admin/operating-hours` | Business hours, deployment windows |
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
| Create `/admin/business-context` page (quick-edit for returning users) | `apps/web/app/(shell)/admin/business-context/page.tsx` | S |
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
| Update storefront admin page to pass BusinessContext data to wizard | `apps/web/app/(shell)/admin/storefront/page.tsx` | S |

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
- **Multi-organization support** — out of scope; the platform remains single-org
- **BusinessModel assignment to Organization** — BusinessModels are assigned to DigitalProducts, not orgs; this spec doesn't change that relationship
