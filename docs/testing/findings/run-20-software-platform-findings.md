# Phase W Run 20 — Software Platform Category
**Audit date:** 2026-06-14
**Category:** software-platform
**Archetypes audited:** software-platform
**Storefront slug:** `peak-physio-clinic` (archetype reset)
**Auditor:** Claude / Phase W systematic test suite
**Branch:** `doc/phase-w-run1-retest`

---

## Archetype 1 — Software Platform (DPF)

### Phase P — Reset: 5 sections, 3 items ✅

| Section | Type |
|---|---|
| Hero | hero |
| Platform Offers | items |
| How DPF Runs DPF | about |
| Proof & Outcomes | testimonials |
| Talk to Us | contact |

| Item | ctaType | priceType | Rendered CTA |
|---|---|---|---|
| Open Digital Product Factory | inquiry | quote | POA + Enquire ✅ |
| DPF Customer-Zero Workshop | inquiry | quote | POA + Enquire ✅ |
| Governed Build Studio Enablement | inquiry | quote | POA + Enquire ✅ |

### Phase B5
- All 3 items inquiry/quote → "POA" badge + "Enquire" ✅
- formSchema: **Full name** * (text), **Work email** * (email), **Company name** (text), **Team size** (select: 1–10 / 11–50 / 51–200 / 201–1000 / 1000+), **What are you trying to improve?** (textarea)
- End-to-end: **INQ-LM9TFAWJ** ✅ → `/checkout?ref=INQ-LM9TFAWJ&type=inquiry` ✅
- Testimonials (Proof & Outcomes) absent from DOM (R10-SECT-001) ✅

### Notes
- software-platform is DPF selling itself — the archetype populates the operator's own storefront with DPF offers
- Fewest items (3) of any archetype in Phase W
- "Work email" field label (not generic "Email") — software-platform assumes B2B context

---

## Category summary — Software Platform

| Archetype | Sections | Items | ctaTypes | End-to-end |
|---|---|---|---|---|
| software-platform | 5 | 3 | inquiry/quote×3 | INQ-LM9TFAWJ ✅ |

### New findings this run

| Finding | Type | Detail |
|---|---|---|
| "Work email" label override | Positive | software-platform uses "Work email" instead of generic "Email" — field label is schema-driven, not hard-coded |
| Team size select | Positive | B2B segmentation at intake: 1–10 / 11–50 / 51–200 / 201–1000 / 1000+ |
| Lowest item count in Phase W | Observation | 3 items — appropriate for high-touch enterprise sale; no intent to enumerate all plans |

### Cross-archetype confirmations

| Finding | Status |
|---|---|
| R10-SECT-001 (testimonials null) | ✅ Confirmed |
| `inquiry/quote` → POA badge | ✅ Confirmed ×3 items |
| formSchema field labels are schema-driven | ✅ Confirmed — "Work email" vs "Email" differs per archetype |
