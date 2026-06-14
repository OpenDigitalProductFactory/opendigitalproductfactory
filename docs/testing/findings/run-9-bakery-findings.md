# Phase W Run 9 — Food & Hospitality: Bakery Archetype
**Audit date:** 2026-06-14
**Archetype slug:** `bakery`
**Storefront slug:** `peak-physio-clinic` (archetype reset applied to existing workspace)
**Auditor:** Claude / Phase W systematic test suite
**Branch:** `doc/phase-w-run1-retest`

---

## Phase P — Admin / Storefront Setup

### Storefront sections observed (post-archetype-reset)
| # | Section name | Section type |
|---|---|---|
| 1 | Hero | hero |
| 2 | Our Bakes | items |
| 3 | About Us | text/content |
| 4 | Fresh from the Oven | gallery |
| 5 | Get in Touch | contact |

### Menu items observed
| Item | ctaType | priceType | priceAmount | Notes |
|---|---|---|---|---|
| Sourdough Loaf | purchase | fixed | (set) | — |
| Birthday Cake | purchase | from | (set) | variable minimum |
| Custom Order | inquiry | quote | — | POA |
| Seasonal Pastries | purchase | fixed | (set) | — |
| Wedding Cake | inquiry | quote | — | POA |

### New capabilities discovered in food-hospitality archetype
- **"Menu" tab** in admin storefront nav (food-hospitality-specific, not seen in prior archetypes)
- **"Add to menu"** CTA on the items list (alongside existing "Add item")
- **`ctaType=inquiry`** — third CTA type discovered (prior runs only found `booking` and `purchase`)
- **Course field** on Edit Item form (food-specific field, not present in other archetypes)
- **Button label field** on Edit Item form (allows operator to override default CTA text)

### Phase P defect
**R9-BAK-001 (Defect / Low priority):** Edit Item form does not pre-populate with existing item data when opened via "Edit" CTA. Custom Order item (ctaType=inquiry, priceType=quote) opens the form showing "Purchase" as the default CTA type rather than the saved value. DB confirms the correct values are stored; the form's hydration is broken.

---

## Phase B5 — Public Storefront

### CTA routing results — all 5 items
| Item | ctaType | priceType | Rendered CTA | Routes to | Result |
|---|---|---|---|---|---|
| Sourdough Loaf | purchase | fixed | Enquire | `/inquire/itm-…` (formSchema form) | ❌ Should offer purchase flow (R8-OPT-001) |
| Birthday Cake | purchase | from | Enquire | `/inquire/itm-…` (formSchema form) | ❌ Should offer purchase flow (R8-OPT-001) |
| Custom Order | inquiry | quote | Enquire | `/inquire/itm-…` (formSchema form) | ✅ Correct — inquiry routes to enquiry |
| Seasonal Pastries | purchase | fixed | Enquire | `/inquire/itm-…` (formSchema form) | ❌ Should offer purchase flow (R8-OPT-001) |
| Wedding Cake | inquiry | quote | Enquire | `/inquire/itm-…` (formSchema form) | ✅ Correct — inquiry routes to enquiry |

### Enquiry form — formSchema fields verified
Sourdough Loaf enquiry form rendered: Full name*, Email*, Phone*, Order type (dropdown — 4 options), Order details (textarea). The enquiry form correctly reads `StorefrontArchetype.formSchema` and renders all custom fields. ✅

Enquiry submitted: **INQ-49SI6MLP** — landed in admin inbox as "Inquiry / New lead" with correct customer details and message body. ✅

### Storefront sections rendering gaps
- Items section renders ✅
- Hero section renders ✅
- **About Us, Fresh from the Oven (gallery), Get in Touch sections do NOT render** on public storefront — only the hero and items section are visible on `/s/peak-physio-clinic`. Three of five configured sections are absent from the customer-facing page.

### Price display gap
- POA badge renders correctly for inquiry/quote items (Custom Order, Wedding Cake) ✅
- **Fixed and from-price items show NO price badge** — Sourdough Loaf (£4.50 fixed) and Birthday Cake (from £…) and Seasonal Pastries display no price whatsoever on the storefront card. Only the POA label appears; priced items are unlabelled.

### Admin inbox observation
- Enquiry INQ-49SI6MLP appeared correctly in Reservations / Inbox ✅
- Inbox filter tabs: All | Inquiry | Booking | **Order** | **Donation** — "Order" and "Donation" tab types appeared for the first time in bakery; not seen in prior archetype inboxes

### Cross-archetype confirmations
- R8-OPT-001 (no purchase flow for purchase-type items) confirmed present in bakery — all 5 items render as "Enquire" regardless of ctaType
- R8-B5-009 (SlotBookingFlow ignores formSchema) confirmed NOT triggered in bakery because all items route to the enquiry form (which does read formSchema). The booking flow gap is only visible when a ctaType=booking item is present.

---

## Phase G — Finance

### Finance setup state
| Setting | Value | Expected |
|---|---|---|
| Base currency (Finance config) | USD | USD ✅ |
| Tax posture — Home country | US | — |
| Tax posture — Primary region | WA | — |
| Tax posture — Setup mode | Unknown | — |
| Tax remittance registrations | 0 | — |
| Default invoice tax rate | 20% | ~10.25% (WA state) ❌ |
| Customer pipeline currency widget | £ (GBP) | $ (USD) ❌ |

### Invoice INV-2026-0001
- Customer: Test Bakery Customer R9A (ACCT-97140879)
- Issue date: Jun 14, 2026 / Due date: Jul 14, 2026
- Line item: Sourdough Loaf (Phase G audit test), qty 1, unit price $8.50
- Tax rate: 20% → Tax: $1.70
- Subtotal: $8.50 / Total: **$10.20**
- Currency symbol on saved invoice: **$** ✅ (renders correctly as dollar sign)
- Invoice type: Standard ✅

### Phase G findings

**R9-G-001 (Defect / Medium):** New Invoice form defaults currency to **GBP** before a customer is selected, then silently switches to USD after customer selection. The initial GBP state is wrong for a USD-configured workspace and may confuse operators who start filling the form before selecting a customer.

**R9-G-002 (Defect / Medium):** Customer pipeline widget on `/customer` shows **"£0 open"** (GBP pound symbol) while the Finance module shows USD throughout. Currency symbol is inconsistent between the Customer module pipeline metric and the Finance module. Evidences a cross-module currency symbol configuration gap.

**R9-G-003 (Gap / High — evidences filed BI):** Default invoice tax rate is **20%** (UK VAT standard rate). The workspace tax posture is configured as US/WA where the combined state+local sales tax is approximately 10.25%. No mechanism exists to set the correct default rate without manual override on every invoice line item. The BI filed during this run (tax rate requires research + human approval) is fully evidenced: an operator would unknowingly overcharge tax by ~10% on every bakery sale until corrected.

**R9-G-004 (Gap / Low):** "Download PDF" CTA on invoice detail view produces no visible feedback — no download dialog, no success toast, no error message, and no observable network request to a PDF generation endpoint. Whether the PDF download is silently succeeding (browser handling) or silently failing could not be determined from the UX alone.

**R9-G-005 (Positive UX):** "Send Invoice" CTA correctly validates contact email before attempting delivery. Clicking the button when no email is configured shows inline error: "Invoice has no contact email." No dialog opened; validation is immediate and informative. ✅

### Finance Specialist coworker
- Finance Specialist coworker visible on all Finance pages ✅
- Posture: HANDS OFF ✅ (correct — Finance Agent requires proposal-mode approval for write actions)
- Skills toggle present ✅

---

## Summary scorecard

| Phase | Pass | Gap/Defect | Notes |
|---|---|---|---|
| P (Admin) | ✅ Archetype loaded, all 5 items created, Menu tab present | 1 defect (Edit Item form not populated) | New: inquiry ctaType, Course field, Button label field |
| B5 (Storefront) | ✅ Items render, enquiry form works, formSchema fields render, inbox delivery confirmed | 2 gaps (no purchase flow, 3 of 5 sections don't render) | Price display gap for non-POA items |
| G (Finance) | ✅ $ symbol correct on invoice, Send Invoice validates email | 3 gaps/defects (GBP default before customer, £ in pipeline widget, 20% UK VAT default) | Tax rate gap is highest priority |

**Highest priority new finding this run:** R9-G-003 — default 20% UK VAT on US/WA workspace invoices. Evidences the tax rate BI directly.

**Cross-archetype patterns confirmed:**
- R8-OPT-001 (no purchase flow): Present in bakery ✅
- Enquiry form formSchema rendering: Works correctly ✅ (reference implementation)
- Admin inbox delivery: Works correctly ✅
- Finance Specialist coworker: Active and visible ✅
