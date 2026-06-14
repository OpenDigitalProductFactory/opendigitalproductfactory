# Phase W Run 9 — Food & Hospitality: Restaurant Archetype
**Audit date:** 2026-06-14
**Archetype slug:** `restaurant`
**Storefront slug:** `peak-physio-clinic` (archetype reset applied to existing workspace)
**Auditor:** Claude / Phase W systematic test suite
**Branch:** `doc/phase-w-run1-retest`

---

## Phase P — Admin / Storefront Setup

### Archetype reset
- Reset via POST `/api/storefront/admin/archetype-reset` with `{targetArchetypeId: 'restaurant'}` ✅
- Result: 6 sections created, 5 items created ✅
- Dashboard shows new "0 Bookings" tile (not seen in bakery/catering) — indicates booking-type items

### Storefront sections observed (post-archetype-reset)
| # | Section name | Section type |
|---|---|---|
| 1 | Hero | hero |
| 2 | Reservations | items |
| 3 | About Us | about |
| 4 | Our Food | gallery |
| 5 | **Guest Reviews** | **testimonials** |
| 6 | Find Us | contact |

**New capability discovered:** `testimonials` section type — first appearance across all food-hospitality archetypes audited.

**New naming convention:** Items section is called "Reservations" (not "Our Services" or "Our Bakes") — archetype-specific naming reflects the restaurant reservation model.

### Menu items observed
| Item | ctaType | priceType | Price display | Button label (admin) |
|---|---|---|---|---|
| Table for 2 | booking | free | Free | "Book now" |
| Table for 4 | booking | free | Free | "Book now" |
| Table for 6+ | booking | free | Free | "Book now" |
| Private Dining | booking | from | — | "Book now" |
| Set Lunch Menu | booking | from | — | "Book now" |

**Key difference from bakery/catering:** All 5 restaurant items are `ctaType=booking` — the first all-booking archetype in the food-hospitality category. Items have two price types: `free` (new type) and `from`.

### Edit Item form — new capabilities (booking items)
The Edit Item form for booking-type items includes a **BOOKING SETTINGS** section not present in inquiry/purchase items:
- **Duration (minutes)***: 60 (default)
- **Pattern** (dropdown): 1:1 Slot
- **Assignment** (dropdown): Next available
- **Advanced buffer settings** (expandable section)

Additional new field: **Images** section with "+ Add images" button and "Or paste an image URL" text field — first archetype to expose image upload in the Edit Item form.

Additional new price type in Price type dropdown: **"Per hour"** — not seen in bakery (fixed/from/quote) or catering (quote only).

### Phase P defect
**R9-BAK-001 confirmed cross-archetype:** Edit Item form opens blank (no data pre-populated) in restaurant exactly as in bakery and catering. The `ctaType`, price type, duration, pattern, and button label fields all show defaults rather than saved values.

---

## Phase B5 — Public Storefront

### CTA routing results — all 5 items
| Item | Rendered CTA | Routes to | Booking flow | Slots available |
|---|---|---|---|---|
| Table for 2 | **Book Now** ✅ | `/book/itm-wbQKxbna` | Calendar (June 2026) | None — all dates disabled |
| Table for 4 | **Book Now** ✅ | `/book/itm-tOwUxlML` | Calendar (June 2026) | None — all dates disabled |
| Table for 6+ | **Book Now** ✅ | `/book/itm-ihDz64r1` | Calendar (June 2026) | None — all dates disabled |
| Private Dining | **Book Now** ✅ | `/book/itm-4OadVywR` | Calendar (June 2026) | None — all dates disabled |
| Set Lunch Menu | **Book Now** ✅ | `/book/itm-8tjoTaUe` | Calendar (June 2026) | None — all dates disabled |

**Key positive finding:** Custom button label "Book Now" **is rendered correctly** on all 5 storefront cards. This resolves a prior question about R9-CAT-001 scope: the button label rendering gap (hardcoded "Enquire") applies to inquiry-type CTAs only. Booking-type CTAs correctly display the stored button label. ✅

**Booking flow confirmed:** Clicking "Book Now" routes to `/s/peak-physio-clinic/book/<itemId>` and renders the SlotBookingFlow with a full calendar picker (month/prev/next navigation, Sun–Sat grid, "Times shown in UTC" label). ✅

### Price display
- Table for 2/4/6+ display "Free" badge correctly ✅
- **Private Dining and Set Lunch Menu show no price badge** (from-price items) — same gap as bakery's from-price items. Storefront cards show no price indicator for `priceType=from` items.

### Storefront sections rendering
- Hero section renders ✅
- Reservations (items) section renders ✅
- **About Us, Our Food (gallery), Guest Reviews (testimonials), Find Us (contact) do NOT render** — 4 of 6 sections absent from public storefront. Worse than bakery/catering (which had 3 of 5 absent). Restaurant has one extra section (testimonials) that also fails to render.

### Phase B5 defect — empty booking calendar (Critical)
**R9-RES-001 (Defect / Critical):** Restaurant archetype seeds 5 `ctaType=booking` items but seeds NO staff schedule or provider availability. When a customer clicks any "Book Now" CTA, they land on a booking calendar showing June 2026 (or any month) with all dates greyed out and non-interactive. There is no error message, no "check back later" prompt, and no fallback. The booking calendar is silently non-functional on a fresh archetype install.

A customer who visits the restaurant storefront cannot make a reservation. The UX gives no indication of why — the calendar simply renders with no available dates. This is the most severe customer-facing gap discovered in the food-hospitality category.

**Root cause hypothesis:** The archetype reset seeds `StorefrontItem` records with `ctaType=booking` but does not seed a corresponding `ProviderService`, staff schedule, or availability window. Without a provider with configured hours, the booking slot query returns zero results for any date.

**Customer impact:** The restaurant storefront is non-functional for its primary purpose (taking reservations) from the moment the archetype is applied until an operator manually configures staff schedules.

### Booking flow UI assessment
The booking calendar itself is well-formed:
- Month/year header ✅
- Prev / Next month navigation works ✅
- Sun–Sat column headers ✅
- "Times shown in UTC" timezone label ✅
- Item name shown as page heading ("Book: Table for 2") ✅

The only gap is the absence of selectable dates — confirmed across both June and July 2026 (checked via Next navigation). The flow is architecturally sound; the seed gap prevents it from being usable.

### R9-CAT-001 scope refinement
Previous finding R9-CAT-001 stated "custom button label field not rendered on storefront." Restaurant confirms this applies to **inquiry-type items only**. For `ctaType=booking` items, the stored button label IS rendered. The defect should be re-scoped: button label is ignored for inquiry CTAs but respected for booking CTAs.

### Cross-archetype B5 confirmations
- `priceType=from` items show no price badge: Present in restaurant ✅ (confirmed cross-archetype)
- Multiple sections missing on public storefront: Present in restaurant (4 of 6) ✅
- Booking flow calendar renders: ✅ first confirmation in food-hospitality category

---

## Phase G — Finance

### Finance cross-check
New Invoice form at `/finance/invoices/new` confirms all Phase G gap patterns persist in restaurant context:

| Observation | State | Result |
|---|---|---|
| Currency before customer selection | GBP | R9-G-001 confirmed ✅ |
| Tax % default | 20% | R9-G-003 confirmed ✅ |
| Finance Specialist coworker | HANDS OFF | ✅ |

No new Finance findings specific to the restaurant archetype. All bakery Phase G gaps (R9-G-001 through R9-G-003) are cross-archetype.

---

## Summary scorecard

| Phase | Pass | Gap/Defect | Notes |
|---|---|---|---|
| P (Admin) | ✅ 6 sections, 5 booking items, new capabilities discovered | R9-BAK-001 confirmed cross-archetype | New: testimonials section, booking settings panel, per-hour price, images field |
| B5 (Storefront) | ✅ All 5 CTAs route to booking calendar, "Book Now" label renders correctly | R9-RES-001 (Critical: no slots), 4/6 sections missing, from-price items show no badge | Booking label renders correctly (positive — scopes R9-CAT-001 to inquiry-only) |
| G (Finance) | ✅ Finance Specialist HANDS OFF | All R9-G cross-archetype gaps confirmed | No restaurant-specific Finance gaps |

### New findings this run
- **R9-RES-001 (Defect / Critical):** Restaurant archetype seeds booking items with no staff schedule — booking calendar shows no available slots, restaurant storefront non-functional for reservations on fresh install.
- **Positive: R9-CAT-001 scope refinement** — button label renders for booking CTAs (only inquiry CTAs hardcode "Enquire").

### New capabilities discovered in restaurant archetype
| Capability | Location | Notes |
|---|---|---|
| `testimonials` section type | Sections tab | "Guest Reviews" — new to food-hospitality |
| BOOKING SETTINGS panel | Edit Item form | Duration, Pattern (1:1 Slot), Assignment (Next available), Advanced buffer settings |
| `priceType=free` | Item cards | Renders "Free" badge on storefront card ✅ |
| Per hour price type | Edit Item form | New price type option in dropdown |
| Images section | Edit Item form | Photo upload + URL paste — first archetype to expose this |
| `/book/<itemId>` routing | Storefront CTA | SlotBookingFlow with calendar picker |

### Food-hospitality category comparison (3 archetypes)
| Dimension | Bakery | Catering | Restaurant |
|---|---|---|---|
| ctaType mix | inquiry + purchase | inquiry only | booking only |
| Sections | 5 (hero, items, about, gallery, contact) | 5 (same) | 6 (+testimonials) |
| Section rendering gap | 3/5 absent | 3/5 absent | 4/6 absent |
| Button label rendered | ❌ (inquiry items) | ❌ (inquiry items) | ✅ (booking items) |
| Price display — free | N/A | N/A | ✅ |
| Price display — from | ❌ no badge | N/A | ❌ no badge |
| Price display — POA/quote | ✅ POA badge | ✅ POA badge | N/A |
| Booking calendar | N/A | N/A | ✅ renders, ❌ no slots |
| formSchema rendering | ✅ (5 fields) | ✅ (7 fields) | N/A (booking flow) |
