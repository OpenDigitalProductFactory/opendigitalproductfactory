# Phase W Run 16 — Nonprofit & Community Category
**Audit date:** 2026-06-14
**Category:** nonprofit-community
**Archetypes audited:** agricultural-cooperative, animal-shelter, charity, community-shelter, cooperative, pet-rescue, sports-club
**Storefront slug:** `peak-physio-clinic` (archetype reset each time)
**Auditor:** Claude / Phase W systematic test suite
**Branch:** `doc/phase-w-run1-retest`

---

## Archetype 1 — Agricultural Cooperative

### Phase P — Reset: 5 sections, 5 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| About Our Co-op | about |
| Shared Machinery | items |
| Board & Committees | team |
| Contact Us | contact |

| Item | ctaType | priceType | ctaLabel | Rendered CTA |
|---|---|---|---|---|
| Combine Harvester | rental | from | "Request booking" | Request booking ✅ |
| Grain Drill/Planter | rental | from | "Request booking" | Request booking ✅ |
| Sprayer | rental | from | "Request booking" | Request booking ✅ |
| Become a Member | inquiry | free | "Join" | Free + Join ✅ |
| Patronage & Equity Inquiry | inquiry | free | (empty) | Free + Enquire ✅ |

### Phase B5
- Rental items route to `/inquire/<itemId>` (no `/rent/` route — rental → inquiry form) ✅
- formSchema: **Full name**, **Email**, **Phone**, **Message**, **Request type** (select: Machinery booking / Membership / Patronage & equity / Board & governance / Other) ✅
- Custom ctaLabel "Request booking" renders instead of default ✅
- Custom ctaLabel "Join" renders on membership item ✅
- Team (Board & Committees) absent from DOM (R10-SECT-001) ✅
- End-to-end: **INQ-HIDPU1SQ** ✅ → `/checkout?ref=INQ-HIDPU1SQ&type=inquiry` ✅

---

## Archetype 2 — Animal Shelter

### Phase P — Reset: 6 sections, 4 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Find Your Perfect Pet | animals-available |
| Ways to Help | items |
| About the Shelter | about |
| Donate Now | donate |
| Contact Us | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Sponsor an Animal | donation | donation | Donation badge + Donate ✅ |
| One-off Donation | donation | donation | Donation badge + Donate ✅ |
| Monthly Giving | donation | donation | Donation badge + Donate ✅ |
| Volunteer Sign-up | inquiry | free | Free + Enquire ✅ |

### Phase B5
- **New ctaType: `donation`** → all items route to `/s/peak-physio-clinic/donate`
- **New priceType: `donation`** → renders "Donation" badge on item card (first in Phase W)
- **`animals-available` section absent from DOM** (no animals data seeded) — extends R10-SECT-001 to this section type ✅
- Donate section renders: "Support Us" heading + "Donate" button → `/donate`
- Donation page (`/s/peak-physio-clinic/donate`): amount presets (£5 / £10 / £25 / £50 / £100) + custom field, email (required), name (optional), message (optional), anonymous toggle
- End-to-end: **DON-ZQYEE3RC** ✅ → `/checkout?ref=DON-ZQYEE3RC&type=donation`
- Checkout message: "❤️ Thank you for your donation!" (distinct from inquiry "✉️ Enquiry received!")
- Inquiry Volunteer Sign-up → `/inquire/itm-Lsjp95dr` ✅

---

## Archetype 3 — Charity

### Phase P — Reset: 5 sections, 5 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Our Mission | about |
| Ways to Give | items |
| Donate Now | donate |
| Get in Touch | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Make a Donation | donation | donation | Donation + Donate ✅ |
| Become a Regular Donor | donation | donation | Donation + Donate ✅ |
| Fundraising Pack | inquiry | free | Free + Enquire ✅ |
| In Memory Giving | donation | donation | Donation + Donate ✅ |
| Corporate Giving | inquiry | quote | POA + Enquire ✅ |

### Phase B5
- 3 donation items → `/donate` ✅
- 1 inquiry/free → Free badge + Enquire ✅
- 1 inquiry/quote → POA badge + Enquire ✅ (cross-archetype confirmation)
- No team/gallery/testimonials sections → no R10-SECT-001 here

---

## Archetype 4 — Community Shelter

### Phase P — Reset: 5 sections, 4 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| How You Can Help | items |
| About Us | about |
| Donate | donate |
| Get Involved | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Emergency Fund Donation | donation | donation | Donation + Donate ✅ |
| Volunteer Sign-up | inquiry | free | Free + Enquire ✅ |
| Supply Donation | donation | donation | Donation + Donate ✅ |
| Corporate Partnership | inquiry | quote | POA + Enquire ✅ |

### Phase B5
- Same donation + inquiry pattern as charity/animal-shelter ✅
- inquiry/quote → POA badge confirmed ✅

---

## Archetype 5 — Cooperative

### Phase P — Reset: 5 sections, 4 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| About Our Co-op | about |
| Products & Services | items |
| Board & Committees | team |
| Contact Us | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Membership Share | purchase | fixed | Enquire (priceless-purchase guard) |
| Membership Application | inquiry | free | Free + Enquire ✅ |
| Member Account Question | inquiry | free | Free + Enquire ✅ |
| Patronage & Equity Inquiry | inquiry | free | Free + Enquire ✅ |

### Phase B5
- Priceless-purchase guard on Membership Share (no priceAmount in seed) ✅
- 3 inquiry/free → "Free" badge + "Enquire" ✅
- Team (Board & Committees) absent from DOM (R10-SECT-001) ✅

---

## Archetype 6 — Pet Rescue

### Phase P — Reset: 6 sections, 4 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Animals Available for Adoption | animals-available |
| Support Us | items |
| About Us | about |
| Make a Donation | donate |
| Get in Touch | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Sponsor an Animal | donation | donation | Donation + Donate ✅ |
| One-off Donation | donation | donation | Donation + Donate ✅ |
| Monthly Giving | donation | donation | Donation + Donate ✅ |
| Adopt a Pet | inquiry | free | Free + Enquire ✅ |

### Phase B5
- `animals-available` section absent (R10-SECT-001 extended) ✅
- donation/donate flow confirmed (cross-archetype from animal-shelter) ✅
- inquiry/free "Adopt a Pet" → `/inquire/itm-5_38fkpJ` ✅

---

## Archetype 7 — Sports Club

### Phase P — Reset: 5 sections, 5 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Memberships | items |
| About the Club | about |
| Club Officials | team |
| Join the Club | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Annual Membership | purchase | fixed | Enquire (priceless-purchase guard) |
| Family Membership | purchase | fixed | Enquire |
| Junior Membership | purchase | fixed | Enquire |
| Match Day Ticket | purchase | fixed | Enquire |
| Social Membership | purchase | fixed | Enquire |

### Phase B5
- All 5 purchase/fixed items with null priceAmount → priceless-purchase guard → "Enquire" ✅
- Highest purchase-item count in nonprofit-community (5/5)
- Team (Club Officials) absent from DOM (R10-SECT-001) ✅

---

## Category summary — Nonprofit & Community

| Archetype | Sections | Items | ctaTypes | End-to-end |
|---|---|---|---|---|
| agricultural-cooperative | 5 | 5 | rental×3 + inquiry×2 | INQ-HIDPU1SQ ✅ |
| animal-shelter | 6 | 4 | donation×3 + inquiry×1 | DON-ZQYEE3RC ✅ |
| charity | 5 | 5 | donation×3 + inquiry×2 | donation flow ✅ |
| community-shelter | 5 | 4 | donation×2 + inquiry×2 | donation flow ✅ |
| cooperative | 5 | 4 | purchase×1 + inquiry×3 | — |
| pet-rescue | 6 | 4 | donation×3 + inquiry×1 | donation flow ✅ |
| sports-club | 5 | 5 | purchase×5 | — |

### New findings this run

| Finding | Type | Detail |
|---|---|---|
| **`ctaType=donation` → `/donate`** | New capability | All donation items route to `/s/{slug}/donate`; no item-level route |
| **`priceType=donation` → "Donation" badge** | New capability | Distinct badge (not Free/POA/price amount); first seen in animal-shelter |
| **Donation page** | New capability | `/donate` — preset amounts £5/10/25/50/100 + custom, email, name, message, anonymous toggle |
| **DON- ref prefix** | New capability | Donation submissions return `DON-XXXXXXXX` ref (vs `INQ-` for inquiries) |
| **Donation checkout** | New capability | "❤️ Thank you for your donation!" (distinct from inquiry and booking checkout messages) |
| **`animals-available` section null** | R10-SECT-001 extended | Null when no animals data seeded — same pattern as team/gallery/testimonials |
| **agricultural-cooperative formSchema** | Positive | Domain-specific Request type select: Machinery booking / Membership / Patronage & equity / Board & governance / Other |
| **rental ctaType → inquiry route** | Positive | No `/rent/` route exists; rental items route to `/inquire/<itemId>` ✅ |

### Cross-archetype confirmations

| Finding | Status |
|---|---|
| R10-SECT-001 (team/gallery/testimonials null when empty) | ✅ Confirmed ×4 (ag-coop, cooperative, pet-rescue, sports-club) |
| R10-SECT-001 extended: `animals-available` null | ✅ Confirmed ×2 (animal-shelter, pet-rescue) |
| Priceless-purchase guard | ✅ Confirmed ×6 items (cooperative, sports-club) |
| `inquiry/free` → Free badge + Enquire | ✅ Confirmed ×5 archetypes |
| `inquiry/quote` → POA badge + Enquire | ✅ Confirmed (charity, community-shelter) |
| Custom ctaLabel renders on storefront | ✅ Confirmed (agricultural-cooperative: "Request booking", "Join") |

### Updated priceType badge matrix

| priceType | Badge rendered | Confirmed in |
|---|---|---|
| fixed | Price amount (if set) | Multiple archetypes |
| from | "From £X" / no badge when null | Multiple archetypes |
| free | "Free" | personal-trainer, animal-shelter, charity, et al. |
| quote | "POA" | corporate-training, charity, community-shelter |
| donation | **"Donation"** | animal-shelter, charity, community-shelter, pet-rescue |
| per-session | No badge | music-school, personal-trainer |
| per-hour | No badge | tutoring |
