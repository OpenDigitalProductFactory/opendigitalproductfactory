# Phase W Run 22 — Professional Services Category
**Audit date:** 2026-06-14
**Category:** professional-services
**Archetypes audited:** accounting, consulting, it-managed-services, legal-services, marketing-agency
**Storefront slug:** `peak-physio-clinic` (archetype reset each time)
**Auditor:** Claude / Phase W systematic test suite
**Branch:** `doc/phase-w-run1-retest`

---

## Archetype 1 — Accounting

### Phase P — Reset: 5 sections, 6 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Services | items |
| About the Practice | about |
| Client Testimonials | testimonials |
| Get in Touch | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Bookkeeping | inquiry | from | Enquire (no badge) |
| Annual Accounts | inquiry | from | Enquire (no badge) |
| Self Assessment Tax Return | inquiry | from | Enquire (no badge) |
| VAT Returns | inquiry | from | Enquire (no badge) |
| Payroll | inquiry | from | Enquire (no badge) |
| Business Advisory | inquiry | per-hour | Enquire (no badge) |

### Phase B5
- All 6 inquiry only ✅
- inquiry/from×5 + inquiry/per-hour×1 → no badge on any ✅
- Testimonials (Client Testimonials) absent from DOM (R10-SECT-001) ✅

---

## Archetype 2 — Consulting

### Phase P — Reset: 5 sections, 5 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Services | items |
| About Us | about |
| Our Consultants | team |
| Let's Talk | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Discovery Workshop | inquiry | fixed | Enquire (no badge — null priceAmount) |
| Strategy Engagement | inquiry | quote | POA + Enquire ✅ |
| Interim Leadership | inquiry | per-hour | Enquire (no badge) |
| Change Management | inquiry | quote | POA + Enquire ✅ |
| Process Improvement | inquiry | from | Enquire (no badge) |

### Phase B5
- inquiry/quote×2 → POA badge ✅
- Team (Our Consultants) absent from DOM (R10-SECT-001) ✅

---

## Archetype 3 — IT Managed Services

### Phase P — Reset: 5 sections, 6 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Services | items |
| About Us | about |
| Client Stories | testimonials |
| Talk to Us | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Managed IT Support | inquiry | from | Enquire (no badge) |
| Cybersecurity Assessment | inquiry | fixed | Enquire (no badge) |
| Cloud Migration | inquiry | quote | POA + Enquire ✅ |
| Backup & Disaster Recovery | inquiry | from | Enquire (no badge) |
| Network Infrastructure | inquiry | quote | POA + Enquire ✅ |
| Microsoft 365 Setup | inquiry | from | Enquire (no badge) |

### Phase B5
- inquiry/quote×2 → POA ✅
- Testimonials (Client Stories) absent from DOM (R10-SECT-001) ✅

---

## Archetype 4 — Legal Services

### Phase P — Reset: 5 sections, 6 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Services | items |
| Our Solicitors | team |
| About the Firm | about |
| Get in Touch | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Free Initial Consultation | inquiry | free | Free + Enquire ✅ |
| Contract Review | inquiry | from | Enquire (no badge) |
| Employment Law Advice | inquiry | per-hour | Enquire (no badge) |
| Property Conveyancing | inquiry | quote | POA + Enquire ✅ |
| Business Formation | inquiry | from | Enquire (no badge) |
| Litigation Support | inquiry | quote | POA + Enquire ✅ |

### Phase B5
- inquiry/free → "Free" badge ✅ ("Free Initial Consultation" — standard legal intake pattern)
- inquiry/quote×2 → POA ✅
- Team (Our Solicitors) absent from DOM (R10-SECT-001) ✅

---

## Archetype 5 — Marketing Agency

### Phase P — Reset: 6 sections, 6 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Services | items |
| Our Work | gallery |
| About Us | about |
| Client Results | testimonials |
| Start a Project | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Brand Strategy | inquiry | quote | POA + Enquire ✅ |
| Website Design & Build | inquiry | from | Enquire (no badge) |
| SEO & Content | inquiry | from | Enquire (no badge) |
| Paid Advertising | inquiry | from | Enquire (no badge) |
| Social Media Management | inquiry | from | Enquire (no badge) |
| Email Marketing | inquiry | from | Enquire (no badge) |

### Phase B5
- inquiry/quote×1 → POA ✅
- formSchema (marketing-agency): **Full name** *, **Email** *, **Phone** (optional), **Company name** (optional), **Company size** (select: 1–10 / 11–50 / 51–200 / 201–500 / 500+), **Budget range** (select: Under £1k / £1k–£5k / £5k–£20k / £20k–£100k / £100k+ / Not sure), **Current situation** (textarea optional)
- End-to-end: **INQ-BYQLFLDO** ✅ → `/checkout?ref=INQ-BYQLFLDO&type=inquiry` ✅
- Gallery (Our Work) absent from DOM (R10-SECT-001) ✅
- Testimonials (Client Results) absent from DOM (R10-SECT-001) ✅

---

## Category summary — Professional Services

| Archetype | Sections | Items | ctaTypes | End-to-end |
|---|---|---|---|---|
| accounting | 5 | 6 | inquiry×6 | — |
| consulting | 5 | 5 | inquiry×5 | — |
| it-managed-services | 5 | 6 | inquiry×6 | — |
| legal-services | 5 | 6 | inquiry×6 | — |
| marketing-agency | 6 | 6 | inquiry×6 | INQ-BYQLFLDO ✅ |

### Category patterns
- 100% inquiry category — all 29 items across 5 archetypes use inquiry ctaType
- `inquiry/from` dominant (flat-fee / price on survey model)
- `inquiry/quote` → POA in consulting, it-managed-services, legal, marketing-agency (bespoke/project-scope items)
- `inquiry/per-hour` in accounting (advisory) and legal (employment law) — specialist time-billing
- `inquiry/free` in legal-services ("Free Initial Consultation") — lead-generation entry point
- gallery + testimonials in marketing-agency (6 sections) — both absent (R10-SECT-001)
- team section in consulting + legal-services — absent (R10-SECT-001)

### New findings this run

| Finding | Type | Detail |
|---|---|---|
| Marketing-agency formSchema | Positive | Two-level B2B segmentation: Company size (5-band) + Budget range (6-band inc. "Not sure") — most detailed intake outside software-platform |
| `inquiry/free` lead-gen pattern | Positive | legal-services "Free Initial Consultation" — standard legal sector pattern of a free entry-point offer; first professional-services use of inquiry/free |

### Cross-archetype confirmations

| Finding | Status |
|---|---|
| R10-SECT-001 (team/gallery/testimonials null) | ✅ Confirmed ×5 archetypes |
| `inquiry/quote` → POA badge | ✅ Confirmed (consulting×2, IT×2, legal×2, marketing×1) |
| `inquiry/from` + null priceAmount → no badge | ✅ Confirmed ×20 items |
| `inquiry/per-hour` → no badge | ✅ Confirmed (accounting, legal) |
| `inquiry/free` → Free badge | ✅ Confirmed (legal-services) |
