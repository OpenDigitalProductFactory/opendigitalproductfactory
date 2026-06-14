# Phase W Run 19 — Retail Goods Category
**Audit date:** 2026-06-14
**Category:** retail-goods
**Archetypes audited:** artisan-goods, florist, retail-goods, wholesale-distribution
**Storefront slug:** `peak-physio-clinic` (archetype reset each time)
**Auditor:** Claude / Phase W systematic test suite
**Branch:** `doc/phase-w-run1-retest`

---

## Archetype 1 — Artisan Goods

### Phase P — Reset: 5 sections, 5 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Shop | items |
| The Maker's Story | about |
| Gallery | gallery |
| Get in Touch | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Handmade Item | purchase | fixed | Enquire (priceless-purchase guard) |
| Custom Commission | inquiry | quote | POA + Enquire ✅ |
| Workshop Booking | booking | fixed | Book Now ✅ |
| Gift Set | purchase | fixed | Enquire (priceless-purchase guard) |
| Seasonal Collection | purchase | from | Enquire (priceless-purchase guard) |

### Phase B5
- Mixed ctaType: purchase×3, inquiry/quote×1, booking×1 ✅
- inquiry/quote → POA badge ✅
- booking/fixed → "Book Now" / `/book/<itemId>` ✅
- Gallery absent from DOM (R10-SECT-001) ✅

---

## Archetype 2 — Florist

### Phase P — Reset: 5 sections, 6 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Arrangements | items |
| Our Work | gallery |
| About Us | about |
| Order Flowers | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Seasonal Bouquet | purchase | from | Enquire (priceless-purchase guard) |
| Bespoke Arrangement | purchase | from | Enquire (priceless-purchase guard) |
| Wedding Flowers | inquiry | quote | POA + Enquire ✅ |
| Dried Flower Arrangement | purchase | from | Enquire (priceless-purchase guard) |
| Funeral Tribute | inquiry | from | Enquire (no badge) |
| Corporate Flowers | inquiry | from | Enquire (no badge) |

### Phase B5
- purchase/from×3 with null priceAmount → priceless-purchase guard ✅
- inquiry/quote → POA ✅
- inquiry/from + null priceAmount → no badge (confirmation)
- Gallery (Our Work) absent from DOM (R10-SECT-001) ✅

---

## Archetype 3 — Retail Goods (generic)

### Phase P — Reset: 5 sections, 5 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Shop | items |
| About Us | about |
| Products | gallery |
| Contact Us | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Featured Product 1 | purchase | fixed | Enquire (priceless-purchase guard) |
| Featured Product 2 | purchase | fixed | Enquire |
| Gift Voucher | purchase | from | Enquire |
| Bundle Deal | purchase | from | Enquire |
| New Arrival | purchase | fixed | Enquire |

### Phase B5
- All 5 purchase items with null priceAmount → priceless-purchase guard → "Enquire" ✅
- Generic item names ("Featured Product 1/2") — expected for generic archetype placeholder
- Gallery (Products) absent from DOM (R10-SECT-001) ✅

---

## Archetype 4 — Wholesale Distribution

### Phase P — Reset: 5 sections, 5 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Trade & Wholesale | items |
| About Us | about |
| Our Range | gallery |
| Open a Trade Account | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Trade Catalogue | inquiry | quote | POA + Enquire ✅ |
| Open a Trade Account | inquiry | free | Free + Enquire ✅ |
| Become a Stockist | inquiry | quote | POA + Enquire ✅ |
| Distributor Program | inquiry | quote | POA + Enquire ✅ |
| Bulk / Pallet Order | inquiry | from | Enquire (no badge) |

### Phase B5
- 3 inquiry/quote → "POA" badge (highest POA density in retail-goods) ✅
- inquiry/free → "Free" badge ✅
- inquiry/from + null priceAmount → no badge ✅
- Gallery (Our Range) absent from DOM (R10-SECT-001) ✅

---

## Category summary — Retail Goods

| Archetype | Sections | Items | ctaTypes | End-to-end |
|---|---|---|---|---|
| artisan-goods | 5 | 5 | purchase×3 + inquiry/quote×1 + booking×1 | booking calendar ✅ |
| florist | 5 | 6 | purchase×3 + inquiry×3 | — |
| retail-goods | 5 | 5 | purchase×5 | — |
| wholesale-distribution | 5 | 5 | inquiry×5 | — |

### Category patterns
- Gallery section present in all 4 archetypes — all absent from DOM (R10-SECT-001 ×4)
- Retail-goods archetypes with physical products rely on priceless-purchase guard (prices not seeded)
- Wholesale sub-category (wholesale-distribution) skips purchase entirely → all inquiry; heavy POA use (3/5 items)
- `inquiry/from` + null priceAmount → no badge (consistent with law-enforcement, public-sector findings)

### Cross-archetype confirmations

| Finding | Status |
|---|---|
| R10-SECT-001 (gallery null when empty) | ✅ Confirmed ×4 archetypes |
| Priceless-purchase guard | ✅ Confirmed ×11 items across artisan-goods + florist + retail-goods |
| `inquiry/quote` → POA badge | ✅ Confirmed (artisan-goods, florist, wholesale ×3) |
| `inquiry/from` + null priceAmount → no badge | ✅ Confirmed (florist, wholesale) |
| R9-RES-001 (no booking slots) | ✅ Confirmed (artisan-goods Workshop Booking) |
