# EP-STORE-005: Archetype-Aware Item Management

**Epic:** Storefront Foundation  
**Status:** Draft  
**Date:** 2026-04-03  
**Author:** AI-assisted (Claude)  
**IT4IT Alignment:** SS5.5 Release (service catalog), SS5.6 Consume (customer-facing delivery)  
**Dependencies:** EP-STORE-001 (Storefront Foundation), EP-STORE-003 (Booking Calendar)

---

## 1. Problem Statement

After initial storefront setup, business owners **cannot manage their offerings**. The current items page is read-only — administrators can only toggle items active/inactive. There is no ability to:

- Create new items (products, services, courses, menu items, campaigns)
- Edit item details (name, description, price, duration, CTA)
- Delete items
- Reorder items
- Set actual prices (only `priceType` is seeded, never `priceAmount`)
- Categorise items (the `category` field exists in the schema but is never populated)
- Upload item images

More critically, the item management experience is **completely generic** — a restaurant owner sees the same table as a tutoring company or a nonprofit. Different business types need fundamentally different management workflows, terminology, and form fields.

## 2. Design Principles

1. **Archetype-first vocabulary** — The UI must speak the business owner's language. A restaurant manages "Menu Items", not "Storefront Items". A training company manages "Courses", not "Products".
2. **CTA-type drives form shape** — Booking items need duration and scheduling fields. Purchase items need price fields. Inquiry items need form customisation. Donation items need goal amounts.
3. **Progressive disclosure** — Show essential fields first, advanced options on expand. Complexity matches the user's patent (US 8,635,592).
4. **Schema-stable** — The existing `StorefrontItem` model is flexible enough. No schema migration required — use existing fields (`category`, `priceAmount`, `imageUrl`, `bookingConfig`) that are currently unpopulated.
5. **Archetype templates as defaults, not constraints** — After setup, users can add items of any CTA type, not just the archetype default.

## 3. Archetype Vocabulary Map

The UI adapts terminology based on the archetype category. This is a static map loaded from the `StorefrontArchetype.category` field.

| Archetype Category | Items Label | Single Item | Add Button | Category Label | Price Label |
|---|---|---|---|---|---|
| `food-hospitality` | Menu | Dish / Item | Add to menu | Course (Starters, Mains...) | Price |
| `education-training` | Courses | Course / Lesson | Add course | Level (Beginner, Intermediate...) | Fee |
| `retail-goods` | Products | Product | Add product | Category | Price |
| `healthcare-wellness` | Services | Treatment / Service | Add service | Department | Fee |
| `beauty-personal-care` | Services | Treatment / Service | Add service | Category | Price |
| `trades-maintenance` | Services | Service | Add service | Trade | Rate |
| `professional-services` | Services | Service | Add service | Practice Area | Fee |
| `pet-services` | Services | Service | Add service | Category | Price |
| `fitness-recreation` | Classes & Memberships | Class / Membership | Add class | Type (Classes, Memberships...) | Fee |
| `nonprofit-community` | Campaigns & Appeals | Campaign / Appeal | Add campaign | Cause | Goal |
| `hoa-property-management` | Services | Service | Add service | Category | Fee |

**Implementation**: A `ARCHETYPE_VOCABULARY` constant in `apps/web/lib/storefront/archetype-vocabulary.ts` keyed by `ArchetypeCategory`.

## 4. CTA-Type Form Fields

Each item's CTA type determines which form fields appear in the create/edit dialog:

### 4.1 Common Fields (all CTA types)

| Field | Type | Required | Notes |
|---|---|---|---|
| Name | text | Yes | Item display name |
| Description | textarea | No | Customer-facing description |
| Category | text (with suggestions) | No | Free-text with archetype-specific suggestions |
| Image | url | No | Item image (URL input; upload deferred to EP-STORE-006) |
| Active | toggle | Yes | Default: true |
| Sort Order | number | No | Drag-to-reorder preferred |

### 4.2 Booking Items (`ctaType: "booking"`)

| Field | Type | Required | Notes |
|---|---|---|---|
| Duration | number (minutes) | Yes | Pre-filled from archetype default |
| Price Type | select | Yes | per-hour, per-session, fixed, free |
| Price Amount | currency | Conditional | Required unless priceType is "free" or "quote" |
| CTA Label | text | No | Default: "Book now" |
| Scheduling Pattern | select | No | slot / class / recurring (from archetype default) |
| Capacity | number | Conditional | Required for class pattern |
| Buffer Before | number (minutes) | No | Advanced; default from archetype |
| Buffer After | number (minutes) | No | Advanced; default from archetype |

### 4.3 Purchase Items (`ctaType: "purchase"`)

| Field | Type | Required | Notes |
|---|---|---|---|
| Price Type | select | Yes | fixed, from |
| Price Amount | currency | Yes | |
| CTA Label | text | No | Default: "Order now" / "Buy now" |

### 4.4 Inquiry Items (`ctaType: "inquiry"`)

| Field | Type | Required | Notes |
|---|---|---|---|
| Price Type | select | No | quote, from, per-hour, fixed |
| Price Amount | currency | Conditional | Required for from/per-hour/fixed |
| CTA Label | text | No | Default: "Get a quote" / "Contact us" |

### 4.5 Donation Items (`ctaType: "donation"`)

| Field | Type | Required | Notes |
|---|---|---|---|
| Suggested Amount | currency | No | Pre-filled suggestion for donors |
| Goal Amount | currency | No | Fundraising target (displayed as progress bar) |
| CTA Label | text | No | Default: "Donate now" |

## 5. Category Defaults per Archetype

When creating a new item, the category field shows archetype-specific suggestions. These are hints, not constraints — users can type any category.

| Archetype | Suggested Categories |
|---|---|
| Restaurant | Starters, Mains, Desserts, Drinks, Set Menus, Specials |
| Bakery | Bread, Cakes, Pastries, Savoury, Custom Orders |
| Catering | Corporate, Wedding, Private, Buffet |
| Tutoring | Maths, English, Science, Languages, Exam Prep |
| Corporate Training | Leadership, Technical, Compliance, Soft Skills |
| Music School | Guitar, Piano, Drums, Vocals, Theory |
| Driving School | Lessons, Packages, Tests |
| Retail Shop | Featured, New Arrivals, Bundles, Gift Cards |
| Artisan Goods | Handmade, Custom, Workshops |
| Florist | Bouquets, Arrangements, Wedding, Corporate |
| Gym | Memberships, Classes, Personal Training |
| Yoga Studio | Classes, Passes, Private Sessions, Retreats |
| Dance Studio | Classes, Private Lessons, Workshops |
| Veterinary | Consultations, Vaccinations, Surgery, Dental |
| Dental Practice | Check-ups, Treatments, Cosmetic |
| Physiotherapy | Assessment, Treatment, Rehabilitation |
| Plumber | Emergency, Installation, Repair, Maintenance |
| Electrician | Testing, Installation, Repair, EV Charging |
| IT Services | Support, Security, Cloud, Infrastructure |
| Legal Services | Consultation, Conveyancing, Employment, Commercial |
| Accounting | Bookkeeping, Accounts, Tax, Advisory |
| Pet Rescue / Shelter | Sponsorship, Donations, Volunteering |
| Charity | Donations, Events, Corporate Giving |

**Implementation**: A `CATEGORY_SUGGESTIONS` constant in the vocabulary file, keyed by `archetypeId`.

## 6. API Design

### 6.1 Endpoints

All routes under `/api/storefront/admin/items/`:

| Method | Path | Purpose | Capability |
|---|---|---|---|
| `GET` | `/api/storefront/admin/items` | List all items for the org's storefront | `view_storefront` |
| `POST` | `/api/storefront/admin/items` | Create a new item | `view_storefront` |
| `PUT` | `/api/storefront/admin/items/[id]` | Update an item (full replace) | `view_storefront` |
| `PATCH` | `/api/storefront/admin/items/[id]` | Partial update (exists: isActive toggle) | `view_storefront` |
| `DELETE` | `/api/storefront/admin/items/[id]` | Delete an item | `view_storefront` |
| `PATCH` | `/api/storefront/admin/items/reorder` | Bulk reorder items | `view_storefront` |

### 6.2 POST `/api/storefront/admin/items` — Create Item

**Request body:**
```typescript
{
  name: string;                    // Required
  description?: string;
  category?: string;
  ctaType: "booking" | "purchase" | "inquiry" | "donation";
  priceType?: PriceType;
  priceAmount?: number;            // Decimal, nullable
  priceCurrency?: string;          // Default: org currency from finance setup
  imageUrl?: string;
  ctaLabel?: string;
  bookingConfig?: {                // Required if ctaType === "booking"
    durationMinutes: number;
    schedulingPattern?: string;    // Default from archetype
    assignmentMode?: string;       // Default from archetype
    capacity?: number;
    beforeBufferMinutes?: number;
    afterBufferMinutes?: number;
  };
  goalAmount?: number;             // For donation items — stored in bookingConfig JSON
  suggestedAmount?: number;        // For donation items — stored in bookingConfig JSON
}
```

**Server logic:**
1. Load `StorefrontConfig` for the session user's org
2. Generate `itemId` as `ITEM-<8-char-uuid>`
3. Build `bookingConfig` JSON from request + archetype scheduling defaults
4. For donation items, store `goalAmount` and `suggestedAmount` in bookingConfig
5. Create `StorefrontItem` record
6. If `ctaType === "booking"`, create `ProviderService` links for all active providers
7. Return created item

### 6.3 PUT `/api/storefront/admin/items/[id]` — Update Item

Same body as POST. Replaces all mutable fields. If CTA type changes from/to booking, add/remove `ProviderService` links accordingly.

### 6.4 DELETE `/api/storefront/admin/items/[id]` — Delete Item

**Soft delete strategy**: If item has any bookings, orders, or inquiries linked, set `isActive: false` instead of deleting. If no references, hard delete.

### 6.5 PATCH `/api/storefront/admin/items/reorder` — Reorder

**Request body:**
```typescript
{ items: Array<{ id: string; sortOrder: number }> }
```

Bulk update `sortOrder` for all items in a single transaction.

## 7. UI Component Design

### 7.1 ItemsManager Redesign

Replace the current read-only table with an archetype-aware management interface.

**Component structure:**
```
ItemsManager (client component)
  ├─ Header: "{Items Label}" + "{Add Button}" button
  ├─ Category filter tabs (if items have categories)
  ├─ Item cards (draggable for reorder)
  │   ├─ Item name + description preview
  │   ├─ Price badge (formatted by priceType)
  │   ├─ CTA type badge (colour-coded)
  │   ├─ Active toggle
  │   ├─ Edit button → opens ItemFormDialog
  │   └─ Delete button (with confirmation)
  └─ ItemFormDialog (modal)
      ├─ Common fields section
      ├─ CTA-specific fields section (conditional)
      ├─ Advanced settings (collapsible)
      └─ Save / Cancel buttons
```

### 7.2 ItemFormDialog

A modal dialog that adapts its fields based on:
1. **Selected CTA type** — shows/hides booking config, price fields, goal amount
2. **Archetype vocabulary** — uses business-appropriate labels
3. **Archetype defaults** — pre-fills duration, scheduling pattern, buffers from archetype

**Form sections:**

**Section 1: Basics** (always visible)
- Name (text input)
- Description (textarea, 3 rows)
- Category (combobox with archetype-specific suggestions)
- CTA Type (select: booking / purchase / inquiry / donation)

**Section 2: Pricing** (conditional on CTA type)
- Price Type (select, options vary by CTA type)
- Price Amount (currency input, hidden for "free" / "quote" / "donation")
- CTA Label (text, with archetype-appropriate placeholder)

**Section 3: Booking Config** (only for `ctaType === "booking"`)
- Duration (number, minutes)
- Scheduling Pattern (select: slot / class / recurring)
- Capacity (number, only for "class" pattern)

**Section 4: Donation Config** (only for `ctaType === "donation"`)
- Suggested Amount (currency)
- Goal Amount (currency)

**Section 5: Advanced** (collapsible, only for booking)
- Buffer Before (minutes)
- Buffer After (minutes)
- Image URL (text input)

### 7.3 Price Display Formatting

| priceType | Display |
|---|---|
| `fixed` | £50.00 |
| `from` | From £30.00 |
| `per-hour` | £45.00/hr |
| `per-session` | £60.00/session |
| `free` | Free |
| `donation` | Suggested: £25.00 (or "Any amount") |
| `quote` | Request a quote |

### 7.4 CTA Type Badges

| ctaType | Badge Colour | Label |
|---|---|---|
| `booking` | `#a78bfa` (purple) | Booking |
| `purchase` | `#4ade80` (green) | Purchase |
| `inquiry` | `#fb923c` (orange) | Inquiry |
| `donation` | `#f472b6` (pink) | Donation |

## 8. Data Flow

```
User navigates to /storefront/items
  │
  ├─ Server component loads:
  │   ├─ StorefrontConfig.archetype (category, ctaType)
  │   ├─ All StorefrontItems ordered by sortOrder
  │   └─ Archetype vocabulary (labels, category suggestions)
  │
  ├─ Renders ItemsManager with:
  │   ├─ items[]
  │   ├─ vocabulary (labels adapted to business type)
  │   ├─ categorySuggestions[]
  │   ├─ defaultCtaType (from archetype)
  │   └─ schedulingDefaults (from archetype, for pre-filling booking config)
  │
  └─ User interactions:
      ├─ "Add {item}" → opens ItemFormDialog (create mode)
      │   ├─ Pre-fills CTA type from archetype default
      │   ├─ Pre-fills booking duration from archetype
      │   ├─ Category suggestions from archetype
      │   └─ Submit → POST /api/storefront/admin/items
      │
      ├─ Edit button → opens ItemFormDialog (edit mode)
      │   ├─ Pre-fills all fields from existing item
      │   └─ Submit → PUT /api/storefront/admin/items/[id]
      │
      ├─ Delete button → confirmation → DELETE /api/storefront/admin/items/[id]
      │
      ├─ Drag to reorder → PATCH /api/storefront/admin/items/reorder
      │
      └─ Toggle active → PATCH /api/storefront/admin/items/[id]
```

## 9. Business-Type Walkthrough Examples

### 9.1 Restaurant Owner

Sees heading: **"Menu"** with button **"Add to menu"**.

Items displayed as cards with category tabs: Starters | Mains | Desserts | Drinks | Set Menus.

Creates a new item:
- CTA type pre-selected: "Booking" (restaurant default)
- Category suggestions: Starters, Mains, Desserts, Drinks, Set Menus, Specials
- Booking config visible: Duration (90 min default), capacity (Table size)
- Price shown as "From £X" for set menus, "Free" for reservations

### 9.2 Tutoring Company

Sees heading: **"Courses"** with button **"Add course"**.

Creates a new item:
- CTA type pre-selected: "Booking"
- Category suggestions: Maths, English, Science, Languages, Exam Prep
- Fee field labelled "Fee" not "Price"
- Duration pre-filled: 60 minutes
- Scheduling visible: slot pattern, customer-choice assignment

### 9.3 Retail Shop

Sees heading: **"Products"** with button **"Add product"**.

Creates a new item:
- CTA type pre-selected: "Purchase"
- No booking config section (CTA is purchase)
- Price field required with fixed/from options
- Category suggestions: Featured, New Arrivals, Bundles, Gift Cards

### 9.4 Charity

Sees heading: **"Campaigns & Appeals"** with button **"Add campaign"**.

Creates a new item:
- CTA type pre-selected: "Donation"
- Shows donation-specific fields: Suggested Amount, Goal Amount
- No price field — donations are open amount
- Category suggestions: Donations, Events, Corporate Giving

### 9.5 Plumber

Sees heading: **"Services"** with button **"Add service"**.

Creates a new item:
- CTA type pre-selected: "Inquiry"
- Rate field labelled "Rate" not "Price"
- Price type pre-selected: "Quote" (most trade services are quoted)
- Category suggestions: Emergency, Installation, Repair, Maintenance

## 10. Files to Create or Modify

### New Files

| File | Purpose |
|---|---|
| `apps/web/lib/storefront/archetype-vocabulary.ts` | Vocabulary map + category suggestions per archetype |
| `apps/web/components/storefront-admin/ItemFormDialog.tsx` | Create/edit item modal with CTA-adaptive fields |
| `apps/web/app/api/storefront/admin/items/route.ts` | GET (list) + POST (create) endpoints |
| `apps/web/app/api/storefront/admin/items/reorder/route.ts` | PATCH bulk reorder endpoint |

### Modified Files

| File | Change |
|---|---|
| `apps/web/components/storefront-admin/ItemsManager.tsx` | Replace read-only table with card layout, add/edit/delete/reorder |
| `apps/web/app/(shell)/storefront/items/page.tsx` | Load archetype context, pass vocabulary + defaults to ItemsManager |
| `apps/web/app/api/storefront/admin/items/[id]/route.ts` | Add PUT (full update) and DELETE endpoints alongside existing PATCH |

### No Schema Changes

The existing `StorefrontItem` model has all required fields:
- `category` — exists, currently unused
- `priceAmount` — exists, currently never set from templates
- `imageUrl` — exists, currently unused
- `bookingConfig` — exists, used for booking items

Donation-specific fields (`goalAmount`, `suggestedAmount`) are stored in the `bookingConfig` JSON field to avoid schema migration. This is acceptable because bookingConfig is already a flexible JSON column.

## 11. Integration with Marketing Specialist

The Marketing Specialist agent (registered on `/storefront`) benefits from this feature:
- `suggest_campaign_ideas` tool can now reference actual item names, categories, and prices
- Campaign suggestions become more specific: "Promote your new Mains category" vs generic "promote your services"
- The agent can suggest adding items based on market gaps: "You have no Desserts category — consider adding one"

## 12. Verification Plan

1. **Restaurant**: Create items with categories (Starters, Mains), verify "Menu" label, booking config visible
2. **Retail**: Create purchase items with prices, verify "Products" label, no booking config
3. **Charity**: Create donation items with goal amounts, verify "Campaigns" label
4. **Plumber**: Create inquiry items with "Quote" pricing, verify "Services" label
5. **Edit flow**: Edit an existing item, change CTA type, verify form fields adapt
6. **Delete flow**: Delete item with no references (hard delete), delete item with bookings (soft deactivate)
7. **Reorder**: Drag items, verify sort order persists
8. **Category filter**: Add items with categories, verify category tabs appear
9. **Mixed CTA**: In archetypes with mixed CTAs (artisan, florist), verify both booking and purchase items can coexist
10. **Public storefront**: After editing items, verify changes appear on public `/s/[slug]` page

## 13. Out of Scope (Future Epics)

- **Image upload** — Currently URL-only; file upload requires storage backend (EP-STORE-006)
- **Inventory/stock tracking** — Quantity management for purchase items
- **Item variants** — Size/colour variants for retail products
- **Menu scheduling** — Time-based menus (lunch vs dinner) for restaurants
- **Course prerequisites** — Dependency chains for training courses
- **Custom form fields per item** — Currently form schema is archetype-wide
- **Item bundles** — Composite items (cut + colour, course + materials)
- **Seasonal availability** — Auto-hide items outside their season
