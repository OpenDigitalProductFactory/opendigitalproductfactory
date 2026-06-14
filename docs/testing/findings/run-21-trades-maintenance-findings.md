# Phase W Run 21 — Trades & Maintenance Category
**Audit date:** 2026-06-14
**Category:** trades-maintenance
**Archetypes audited:** cleaning-service, electrician, facilities-maintenance, landscaping, plumber
**Storefront slug:** `peak-physio-clinic` (archetype reset each time)
**Auditor:** Claude / Phase W systematic test suite
**Branch:** `doc/phase-w-run1-retest`

---

## Archetype 1 — Cleaning Service

### Phase P — Reset: 5 sections, 6 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Services | items |
| About Us | about |
| What Clients Say | testimonials |
| Get a Quote | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Regular Domestic Clean | inquiry | per-hour | Enquire (no badge) |
| One-Off Deep Clean | inquiry | quote | POA + Enquire ✅ |
| End of Tenancy Clean | inquiry | from | Enquire (no badge) |
| Office Cleaning | inquiry | quote | POA + Enquire ✅ |
| Carpet & Upholstery Clean | inquiry | from | Enquire (no badge) |
| Window Cleaning | inquiry | from | Enquire (no badge) |

### Phase B5
- All 6 inquiry → "Enquire" ✅
- `inquiry/per-hour` → no badge (cross-archetype with tutoring/music-school) ✅
- `inquiry/quote` × 2 → "POA" badge ✅
- Testimonials absent from DOM (R10-SECT-001) ✅

---

## Archetype 2 — Electrician

### Phase P — Reset: 5 sections, 6 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Services | items |
| About Us | about |
| Customer Reviews | testimonials |
| Get a Quote | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Electrical Safety Certificate | inquiry | from | Enquire (no badge) |
| Consumer Unit Replacement | inquiry | from | Enquire (no badge) |
| Socket & Switch Installation | inquiry | from | Enquire (no badge) |
| Lighting Installation | inquiry | from | Enquire (no badge) |
| EV Charger Installation | inquiry | from | Enquire (no badge) |
| Emergency Call-Out | inquiry | from | Enquire (no badge) |

### Phase B5
- All 6 inquiry/from — no badge on any (null priceAmount) ✅
- Testimonials absent from DOM (R10-SECT-001) ✅

---

## Archetype 3 — Facilities Maintenance

### Phase P — Reset: 5 sections, 6 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Services | items |
| About Us | about |
| Client Feedback | testimonials |
| Request a Quote | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Planned Maintenance Contract | inquiry | quote | POA + Enquire ✅ |
| Reactive Repair | inquiry | from | Enquire (no badge) |
| Building Inspection | inquiry | quote | POA + Enquire ✅ |
| HVAC Servicing | inquiry | from | Enquire (no badge) |
| Electrical Testing | inquiry | from | Enquire (no badge) |
| Emergency Call-Out | inquiry | from | Enquire (no badge) |

### Phase B5
- inquiry/quote × 2 → "POA" ✅
- inquiry/from × 4 → no badge ✅
- Testimonials absent from DOM (R10-SECT-001) ✅

---

## Archetype 4 — Landscaping

### Phase P — Reset: 5 sections, 6 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Services | items |
| Our Projects | gallery |
| About Us | about |
| Request a Quote | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Garden Design Consultation | inquiry | fixed | Enquire (no badge — null priceAmount) |
| Lawn Maintenance Contract | inquiry | from | Enquire (no badge) |
| Patio & Decking Installation | inquiry | quote | POA + Enquire ✅ |
| Fencing & Gates | inquiry | from | Enquire (no badge) |
| Tree Surgery | inquiry | quote | POA + Enquire ✅ |
| Irrigation Systems | inquiry | quote | POA + Enquire ✅ |

### Phase B5
- inquiry/quote × 3 → "POA" ✅
- inquiry/fixed + null priceAmount → no badge ✅
- Gallery (Our Projects) absent from DOM (R10-SECT-001) ✅

---

## Archetype 5 — Plumber

### Phase P — Reset: 4 sections, 6 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Services | items |
| About Us | about |
| Get a Quote | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Emergency Call-Out | inquiry | from | Enquire (no badge) |
| Boiler Service | inquiry | fixed | Enquire (no badge — null priceAmount) |
| Boiler Repair | inquiry | from | Enquire (no badge) |
| Bathroom Installation | inquiry | quote | POA + Enquire ✅ |
| Drain Unblocking | inquiry | from | Enquire (no badge) |
| Leak Detection & Repair | inquiry | from | Enquire (no badge) |

### Phase B5
- Only 4 sections — fewest in trades category (no gallery, testimonials, or team) ✅
- formSchema (plumber): **Full name** *, **Email** *, **Phone** *, **Job description** * (textarea), **Urgency** * (select: Emergency / Routine / Planned), **Property type** * (select: Residential / Commercial / Industrial), **Additional details** (textarea optional)
- End-to-end: **INQ-6BMFCAV-** ✅ → `/checkout?ref=INQ-6BMFCAV-&type=inquiry` ✅

---

## Category summary — Trades & Maintenance

| Archetype | Sections | Items | ctaTypes | End-to-end |
|---|---|---|---|---|
| cleaning-service | 5 | 6 | inquiry×6 | — |
| electrician | 5 | 6 | inquiry×6 | — |
| facilities-maintenance | 5 | 6 | inquiry×6 | — |
| landscaping | 5 | 6 | inquiry×6 | — |
| plumber | 4 | 6 | inquiry×6 | INQ-6BMFCAV- ✅ |

### Category patterns
- All 30 items across all 5 archetypes are `inquiry` ctaType — 100% inquiry category
- `inquiry/from` is dominant priceType across trades (all services price on survey)
- `inquiry/quote` appears in cleaning, facilities, landscaping — higher-value or bespoke jobs
- `inquiry/per-hour` only in cleaning-service (domestic cleaning hourly model)
- No booking, purchase, donation, or rental in trades-maintenance
- Testimonials present in 4/5 archetypes — all absent (R10-SECT-001)
- Gallery present in landscaping only (Our Projects) — absent (R10-SECT-001)

### New findings this run

| Finding | Type | Detail |
|---|---|---|
| Plumber formSchema | Positive | Most fields required: Phone *, Job description *, Urgency * (Emergency/Routine/Planned), Property type * (Residential/Commercial/Industrial) — most restrictive intake schema seen in Phase W |
| Plumber: only 4 sections | Observation | No gallery, testimonials, or team — leanest template in trades |
| inquiry/per-hour → no badge | Positive | Consistent with booking/per-hour (tutoring) and booking/per-session (music-school) |

### Cross-archetype confirmations

| Finding | Status |
|---|---|
| R10-SECT-001 (testimonials/gallery null) | ✅ Confirmed ×5 archetypes |
| `inquiry/quote` → POA badge | ✅ Confirmed (cleaning ×2, facilities ×2, landscaping ×3) |
| `inquiry/from` + null priceAmount → no badge | ✅ Confirmed ×20 items |
| `inquiry/fixed` + null priceAmount → no badge | ✅ Confirmed (plumber Boiler Service, landscaping Garden Design) |
