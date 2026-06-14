# Phase W Run 14 — Fitness & Recreation Category
**Audit date:** 2026-06-14
**Category:** fitness-recreation
**Archetypes audited:** dance-studio, gym, yoga-studio
**Storefront slug:** `peak-physio-clinic` (archetype reset each time)
**Auditor:** Claude / Phase W systematic test suite
**Branch:** `doc/phase-w-run1-retest`

---

## Archetype 1 — Dance Studio

### Phase P — Reset: 5 sections, 5 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Classes | items |
| About the Studio | about |
| Performances | gallery |
| Join Us | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Term Booking | purchase | fixed | Enquire (priceless-purchase guard) |
| Trial Class | booking | free | Free + Book Now ✅ |
| Private Lesson | booking | per-session | Book Now ✅ |
| Drop-in Class | booking | fixed | Book Now ✅ |
| Exam Preparation | booking | per-session | Book Now ✅ |

### Phase B5
- "Free" badge renders on Trial Class (priceType=free) ✅
- Priceless-purchase guard active on Term Booking ✅
- Gallery absent (R10-SECT-001) ✅

---

## Archetype 2 — Gym

### Phase P — Reset: 5 sections, 6 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Memberships | items |
| About the Gym | about |
| Facilities | gallery |
| Join Today | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Monthly Membership | purchase | fixed | Enquire (priceless-purchase guard) |
| Day Pass | purchase | fixed | Enquire |
| Personal Training | booking | per-session | Book Now ✅ |
| Annual Membership | purchase | fixed | Enquire |
| Student Membership | purchase | fixed | Enquire |
| Family Membership | purchase | from | Enquire |

### Phase B5
- 5 priceless-purchase items → "Enquire" ✅ (strongest single-archetype priceless-purchase count in Phase W)
- 1 booking item → "Book Now" ✅
- Gallery absent (R10-SECT-001) ✅

---

## Archetype 3 — Yoga Studio

### Phase P — Reset: 5 sections, 6 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Classes & Passes | items |
| About the Studio | about |
| Our Instructors | team |
| Join a Class | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Class Pack (10 classes) | purchase | fixed | Enquire (priceless-purchase guard) |
| Monthly Unlimited | purchase | fixed | Enquire |
| Drop-in Class | booking | fixed | Book Now ✅ |
| Private Session | booking | per-session | Book Now ✅ |
| Beginners Course | purchase | fixed | Enquire |
| Retreat Day | purchase | fixed | Enquire |

### Phase B5
- 4 priceless-purchase → "Enquire" ✅
- 2 booking → "Book Now" ✅
- Team (Our Instructors) absent (R10-SECT-001) ✅

---

## Category summary — Fitness & Recreation

| Archetype | Sections | Items | ctaTypes | Priceless-purchase items |
|---|---|---|---|---|
| dance-studio | 5 | 5 | booking ×4 + purchase ×1 | 1 |
| gym | 5 | 6 | booking ×1 + purchase ×5 | 5 |
| yoga-studio | 5 | 6 | booking ×2 + purchase ×4 | 4 |

### Category patterns
- Fitness-recreation is the heaviest user of `purchase` ctaType seen in Phase W — gym has 5/6 items as purchase
- All purchase items have null priceAmount → priceless-purchase guard consistently active
- `purchase` + null price → "Enquire" (routes to inquiry form) is the de facto membership inquiry flow
- `gallery` + `team` sections present but absent from DOM (R10-SECT-001) ✅
- No end-to-end inquiry submitted — priceless-purchase guard routes to standard inquiry form (already confirmed in personal-trainer and driving-school)

### Cross-archetype confirmations
| Finding | Status |
|---|---|
| R9-RES-001 (no slots on fresh reset) | ✅ Confirmed — booking items across all 3 archetypes |
| R10-SECT-001 (gallery/team null when empty) | ✅ Confirmed ×3 |
| Priceless-purchase guard | ✅ Confirmed ×10 items across 3 archetypes |
| `free` badge renders | ✅ Confirmed (dance-studio Trial Class) |
