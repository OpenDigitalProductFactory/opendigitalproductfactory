# Phase W Run 17 — Pet Services Category
**Audit date:** 2026-06-14
**Category:** pet-services
**Archetypes audited:** dog-walking, pet-boarding, pet-grooming
**Storefront slug:** `peak-physio-clinic` (archetype reset each time)
**Auditor:** Claude / Phase W systematic test suite
**Branch:** `doc/phase-w-run1-retest`

---

## Archetype 1 — Dog Walking

### Phase P — Reset: 5 sections, 5 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Walking Packages | items |
| About Us | about |
| Happy Dog Owners | testimonials |
| Book a Walk | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| 30-Minute Walk | booking | fixed | Book Now ✅ |
| 60-Minute Walk | booking | fixed | Book Now ✅ |
| Solo Walk | booking | from | Book Now ✅ |
| Puppy Visit | booking | fixed | Book Now ✅ |
| Weekly Package | purchase | fixed | Enquire (priceless-purchase guard) |

### Phase B5
- 4 booking items → "Book Now" ✅
- 1 purchase/fixed with null priceAmount → priceless-purchase guard → "Enquire" ✅
- Testimonials (Happy Dog Owners) absent from DOM (R10-SECT-001) ✅

---

## Archetype 2 — Pet Boarding

### Phase P — Reset: 6 sections, 5 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Boarding Options | items |
| Our Facilities | about |
| Our Space | gallery |
| Pet Owner Reviews | testimonials |
| Book a Stay | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Dog Boarding (per night) | booking | per-session | Book Now ✅ |
| Cat Boarding (per night) | booking | per-session | Book Now ✅ |
| Dog Day Care | booking | fixed | Book Now ✅ |
| Small Animal Boarding | booking | per-session | Book Now ✅ |
| Meet & Greet | booking | free | Free + Book Now ✅ |

### Phase B5
- All 5 items booking → "Book Now" ✅
- `priceType=free` on Meet & Greet → "Free" badge ✅
- `priceType=per-session` → no price badge (cross-archetype) ✅
- Gallery (Our Space) absent from DOM (R10-SECT-001) ✅
- Testimonials (Pet Owner Reviews) absent from DOM (R10-SECT-001) ✅

---

## Archetype 3 — Pet Grooming

### Phase P — Reset: 5 sections, 6 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Grooming Services | items |
| About Us | about |
| Our Grooming Results | gallery |
| Book a Groom | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Full Groom | booking | from | Book Now ✅ |
| Bath & Brush | booking | from | Book Now ✅ |
| Puppy Groom | booking | fixed | Book Now ✅ |
| Nail Trim | booking | fixed | Book Now ✅ |
| De-shedding Treatment | booking | from | Book Now ✅ |
| Cat Grooming | booking | from | Book Now ✅ |

### Phase B5
- All 6 items booking → "Book Now" ✅
- `priceType=from` with no priceAmount → no badge (cross-archetype) ✅
- Gallery (Our Grooming Results) absent from DOM (R10-SECT-001) ✅

---

## Category summary — Pet Services

| Archetype | Sections | Items | ctaTypes | End-to-end |
|---|---|---|---|---|
| dog-walking | 5 | 5 | booking×4 + purchase×1 | booking calendar ✅ |
| pet-boarding | 6 | 5 | booking×5 | booking calendar ✅ |
| pet-grooming | 5 | 6 | booking×6 | booking calendar ✅ |

### Category patterns
- Dominant ctaType: `booking` — all 16 items are booking except 1 purchase (dog-walking weekly package)
- `priceType` variety: fixed, from, per-session, free all appear; no quote or donation
- `free` badge on Meet & Greet confirms booking/free combination renders correctly
- Per-session: no badge (consistent with music-school/personal-trainer)
- No new defects

### Cross-archetype confirmations

| Finding | Status |
|---|---|
| R9-RES-001 (no booking slots on fresh reset) | ✅ Confirmed all 3 archetypes |
| R10-SECT-001 (gallery/testimonials null when empty) | ✅ Confirmed ×3 (gallery ×2, testimonials ×2) |
| Priceless-purchase guard | ✅ Confirmed (dog-walking Weekly Package) |
| `free` badge on booking item | ✅ Confirmed (pet-boarding Meet & Greet) |
| `per-session` priceType: no badge | ✅ Confirmed (pet-boarding) |
