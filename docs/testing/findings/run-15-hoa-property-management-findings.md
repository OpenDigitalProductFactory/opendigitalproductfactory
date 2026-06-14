# Phase W Run 15 — HOA & Property Management Category
**Audit date:** 2026-06-14
**Category:** hoa-property-management
**Archetypes audited:** condo-association, homeowners-association, property-management-company
**Storefront slug:** `peak-physio-clinic` (archetype reset each time)
**Auditor:** Claude / Phase W systematic test suite
**Branch:** `doc/phase-w-run1-retest`

---

## Archetype 1 — Condo Association

### Phase P — Reset: 5 sections, 5 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| About Our Building | about |
| Resident Services | items |
| Board & Management | team |
| Contact Management | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Monthly Condo Fees | purchase | fixed | Enquire (priceless-purchase guard) |
| Special Assessment | purchase | fixed | Enquire |
| Parking Allocation | inquiry | free | Free + Enquire ✅ |
| Common Area Booking | booking | fixed | Book Now ✅ |
| Maintenance Request | inquiry | free | Free + Enquire ✅ |

### Phase B5
- Mixed ctaType pattern: purchase + inquiry + booking all present ✅
- `inquiry/free` → "Free" badge + "Enquire" ✅
- Priceless-purchase guard on fee items ✅
- Team (Board & Management) absent (R10-SECT-001) ✅

---

## Archetype 2 — Homeowners Association

### Phase P — Reset: 5 sections, 5 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| About Our Community | about |
| Homeowner Services | items |
| Board of Directors | team |
| Contact Us | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Annual Dues | purchase | fixed | Enquire (priceless-purchase guard) |
| Special Assessment | purchase | fixed | Enquire |
| Amenity Reservation | booking | fixed | Book Now ✅ |
| Architectural Review Request | inquiry | free | Free + Enquire ✅ |
| Maintenance Request | inquiry | free | Free + Enquire ✅ |

### Phase B5
- Same 3-ctaType mix (purchase/booking/inquiry) ✅
- Team (Board of Directors) absent (R10-SECT-001) ✅

---

## Archetype 3 — Property Management Company

### Phase P — Reset: 5 sections, 4 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| About Our Services | about |
| Services | items |
| Owner Testimonials | testimonials |
| Get in Touch | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Management Services Proposal | inquiry | quote | POA + Enquire ✅ |
| Tenant Application | inquiry | free | Free + Enquire ✅ |
| Maintenance Request | inquiry | free | Free + Enquire ✅ |
| Lease Renewal | inquiry | free | Free + Enquire ✅ |

### Phase B5
- "POA" badge confirmed on inquiry/quote item ✅ (extends POA confirmation beyond purchase-only; applies to any ctaType with quote priceType)
- formSchema: **I am a** (select: Property Owner / Current Tenant / Prospective Tenant / HOA Board Member) + Message ✅
- End-to-end: **INQ-6TQF36AQ** ✅ → `/checkout?ref=INQ-6TQF36AQ&type=inquiry` ✅
- Testimonials (Owner Testimonials) absent (R10-SECT-001) ✅

---

## Category summary — HOA & Property Management

| Archetype | Sections | Items | ctaTypes | End-to-end |
|---|---|---|---|---|
| condo-association | 5 | 5 | purchase ×2 + inquiry ×2 + booking ×1 | booking calendar ✅ |
| homeowners-association | 5 | 5 | purchase ×2 + inquiry ×2 + booking ×1 | booking calendar ✅ |
| property-management-company | 5 | 4 | inquiry ×4 | INQ-6TQF36AQ ✅ |

### New findings this run

| Finding | Detail |
|---|---|
| "POA" badge on inquiry/quote item | Confirmed in property-management-company — POA applies to any ctaType with `priceType=quote`, not only purchase items |
| "I am a" role-select formSchema field | property-management-company distinguishes property owner / tenant / prospective tenant / HOA board member at intake |

### Cross-archetype confirmations
| Finding | Status |
|---|---|
| R9-RES-001 (no booking slots) | ✅ Confirmed in condo + HOA common-area booking |
| R10-SECT-001 (team/testimonials null) | ✅ Confirmed ×3 |
| Priceless-purchase guard | ✅ Confirmed (dues + assessments across 2 archetypes) |
| `inquiry/free` → Free badge + Enquire | ✅ Confirmed ×3 archetypes |
| `inquiry/quote` → POA badge + Enquire | ✅ Confirmed (property-management-company) |
