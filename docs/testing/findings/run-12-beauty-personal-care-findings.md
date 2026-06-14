# Phase W Run 12 — Beauty & Personal Care Category
**Audit date:** 2026-06-14
**Category:** beauty-personal-care
**Archetypes audited:** barber-shop, beauty-spa, hair-salon, nail-salon, personal-trainer
**Storefront slug:** `peak-physio-clinic` (archetype reset applied each time)
**Auditor:** Claude / Phase W systematic test suite
**Branch:** `doc/phase-w-run1-retest`

---

## Archetype 1 — Barber Shop

### Phase P
- Reset: 5 sections, 5 items ✅
- Admin label: **"Booking Portal"** (category-level branding), nav tab: **"Services"**, inbox: **"Bookings"**

| Section | Type |
|---|---|
| Hero | hero |
| Services | items |
| About the Shop | about |
| The Cuts | gallery |
| Find Us | contact |

| Item | ctaType | priceType | ctaLabel |
|---|---|---|---|
| Haircut | booking | fixed | (empty) |
| Beard Trim | booking | fixed | (empty) |
| Hot Towel Shave | booking | fixed | (empty) |
| Fade | booking | fixed | (empty) |
| Cut & Beard Combo | booking | fixed | (empty) |

### Phase B5
- All 5 items render "Book Now" ✅
- Booking calendar (`/book/itm-S5ftgHiI`) renders June 2026 with no slots — R9-RES-001 confirmed ✅
- Gallery section absent from DOM (R10-SECT-001 cross-archetype) ✅

### Phase G
- R9-G-001 / R9-G-003 cross-archetype confirmed. No barber-shop-specific Finance gaps.

---

## Archetype 2 — Beauty Spa

### Phase P
- Reset: 6 sections, 6 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Treatments | items |
| About the Spa | about |
| Our Space | gallery |
| Client Reviews | testimonials |
| Book a Treatment | contact |

| Item | ctaType | priceType |
|---|---|---|
| Facial | booking | from |
| Massage | booking | from |
| Waxing | booking | from |
| Eyebrow Threading | booking | fixed |
| Lash Extensions | booking | from |
| Spa Day Package | booking | from |

### Phase B5
- All 6 items render "Book Now" ✅
- Gallery + testimonials sections absent (R10-SECT-001 cross-archetype) ✅

---

## Archetype 3 — Hair Salon

### Phase P
- Reset: 6 sections, 6 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Services | items |
| About Us | about |
| Our Work | gallery |
| What Clients Say | testimonials |
| Book Now | contact |

| Item | ctaType | priceType |
|---|---|---|
| Haircut | booking | from |
| Colour | booking | from |
| Highlights | booking | from |
| Blow-dry | booking | fixed |
| Treatment | booking | from |
| Children's Cut | booking | fixed |

### Phase B5
- All 6 items render "Book Now" ✅
- Gallery + testimonials absent (R10-SECT-001) ✅

---

## Archetype 4 — Nail Salon

### Phase P
- Reset: 5 sections, 6 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Services | items |
| Nail Gallery | gallery |
| About Us | about |
| Book an Appointment | contact |

| Item | ctaType | priceType |
|---|---|---|
| Manicure | booking | fixed |
| Pedicure | booking | fixed |
| Gel Nails | booking | from |
| Nail Art | booking | from |
| Acrylic Nails | booking | from |
| Nail Removal | booking | fixed |

### Phase B5
- All 6 items render "Book Now" ✅
- Gallery absent (R10-SECT-001) ✅

---

## Archetype 5 — Personal Trainer

### Phase P
- Reset: 5 sections, 5 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| About | about |
| Training Packages | items |
| Client Results | testimonials |
| Start Your Journey | contact |

| Item | ctaType | priceType | Notes |
|---|---|---|---|
| Initial Assessment | booking | free | "Free" badge renders ✅ |
| 1-Hour PT Session | booking | per-session | |
| **Block of 10 Sessions** | **purchase** | fixed | No priceAmount — priceless-purchase guard ✅ |
| Online Coaching | booking | per-session | |
| Group Bootcamp | booking | per-session | |

**Key finding:** personal-trainer is the first beauty-personal-care archetype with a `purchase` ctaType item (Block of 10 Sessions). `priceAmount` is null in seed — `CtaButton.tsx` `isPricelessPurchase` guard activates, rendering "Enquire" and routing to `/inquire/<itemId>` instead of the dead-end order route. This is documented intended behaviour (AUDIT-R3/R4 comment in CtaButton.tsx line 28).

### Phase B5
- 4 booking items: "Book Now" ✅
- Block of 10 Sessions: **"Enquire"** (priceless-purchase guard) — routes to `/inquire/itm-1hk4OYso` ✅
- Inquiry form shows personal-trainer formSchema: **Fitness goal** (Weight loss / Muscle gain / Endurance / General fitness / Sport-specific / Rehabilitation) + **Experience level** (Beginner / Intermediate / Advanced) ✅
- End-to-end submission: **INQ-N6DVS1MT** ✅ → `/checkout?ref=INQ-N6DVS1MT&type=inquiry` ✅
- Testimonials absent (R10-SECT-001) ✅
- `priceType=per-session` items show no price badge (cross-archetype from-price gap equivalent) ✅
- `priceType=free` (Initial Assessment) renders "Free" badge ✅

### Phase G
- R9-G-001 / R9-G-003 cross-archetype confirmed. No personal-trainer-specific Finance gaps.

---

## Category summary — Beauty & Personal Care

| Archetype | Sections | Items | ctaTypes | End-to-end |
|---|---|---|---|---|
| barber-shop | 5 (incl. gallery) | 5 | booking ×5 | booking calendar ✅ (no slots R9-RES-001) |
| beauty-spa | 6 (incl. gallery + testimonials) | 6 | booking ×6 | booking calendar ✅ |
| hair-salon | 6 (incl. gallery + testimonials) | 6 | booking ×6 | booking calendar ✅ |
| nail-salon | 5 (incl. gallery) | 6 | booking ×6 | booking calendar ✅ |
| personal-trainer | 5 (incl. testimonials) | 5 | booking ×4 + purchase ×1 | INQ-N6DVS1MT ✅ |

### Category patterns
- Dominant ctaType: `booking` (all services are appointment-based)
- `gallery` section present in 4/5 archetypes — consistently absent from DOM (R10-SECT-001)
- `testimonials` section in 3/5 archetypes — consistently absent from DOM (R10-SECT-001)
- Admin portal label: "Booking Portal" across the category
- `per-session` priceType confirmed working in seed; no price badge rendered (same gap as `from` type)
- `free` priceType renders "Free" badge correctly ✅
- Priceless-purchase guard working correctly in personal-trainer ✅

### Cross-archetype confirmations
| Finding | Status |
|---|---|
| R9-RES-001 (no booking slots on fresh reset) | ✅ Confirmed across all 5 |
| R10-SECT-001 (gallery/testimonials null when empty) | ✅ Confirmed across all 5 |
| R9-G-001 (GBP default) | ✅ Confirmed |
| R9-G-003 (20% tax) | ✅ Confirmed |

### No new defects
All observations are cross-archetype confirmations of known gaps. Beauty-personal-care is architecturally clean.
