# Phase W Run 13 — Education & Training Category
**Audit date:** 2026-06-14
**Category:** education-training
**Archetypes audited:** corporate-training, driving-school, music-school, tutoring
**Storefront slug:** `peak-physio-clinic` (archetype reset each time)
**Auditor:** Claude / Phase W systematic test suite
**Branch:** `doc/phase-w-run1-retest`

---

## Archetype 1 — Corporate Training

### Phase P
- Reset: 5 sections, 6 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Training Programmes | items |
| About Us | about |
| Client Feedback | testimonials |
| Enquire Now | contact |

| Item | ctaType | priceType |
|---|---|---|
| Leadership Training | inquiry | quote |
| Team Building | inquiry | from |
| Technical Skills Training | inquiry | quote |
| Communication & Presentation | inquiry | from |
| Compliance Training | inquiry | from |
| Bespoke Programme Design | inquiry | quote |

### Phase B5
- All 6 items render "Enquire" (inquiry ctaType, empty ctaLabel) ✅
- **New price badge: "POA"** for `priceType=quote` items (Leadership Training, Technical Skills, Bespoke Programme) — first confirmed in Phase W
- `priceType=from` items show no badge (cross-archetype gap)
- formSchema: **Company name** (required text), **Number of delegates** (select: 1–5 / 6–15 / 16–30 / 31–50 / 50+), **Training needs** (textarea) ✅
- End-to-end: **INQ-RSVPOCVY** ✅ → `/checkout?ref=INQ-RSVPOCVY&type=inquiry` ✅
- Testimonials absent (R10-SECT-001) ✅

---

## Archetype 2 — Driving School

### Phase P
- Reset: 5 sections, 6 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Courses & Lessons | items |
| About Us | about |
| Pass Stories | testimonials |
| Book a Lesson | contact |

| Item | ctaType | priceType | CTA rendered |
|---|---|---|---|
| 1-Hour Lesson | booking | fixed | Book Now ✅ |
| Block of 10 Lessons | purchase | fixed | **Enquire** (priceless-purchase guard) |
| Intensive Week Course | purchase | from | **Enquire** (priceless-purchase guard) |
| Theory Test Preparation | purchase | fixed | **Enquire** (priceless-purchase guard) |
| Pass Plus | purchase | fixed | **Enquire** (priceless-purchase guard) |
| Motorway Lesson | booking | fixed | Book Now ✅ |

### Phase B5
- 2 booking items: "Book Now" ✅
- 4 purchase items with null priceAmount: "Enquire" (priceless-purchase guard) ✅ — same pattern as personal-trainer
- Testimonials absent (R10-SECT-001) ✅

---

## Archetype 3 — Music School

### Phase P
- Reset: 5 sections, 6 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Lessons | items |
| About the School | about |
| Our Teachers | team |
| Enrol Today | contact |

| Item | ctaType | priceType |
|---|---|---|
| Guitar Lessons | booking | per-session |
| Piano Lessons | booking | per-session |
| Drum Lessons | booking | per-session |
| Singing Lessons | booking | per-session |
| Music Theory | booking | per-session |
| Exam Preparation | booking | per-session |

### Phase B5
- All 6 items "Book Now" ✅
- `per-session` priceType: no price badge (cross-archetype gap) ✅
- Team section absent (R10-SECT-001) ✅

---

## Archetype 4 — Tutoring

### Phase P
- Reset: 5 sections, 5 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Subjects | items |
| About | about |
| Parent Reviews | testimonials |
| Book a Trial Session | contact |

| Item | ctaType | priceType |
|---|---|---|
| Maths Tutoring | booking | per-hour |
| English Tutoring | booking | per-hour |
| Science Tutoring | booking | per-hour |
| Exam Preparation | booking | per-hour |
| Online Session | booking | per-hour |

### Phase B5
- All 5 items "Book Now" ✅
- `per-hour` priceType: no price badge (cross-archetype gap) ✅
- Booking calendar (`/book/itm-ArVtgKAp`) renders June 2026 — R9-RES-001 confirmed ✅
- Testimonials absent (R10-SECT-001) ✅

---

## Category summary — Education & Training

| Archetype | Sections | Items | ctaTypes | End-to-end |
|---|---|---|---|---|
| corporate-training | 5 | 6 | inquiry ×6 | INQ-RSVPOCVY ✅ |
| driving-school | 5 | 6 | booking ×2 + purchase ×4 | booking calendar ✅ |
| music-school | 5 | 6 | booking ×6 | booking calendar ✅ |
| tutoring | 5 | 5 | booking ×5 | booking calendar ✅ |

### New findings this run

| Finding | Type | Detail |
|---|---|---|
| "POA" price badge | Positive | `priceType=quote` renders "POA" on storefront cards — confirmed in corporate-training |

### Cross-archetype confirmations
| Finding | Status |
|---|---|
| R9-RES-001 (no slots on fresh reset) | ✅ Confirmed across all booking archetypes |
| R10-SECT-001 (team/testimonials null when empty) | ✅ Confirmed ×4 |
| Priceless-purchase guard ("Enquire" for purchase with no price) | ✅ Confirmed in driving-school (×4 items) |
| `per-session` / `per-hour` priceType: no badge | ✅ Confirmed (music-school + tutoring) |
| `quote` priceType: "POA" badge | ✅ Confirmed (corporate-training) |

### Price badge matrix (complete as of Run 13)

| priceType | Badge rendered | Confirmed in |
|---|---|---|
| fixed | Price amount (if set) | Multiple archetypes |
| from | "From £X" / no badge when null | Multiple archetypes |
| free | "Free" | personal-trainer |
| quote | **"POA"** | corporate-training |
| per-session | No badge | music-school, personal-trainer |
| per-hour | No badge | tutoring |
| donation | Not yet confirmed | — |

### No new defects
All observations are cross-archetype confirmations or positive capability confirmations.
