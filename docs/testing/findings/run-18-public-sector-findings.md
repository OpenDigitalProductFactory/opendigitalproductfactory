# Phase W Run 18 — Public Sector Category
**Audit date:** 2026-06-14
**Category:** public-sector
**Archetypes audited:** law-enforcement-agency, municipal-utility, small-town-municipality
**Storefront slug:** `peak-physio-clinic` (archetype reset each time)
**Auditor:** Claude / Phase W systematic test suite
**Branch:** `doc/phase-w-run1-retest`

---

## Archetype 1 — Law Enforcement Agency

### Phase P — Reset: 5 sections, 5 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| About the Department | about |
| Services & Programs | items |
| Command & Staff | team |
| Contact Us | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Request a Records Copy | inquiry | free | Free + Enquire ✅ |
| File a Compliment or Complaint | inquiry | free | Free + Enquire ✅ |
| Alarm Permit Application | inquiry | fixed | Enquire (no badge — null priceAmount) |
| Public Records Request | inquiry | free | Free + Enquire ✅ |
| Community Concern | inquiry | free | Free + Enquire ✅ |

### Phase B5
- All 5 inquiry → "Enquire" ✅
- `inquiry/fixed` with null priceAmount → no badge, just "Enquire" (extends null-priceAmount observation beyond purchase ctaType)
- Team (Command & Staff) absent from DOM (R10-SECT-001) ✅
- Descriptions rendered per item (e.g. "subject to law-enforcement exemptions") ✅

---

## Archetype 2 — Municipal Utility

### Phase P — Reset: 5 sections, 7 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| About Our Utility | about |
| Rates & Services | items |
| Board & Staff | team |
| Contact the Utility | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Report a Leak or Outage | inquiry | free | Free + Enquire ✅ |
| Start or Stop Service | inquiry | free | Free + Enquire ✅ |
| Residential Service | inquiry | from | Enquire (no badge — null priceAmount) |
| Commercial Service | inquiry | from | Enquire (no badge) |
| Irrigation Service | inquiry | from | Enquire (no badge) |
| Service Connection / Tap Fee | inquiry | fixed | Enquire (no badge) |
| Meter Re-Read Request | inquiry | free | Free + Enquire ✅ |

### Phase B5
- Highest item count in public-sector (7) ✅
- All 7 inquiry only ✅
- `inquiry/from` with null priceAmount → no badge (same as `inquiry/fixed` + null priceAmount) ✅
- Team (Board & Staff) absent from DOM (R10-SECT-001) ✅

---

## Archetype 3 — Small Town Municipality

### Phase P — Reset: 5 sections, 6 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| About Our Town | about |
| Departments & Services | items |
| Council & Staff | team |
| Town Hall | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Report an Issue (311) | inquiry | free | Free + Enquire ✅ |
| Building Permit Application | inquiry | fixed | Enquire (no badge) |
| Business License | inquiry | fixed | Enquire (no badge) |
| Public Records Request | inquiry | free | Free + Enquire ✅ |
| Park Pavilion Reservation | **booking** | fixed | Book Now ✅ |
| Special Event Permit | inquiry | fixed | Enquire (no badge) |

### Phase B5
- **Only booking item in public-sector category**: Park Pavilion Reservation
- Booking calendar (`/book/itm-dzCuA_qm`): June 2026 renders, no slots (R9-RES-001) ✅
- inquiry/fixed with null priceAmount → no badge (×3 items) ✅
- Team (Council & Staff) absent from DOM (R10-SECT-001) ✅

---

## Category summary — Public Sector

| Archetype | Sections | Items | ctaTypes | End-to-end |
|---|---|---|---|---|
| law-enforcement-agency | 5 | 5 | inquiry×5 | — |
| municipal-utility | 5 | 7 | inquiry×7 | — |
| small-town-municipality | 5 | 6 | inquiry×5 + booking×1 | booking calendar ✅ |

### Category patterns
- Public-sector is the most inquiry-heavy category in Phase W: 17/18 items are inquiry
- `inquiry/free` is the dominant sub-type (free services to citizens)
- `inquiry/fixed` and `inquiry/from` with null priceAmount → no badge; only `inquiry/free` renders a badge
- Only 1 booking item (Park Pavilion Reservation) across the entire category
- No donation, purchase, or rental ctaTypes in public-sector

### New findings this run

| Finding | Type | Detail |
|---|---|---|
| `inquiry/fixed` + null priceAmount → no badge | Positive | Extends null-priceAmount observation: `inquiry` ctaType with `fixed` or `from` priceType but null amount shows no badge — only `free` renders "Free" badge |

### Cross-archetype confirmations

| Finding | Status |
|---|---|
| R9-RES-001 (no booking slots on fresh reset) | ✅ Confirmed (small-town-municipality pavilion) |
| R10-SECT-001 (team null when empty) | ✅ Confirmed ×3 (all archetypes have team section) |
| `inquiry/free` → Free badge | ✅ Confirmed ×3 archetypes |
| `inquiry/fixed` / `inquiry/from` + null priceAmount → no badge | ✅ Confirmed ×7 items |
