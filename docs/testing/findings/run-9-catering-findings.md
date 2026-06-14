# Phase W Run 9 — Food & Hospitality: Catering Archetype
**Audit date:** 2026-06-14
**Archetype slug:** `catering`
**Storefront slug:** `peak-physio-clinic` (archetype reset applied to existing workspace)
**Auditor:** Claude / Phase W systematic test suite
**Branch:** `doc/phase-w-run1-retest`

---

## Phase P — Admin / Storefront Setup

### Archetype reset
- Reset via POST `/api/storefront/admin/archetype-reset` with `{targetArchetypeId: 'catering'}` (text slug, not cuid) ✅
- Sections and items cleared and replaced with catering defaults ✅
- BacklogItems NOT wiped by reset — all Phase G bakery BIs survived ✅

### Storefront sections observed (post-archetype-reset)
| # | Section name | Section type |
|---|---|---|
| 1 | Hero | hero |
| 2 | Our Services | items |
| 3 | About Us | text/content |
| 4 | Our Work | gallery |
| 5 | Get in Touch | contact |

### Menu items observed
| Item | ctaType | priceType | priceAmount | Button label (admin) | Notes |
|---|---|---|---|---|---|
| Corporate Catering | inquiry | quote | — | "Get a quote" | POA |
| Wedding Catering | inquiry | quote | — | "Get a quote" | POA |
| Private Event | inquiry | quote | — | "Get a quote" | POA |
| Buffet Package | inquiry | quote | — | "Get a quote" | POA |
| BBQ Package | inquiry | quote | — | "Get a quote" | POA |

**Key difference from bakery:** All 5 catering items are `ctaType=inquiry, priceType=quote` — there are no purchase-type or fixed-price items in the catering archetype. The entire service model is quote-based.

### formSchema — catering archetype
Catering archetype has a rich, event-specific `formSchema` on `StorefrontArchetype`:
- Full name* (text)
- Email* (email)
- Phone* (tel)
- Type of event* (select: Corporate, Wedding, Private party, Funeral wake, Other)
- Number of guests* (select: Under 20, 20–50, 50–100, 100–200, 200+)
- Event date (date: DD/MM/YYYY)
- Dietary requirements (textarea)

Total: 7 fields including 2 dropdowns — the most complex formSchema observed across all archetypes audited to date.

### Phase P observation — Button label field
Admin Edit Item form shows a "Button label" field with value "Get a quote" for each catering item. This field exists at the admin data layer but is NOT rendered on the public storefront (see R9-CAT-001 below).

---

## Phase B5 — Public Storefront

### CTA routing results — all 5 items
| Item | Rendered CTA | Routes to | formSchema | Result |
|---|---|---|---|---|
| Corporate Catering | Enquire | `/inquire/itm-IZhtrj3v` | ✅ 7 fields | ✅ correct routing |
| Wedding Catering | Enquire | `/inquire/itm-XP1iFYRK` | ✅ 7 fields | ✅ correct routing |
| Private Event | Enquire | `/inquire/itm-eau6rylL` | ✅ 7 fields | ✅ correct routing |
| Buffet Package | Enquire | `/inquire/itm-zFXWJubW` | ✅ 7 fields | ✅ correct routing |
| BBQ Package | Enquire | `/inquire/itm-BI64S4wO` | ✅ 7 fields | ✅ correct routing |

All 5 items correctly route to the enquiry form at `/s/peak-physio-clinic/inquire/<itemId>`. The catering-specific formSchema with 7 fields including event type and guest count dropdowns renders correctly on every item. ✅

### Price display
All 5 items display the POA badge correctly — consistent with bakery (which also showed POA for inquiry/quote items). No price display gap for this archetype since every item is quote-based. ✅

### Storefront sections rendering
- Items section renders ✅
- Hero section renders ✅
- **About Us, Our Work (gallery), Get in Touch sections do NOT render** — same pattern as bakery. Three of five configured sections absent from public storefront.

### Phase B5 defect
**R9-CAT-001 (Defect / Medium):** Custom "Button label" field in admin Edit Item form (showing "Get a quote") is not rendered on the public storefront. All 5 catering items display hardcoded "Enquire" text regardless of the stored button label value. This defect exists across all food-hospitality archetypes (bakery also affected). Root cause: the storefront CTA component does not read `StorefrontItem.ctaLabel` (or equivalent) when rendering the button.

### Cross-archetype B5 confirmations
- R8-OPT-001 (no purchase flow) is NOT triggered in catering — all items are correctly `ctaType=inquiry` so the enquiry flow is the intended path
- R9-CAT-001 (button label not rendered): Confirmed in catering; also confirmed in bakery
- Enquiry form formSchema rendering: ✅ verified for all 5 items — most complex schema tested to date

---

## Phase G — Finance

### Finance verification
Existing Finance state carried over from bakery Phase G (same workspace, archetype reset does not touch Finance records):
- Base currency: USD ✅
- Finance Specialist coworker: visible, HANDS OFF posture ✅

### New Invoice cross-check
Opened `/finance/invoices/new` to confirm patterns from bakery Phase G persist in catering archetype context:

| Observation | Before customer selection | After customer selection | Result |
|---|---|---|---|
| Currency field | GBP | USD | R9-G-001 confirmed ✅ |
| Tax % default | 20% | 20% | R9-G-003 confirmed ✅ |
| Line item currency | GBP 0.00 | USD 0.00 | Switches with customer ✅ |

Customer "Test Bakery Customer R9A" (ACCT-97140879) selected → currency switched from GBP to USD immediately. All Phase G gap patterns (R9-G-001 through R9-G-004) are cross-archetype — they appear in catering exactly as in bakery.

**No new Finance findings specific to the catering archetype.**

### Finance Specialist coworker
- Finance Specialist coworker visible on Finance pages ✅
- Posture: HANDS OFF ✅
- Skills toggle present ✅

---

## Summary scorecard

| Phase | Pass | Gap/Defect | Notes |
|---|---|---|---|
| P (Admin) | ✅ Archetype loaded, all 5 items created, formSchema confirmed | 0 defects in Phase P | All items correctly inquiry/quote; 7-field formSchema is most complex seen |
| B5 (Storefront) | ✅ All 5 CTAs drive to enquiry form, catering formSchema renders on all items | 1 defect (R9-CAT-001: button label ignored) + 3 sections missing | No purchase-flow gap since all items are inquiry-type |
| G (Finance) | ✅ Currency switches GBP→USD after customer selection | All R9-G gaps confirmed cross-archetype (GBP default, 20% tax) | No new catering-specific finance gaps |

### New findings this run
- **R9-CAT-001 (Defect / Medium):** Admin item "Button label" field value not rendered on public storefront; hardcoded "Enquire" shown for all items. Cross-archetype.

### Cross-archetype confirmations
- R9-G-001 (GBP default before customer): Present in catering ✅
- R9-G-003 (20% UK VAT default): Present in catering ✅
- 3 of 5 sections missing on public storefront: Present in catering ✅
- Enquiry form formSchema rendering: Works correctly across all items ✅
- Finance Specialist coworker: Active and visible ✅

### Catering vs bakery comparison
| Dimension | Bakery | Catering |
|---|---|---|
| ctaType mix | inquiry + purchase | inquiry only |
| formSchema fields | 5 fields (order-focused) | 7 fields (event-focused, with dropdowns) |
| POA items | 2 of 5 | 5 of 5 |
| Fixed-price items | 3 of 5 | 0 |
| Purchase flow gap (R8-OPT-001) | ❌ All items show Enquire regardless | N/A — all items correctly inquiry-type |
| Price display gap (non-POA) | ❌ 3 items show no price | N/A — no non-POA items |
| Button label gap (R9-CAT-001) | ❌ Present | ❌ Present |
