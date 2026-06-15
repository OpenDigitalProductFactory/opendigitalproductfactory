# Phase W Run 11 — Banking & Financial Services Category
**Audit date:** 2026-06-14
**Category:** banking-financial-services
**Archetypes audited:** community-bank, credit-union, mortgage-lending
**Storefront slug:** `peak-physio-clinic` (archetype reset applied each time)
**Auditor:** Claude / Phase W systematic test suite
**Branch:** `doc/phase-w-run1-retest`

---

## Archetype 1 — Community Bank

### Phase P — Admin / Storefront Setup

**Archetype reset:** POST `/api/storefront/admin/archetype-reset` `{targetArchetypeId: 'community-bank'}` ✅

#### Storefront sections (6 total)
| # | Section name | Section type |
|---|---|---|
| 1 | Hero | hero |
| 2 | Our Products & Services | items |
| 3 | About the Bank | about |
| 4 | Our Team | team |
| 5 | Contact Us | contact |
| 6 | Regulatory Disclosures | **disclosures** |

**New section type: `disclosures`** — first appearance across all Phase W testing. Handled in `SectionRenderer.tsx` line 44. Renders compliance/regulatory placeholder when no `licenseDisplayObligation` records are seeded.

#### Menu items (8 total)
| Item | ctaType | priceType | ctaLabel (DB) |
|---|---|---|---|
| Personal Checking | inquiry | free | (empty) |
| Savings Account | inquiry | free | (empty) |
| CD / Term Deposit | inquiry | free | (empty) |
| Personal Loan | inquiry | free | (empty) |
| **Business Checking** | inquiry | free | Apply |
| **Mortgage Loan** | inquiry | free | Apply |
| **Business Loan** | inquiry | free | Apply |
| Meet with a Banker | **booking** | free | (empty) |

Mixed ctaType pattern: 7 inquiry items (2 with custom "Apply" label) + 1 booking item. First archetype in Phase W with a booking item alongside inquiry items.

#### formSchema — community-bank specific
| Field | Type | Options |
|---|---|---|
| Full name | text | — |
| Email | email | — |
| Phone | tel | — |
| **Product interest** | select | Personal Checking / Savings / CD / Personal Loan / Business Checking / Mortgage / Business Loan / Other |
| **Existing customer?** | select | Yes / No |
| Message | textarea | — |

Two banking-specific fields: product interest dropdown and existing-customer flag.

### Phase B5 — Public Storefront

**CTA routing — all 8 items:**
| Item | Rendered CTA | Result |
|---|---|---|
| Personal Checking | Enquire | ✅ (empty ctaLabel → fallback) |
| Savings Account | Enquire | ✅ |
| CD / Term Deposit | Enquire | ✅ |
| Personal Loan | Enquire | ✅ |
| Business Checking | **Apply** | ✅ (stored ctaLabel rendered) |
| Mortgage Loan | **Apply** | ✅ |
| Business Loan | **Apply** | ✅ |
| Meet with a Banker | Book | ✅ (booking CTA) |

"Apply" renders correctly for 3 items — confirms `ctaLabel` stored and rendered for inquiry items.

**Booking item:** "Meet with a Banker" routes to calendar slot picker. No availability slots shown (R9-RES-001 — cross-archetype, no slots seeded on archetype reset).

**Disclosures section:** Renders on storefront with placeholder text "Regulatory disclosures and licensing information will appear here." ✅ — section type renders; content empty on fresh reset.

**End-to-end inquiry:** Submitted for Business Checking — product interest "Business Checking", existing customer "No".
Reference: **INQ-5CGJCOUA** ✅ → redirect to `/checkout?ref=INQ-5CGJCOUA&type=inquiry` ✅

### Phase G — Finance

| Observation | Value | Expected | Result |
|---|---|---|---|
| Default currency | GBP | USD | R9-G-001 confirmed |
| Finance Specialist visible | ✅ | — | |
| Default tax rate | 20% | — | R9-G-003 confirmed |

No community-bank-specific Finance gaps.

---

## Archetype 2 — Credit Union

### Phase P — Admin / Storefront Setup

**Archetype reset:** POST `/api/storefront/admin/archetype-reset` `{targetArchetypeId: 'credit-union'}` ✅

#### Storefront sections (6 total)
| # | Section name | Section type |
|---|---|---|
| 1 | Hero | hero |
| 2 | Member Products | items |
| 3 | About Our Credit Union | about |
| 4 | Our Team | team |
| 5 | Contact Us | contact |
| 6 | Regulatory Disclosures | disclosures |

Same 6-section pattern as community-bank including disclosures.

#### Menu items (8 total)
| Item | ctaType | priceType | ctaLabel (DB) |
|---|---|---|---|
| Share Savings Account | inquiry | free | (empty) |
| Checking Account | inquiry | free | (empty) |
| Auto Loan | inquiry | free | Apply |
| Home Equity Loan | inquiry | free | Apply |
| Personal Loan | inquiry | free | Apply |
| Credit Card | inquiry | free | Apply |
| **Become a Member** | inquiry | free | **Join** |
| Meet with an Advisor | booking | free | (empty) |

Notable: "Become a Member" with `ctaLabel="Join"` — three distinct custom labels in one archetype ("Apply" ×4, "Join" ×1). Credit unions seed heavier ctaLabel customisation than community-bank.

### Phase B5 — Public Storefront

**CTA rendering:**
- "Join" renders on "Become a Member" card ✅ — confirms stored label respected
- "Apply" renders on 4 loan/card items ✅
- "Enquire" fallback on 2 savings/checking items ✅
- "Book" on Meet with an Advisor ✅

**End-to-end inquiry:** Submitted for Become a Member item — name "Phase W R11 Credit Union Test", email phaseW@dpftest.com.
Reference: **INQ-A7MHFX2K** ✅ → `/checkout?ref=INQ-A7MHFX2K&type=inquiry` ✅

### Phase G — Finance

Same cross-archetype gaps (R9-G-001, R9-G-003). No credit-union-specific Finance gaps.

---

## Archetype 3 — Mortgage Lending

### Phase P — Admin / Storefront Setup

**Archetype reset:** POST `/api/storefront/admin/archetype-reset` `{targetArchetypeId: 'mortgage-lending'}` ✅

#### Storefront sections (7 total)
| # | Section name | Section type |
|---|---|---|
| 1 | Hero | hero |
| 2 | Our Loan Products | items |
| 3 | About Us | about |
| 4 | Our Team | team |
| 5 | Client Testimonials | testimonials |
| 6 | Contact Us | contact |
| 7 | Regulatory Disclosures | disclosures |

7-section layout is the largest seen in Phase W (previously max was 6). **New section type: `testimonials`** — confirmed in `SectionRenderer.tsx` alongside team; same `null` return when `content={}` (R10-SECT-001 cross-archetype).

#### Menu items (6 total)
| Item | ctaType | priceType | ctaLabel (DB) |
|---|---|---|---|
| Pre-Approval | inquiry | free | **Get pre-approved** |
| Purchase Mortgage | inquiry | free | **Apply** |
| Refinance | inquiry | free | **Apply** |
| HELOC | inquiry | free | **Apply** |
| Rate Quote | inquiry | free | **Get a quote** |
| Meet with a Loan Officer | booking | free | (empty) |

Heaviest ctaLabel customisation seen across all Phase W archetypes: 5 distinct labels across 5 inquiry items. Every inquiry item has a custom label; only the booking item uses the fallback.

#### formSchema — mortgage-lending specific
| Field | Type | Options |
|---|---|---|
| Full name | text | — |
| Email | email | — |
| Phone | tel | — |
| **Loan purpose** | select | Purchase / Refinance / Cash-out refinance / HELOC / Pre-approval / Not sure |
| **Property type** | select | Single family / Condo / townhome / Multi-family / Manufactured / Land |
| **Estimated price range** | select | Under $200k / $200k–$400k / $400k–$700k / $700k–$1M / $1M+ |
| Tell us about your scenario | textarea | — |

Most complex formSchema seen in Phase W: 3 select dropdowns, all mortgage-specific. Loan purpose and property type cover the full standard taxonomy.

### Phase B5 — Public Storefront

**CTA rendering — all 6 items:**
| Item | Rendered CTA | Result |
|---|---|---|
| Pre-Approval | **Get pre-approved** | ✅ |
| Purchase Mortgage | **Apply** | ✅ |
| Refinance | **Apply** | ✅ |
| HELOC | **Apply** | ✅ |
| Rate Quote | **Get a quote** | ✅ |
| Meet with a Loan Officer | Book | ✅ |

All 5 custom labels render correctly.

**Enquiry form — Pre-Approval item:**
- URL: `/s/peak-physio-clinic/inquire/itm-_-PHVxc7`
- Heading: "Enquire about Pre-Approval" (hardcoded "Enquire" — same heading gap as rental ctaType; the rendered CTA was "Get pre-approved" but the form heading doesn't reflect it)
- All 3 mortgage-specific select dropdowns rendered and functional ✅
- Loan purpose / Property type / Price range all submitted successfully

**End-to-end inquiry:**
Reference: **INQ-0B6DGGV9** ✅ → `/checkout?ref=INQ-0B6DGGV9&type=inquiry` ✅

### Phase G — Finance

Same cross-archetype gaps (R9-G-001, R9-G-003). No mortgage-lending-specific Finance gaps.

---

## Category summary — Banking & Financial Services

| Dimension | community-bank | credit-union | mortgage-lending |
|---|---|---|---|
| Sections | 6 (incl. disclosures) | 6 (incl. disclosures) | 7 (incl. disclosures + testimonials) |
| Items | 8 | 8 | 6 |
| ctaTypes | inquiry ×7 + booking ×1 | inquiry ×7 + booking ×1 | inquiry ×5 + booking ×1 |
| Custom ctaLabels | Apply (×3) | Apply (×4), Join (×1) | Get pre-approved, Apply (×3), Get a quote |
| formSchema distinct fields | product interest, existing customer | (same as community-bank pattern) | loan purpose, property type, price range |
| New section types | disclosures | disclosures | disclosures + testimonials |
| End-to-end inquiry | INQ-5CGJCOUA ✅ | INQ-A7MHFX2K ✅ | INQ-0B6DGGV9 ✅ |
| Booking (no slots) | Meet with a Banker | Meet with an Advisor | Meet with a Loan Officer |

### New section types confirmed this run

| Type | Archetype first seen | SectionRenderer handling | Renders when empty? |
|---|---|---|---|
| `disclosures` | community-bank | Line 44 | ✅ Placeholder text |
| `testimonials` | mortgage-lending | Line 38 | ❌ null (R10-SECT-001 cross-archetype) |

`disclosures` is the only section type that degrades gracefully on fresh reset — it renders a placeholder. All other content-dependent types (team, testimonials, gallery) return null when `content={}`.

---

## R9-CAT-001 — Formal closure / misdiagnosis

**Status: VOIDED — misdiagnosis.**

Original filing: "storefront inquiry CTA ignores admin button label field — hardcodes 'Enquire'."

Evidence from this run and Run 10 confirms this is incorrect:
- community-bank: "Apply" renders for 3 items ✅
- credit-union: "Apply" (×4) and "Join" (×1) render ✅
- mortgage-lending: "Get pre-approved", "Apply" (×3), "Get a quote" all render ✅

The "Get a quote" seen in the catering admin form was the input **placeholder** (from `CTA_LABEL_DEFAULTS["inquiry"] = "Get a quote"` in `ItemFormDialog.tsx` line 80), not a stored DB value. Catering items have `ctaLabel = ""` in DB; "Enquire" is the correct fallback from `CtaButton.tsx`. No bug exists.

**Root cause of misdiagnosis:** Input placeholder and stored value are visually identical in the admin form UI. The `ctaLabel` field shows `CTA_LABEL_DEFAULTS["inquiry"]` as placeholder text when the field is empty — this is standard HTML placeholder behaviour but was misread as the stored value during Phase P inspection.

---

## New findings this run

| ID | Severity | Description |
|---|---|---|
| *(none new)* | — | All defects are cross-archetype confirmations |

### Cross-archetype confirmations
| Finding | Status |
|---|---|
| R9-BAK-001 (edit form pre-population broken) | ✅ Confirmed across all 3 |
| R9-RES-001 (booking: no slots on fresh reset) | ✅ Confirmed in all 3 banking archetypes |
| R10-SECT-001 (testimonials null when empty) | ✅ Confirmed in mortgage-lending |
| R9-G-001 (GBP default) | ✅ Confirmed |
| R9-G-003 (20% tax) | ✅ Confirmed |
| Enquiry heading "Enquire about X" regardless of ctaType | ✅ Confirmed: "Get pre-approved" CTA but "Enquire about Pre-Approval" heading |

### Positive findings
- `disclosures` section type renders gracefully with placeholder text (only content-dependent section that does so)
- Multiple custom ctaLabels per archetype render correctly — 5 distinct labels in mortgage-lending
- Mortgage-lending formSchema (3 select dropdowns) fully functional end-to-end
- All 3 banking archetypes have booking items — booking ctaType consistently present in financial services as the "schedule a meeting" pattern
