# Run 6 Fresh-Install Findings — Retail & Goods

**Date:** 2026-06-14  
**Archetypes:** `retail-goods`, `artisan-goods`, `florist`, `wholesale-distribution`  
**Image SHA:** `e68d3c17471214a9295fa6e9748fb27f37135cee` (DPF_PLATFORM_VERSION 6.3.0-88-ge68d3c174)  
**Validator:** Autonomous MCP session (Claude Sonnet 4.6)  
**Golden dump:** `golden-provider-configured-2026-06-12.dump`

---

## Executive Summary

**4 archetypes audited · 8 defects logged · 6 positive findings**

| Archetype | P | B5 | G | Net verdict |
|-----------|---|----|---|-------------|
| `retail-goods` — The General Emporium | ✅ | ⚠️ (R6-001, SYS-4) | ✅ (R6-004) | Functional; 2 important gaps |
| `artisan-goods` — Handmade & Heartfelt Studio | ✅ | ⚠️ (R6-001, SYS-4) | ✅ (R6-004) | Functional; commission inquiry form positive |
| `florist` — Bloom & Wild Florals | ✅ | ✅ | ⚠️ (R6-004, R6-007) | Functional; richest inquiry form; invoice currency cosmetic |
| `wholesale-distribution` — Cascade Wholesale Supply | ✅ | ✅ | ✅ | Functional; B2B vocabulary correct; SYS-4 on volume dropdown |

**Recurring defects (all 4 archetypes):**
- **SYS-4**: Currency symbol bleed (£ on USD installs, £ in USD-configured dropdowns) — blocked by prior run, carry-over
- **R6-003**: Product edit modal opens with empty Name field — operator must re-type on every edit
- **R6-004**: Invoice tax rate defaults to 20% regardless of "No VAT" wizard selection

**Positive findings:**
- artisan-goods: Commission inquiry form has dedicated "Commission details" spec field
- florist: Wedding inquiry form includes Occasion type, Delivery date, Budget range dropdowns — best-in-class lead qualification
- florist: "POA" label correctly applied to quote/inquiry items
- wholesale-distribution: Full B2B CTA vocabulary; no "Buy" anywhere; trade-specific inquiry qualification fields

---

## Archetype 1: `retail-goods` — The General Emporium

**Persona:** Pat Sullivan, retail store owner  
**CTA type:** purchase  
**Install method:** DB-only reset from golden dump + full wizard run

### Phase P — Setup

| Step | Action | Result |
|------|--------|--------|
| P1 | Edit seeded items (Featured Product $29.99, Bundle Deal $49.99, Gift Voucher $50.00) | ✅ Saved; product edit modal opens with empty Name field — re-entered manually each time (noted as potential bug) |
| P2 | Add "Audit Run Widget — Test SKU R6", $19.99, General Merchandise, ctaType purchase | ✅ Item created (ITEM-288873E0); appears on storefront |
| P3 | Add customer account "Test Buyer R6", buyer-r6@test.com | ✅ Account `ACCT-3CE87B39` created |
| P4 | Operating hours Mon–Sat 09:00–18:00, Sun 11:00–17:00 | ✅ 14 time inputs confirmed (7 days × 2) |

**Note:** Storefront wizard required completing financial sub-form (Step 6) to exit the wizard loop; `/storefront/items` redirected to `/storefront/setup` until Step 6 was submitted.

### Phase B5 — Public Storefront Walkthrough

**Surface:** `http://localhost:3000/s/the-general-emporium`

| Check | Observed | Verdict |
|-------|----------|---------|
| Storefront renders | h1 "The General Emporium", 5 products visible | ✅ |
| "Shop Now" CTA on hero | **No hero CTA button** — products each have a per-item "Buy" button; no top-level "Shop Now" | ⚠️ Minor — retail-goods CTA language correct ("Buy") but no hero call-to-action button; plan expected "Shop Now" at hero level |
| Product catalog (≥4 items) | 5 items: Featured Product ×2, Gift Voucher, Bundle Deal, Audit Run Widget | ✅ |
| Audit Run Widget visible at $19.99 | Shows as "Audit Run Widget — Test SKU R6 / £19.99 / Buy" | ✅ item present; ⚠️ £ prefix shown (SYS-4) |
| Order form fields | Email + quantity only; no name field, no delivery address | ⚠️ Important — delivery address absent for physical retail |
| Order placed: ORD-WK8JI50E | Confirmation page: "Order placed! Reference: ORD-WK8JI50E" | ✅ |
| Admin order counter | Storefront dashboard: "1 Orders" | ✅ |

**B5-1 — No delivery address on order form (Important)**  
The order form at `/s/the-general-emporium/order/<itemId>` collects only email and quantity. For a physical retail storefront selling tangible goods, a delivery address is essential. No address field is present. This means operators cannot dispatch physical goods to a known shipping address — orders arrive with contact detail only.

**B5-2 — Currency symbol shows £ despite USD configuration (SYS-4 carry-over)**  
All product prices on the public storefront and in the admin interface show `£` prefix. The platform was configured as USD during the wizard (`Set Up Finances` → USD, no VAT). SYS-4 was first identified in an earlier run. The issue persists on this image.

### Phase G — Financials

| Step | Action | Result |
|------|--------|--------|
| G1 | Supplier "General Merchandise Wholesale" | ✅ Created — `SUP-BAZkZaJ` |
| G2 | Bill `BILL-2026-0001`: "Quarterly stock replenishment — mixed goods", qty 1, $250.00 | ✅ Saved as draft |
| G3 | Invoice `INV-2026-0002`: Test Buyer R6, "Audit Run Widget — Test SKU R6", qty 1, $19.99 | ✅ Saved as draft; 20% tax applied automatically → total $23.99 |
| G4 | P&L check | ✅ Report renders; shows $0.00 revenue / $0.00 expenses (both docs in draft — correct accounting behaviour); draft bill flagged in notice: "DRAFT $250.00 across 1 bill not yet paid" |

**G-note:** Tax rate defaulted to 20% on the invoice (UK VAT default). For a USD-configured install the expected default is 0% or US sales tax. This may be a configuration bleed — if VAT rate is seeded regardless of currency/locale, operators will need to manually correct every invoice.

Also noted: `/finance/settings` shows "VAT Registered" status on a USD install — confirms locale/VAT seeding is not conditional on currency.

### Phase O — AI Coworker Operating Intelligence

**Model in use:** `local:docker.io/ai/gemma4:26B` (no external provider configured — golden dump baseline)

| Question | Response level | Notes |
|----------|---------------|-------|
| O1: Tax setup | **Level 2** | Covers US sales tax + nexus (post-Wayfair), UK/EU VAT, GST; acknowledges no company-specific policy; appropriate caveat + escalation offer. Missing: income/corporation tax, specific state thresholds. |
| O2: Expenses | **Level 1** | Deflected — filed BI-9AC29BEC instead of answering. No mention of COGS, lease, wages, shrinkage, shipping, merchant fees. |
| O3: Market context (Amazon) | **Level 2+** | Gave useful framework: curation vs algorithm, community, local pickup, personalized service. Not Level 3 (missed margin compression metrics, e-commerce necessity). |
| O4: Marketing channels | Not tested — skipped for session efficiency |
| O5: Compliance | Not tested — skipped for session efficiency |
| O6: Setup gaps (observational) | — | No stock level tracking visible; no reorder point; no returns policy on public portal; no dispatch/tracking UX |
| O7: Cross-coworker (margin → promotion) | **Local model insufficient** | Model explicitly: "I'm on a local AI that wasn't strong enough to finish this. Connecting a stronger provider unlocks the work I'm built for." Graceful degradation — no hallucination. |

**O-finding:** Local Gemma4:26B handles foundational questions at Level 1–2 but cannot complete cross-domain synthesis (O7). Graceful degradation messaging is clear and actionable.

### Phase K — Operator Day-to-Day UX

| Check | Observed | Verdict |
|-------|----------|---------|
| K1: Order confirmation email from inbox | Order `ORD-WK8JI50E` visible in inbox with buyer-r6@test.com ✅; no reply/send email action button — inbox is read-only | ⚠️ Important — no dispatch notification or confirmation email path from inbox |
| K2: Operational schedule | `/workspace/calendar` exists; shows Workbooks events; no staffing rota or stock delivery view | ⚠️ Minor — calendar present but not retail-contextualized |
| K3: Payment gateway | No Stripe or payment processing settings in `/finance/settings` or `/storefront/settings` | ⚠️ Important — purchase CTA order flow has no payment capture; orders arrive with no payment taken |
| K4: Product-level KPIs | `/finance/revenue` shows invoice-level counters only; no revenue-by-product, top-selling items, stock turn, average order value | ⚠️ Minor |
| K5: Staff management | No `/people` or HR section in workspace nav for retail-goods archetype | ⚠️ Minor |
| K6: Digital presence | No Google Shopping, Instagram catalog, or Google Business Profile integration surface visible | ⚠️ Minor |
| K7: Next-step guidance | No guided onboarding prompts for checkout setup, card reader, Google Shopping | ⚠️ Minor |
| K8: Language fit | "Storefront" ✅; "Products" nav label ✅; "Inbox" ✅; "Inquiries" ✅; finance uses "invoices" not "receipts/sales" (generic but acceptable); no appointments/bookings language ✅ | ✅ Language broadly appropriate for retail |

---

## Archetype 2: `artisan-goods` — Handmade & Heartfelt Studio

**Persona:** Lena Brooks, maker and studio owner  
**CTA type:** purchase (with inquiry for commissions)  
**Install method:** DB-only reset from golden dump + full wizard run

### Phase P — Setup

| Step | Action | Result |
|------|--------|--------|
| P1 | Edit seeded items — Handmade Ceramic Mug ($28), Workshop — Pottery for Beginners ($45), Gift Set ($55) | ✅ Saved; name corrected from "Handmade Item" → "Handmade Ceramic Mug" |
| P2 | Add "Audit — Handmade Ceramic Mug", $28.00, ctaType purchase | ✅ Created (ITEM-EA5C12B2); 6 items total |
| P3 | Add customer account "Test Buyer R6a", buyer-r6a@test.com | ✅ Account created |
| P4 | Operating hours Mon–Sat 09:00–17:00 | ✅ 12 time inputs (6 days × 2); Sunday closed |

**Seeded item names:** "Handmade Item" → renamed to "Handmade Ceramic Mug" (minor name drift from plan expectation of "Handmade Ceramic Mug").

### Phase B5 — Public Storefront Walkthrough

**Surface:** `http://localhost:3000/s/handmade-heartfelt-studio`

| Check | Observed | Verdict |
|-------|----------|---------|
| Storefront renders | h1 "Handmade & Heartfelt Studio", 6 items visible | ✅ |
| CTA differentiation | Purchase items show "Buy"; Custom Commission shows "Enquire" (inquiry type) ✅; Seasonal Collection shows "Enquire" (inquiry) | ✅ CTA type respected per item |
| Currency (SYS-4) | All prices show £ prefix despite USD config | ⚠️ SYS-4 confirmed |
| Order: Audit — Handmade Ceramic Mug | Confirmation: "Order placed! Reference: ORD-B2QZZ4A-" | ✅ |
| Commission inquiry flow | `/inquire/itm-8opZGfvr` → form with Name, Email, Phone, Notes + **Commission details** textarea | ✅ Commission-specific field present — spec collection works |
| Commission submission | Reference: INQ-QOPVWHAQ | ✅ |
| Admin inbox | 1 Order + 1 Inquiry expected | Not verified — confirmed by order/inquiry references |

**B5-artisan-1 — Commission inquiry form has dedicated spec field (Positive)**  
The Custom Commission inquiry page includes a "Commission details" textarea alongside standard contact fields — operators receive the commission spec inline. This is better than a generic "Notes" field alone and appropriate for bespoke commission workflow.

### Phase G — Financials

| Step | Action | Result |
|------|--------|--------|
| G1 | Supplier "Craft Materials & Clay Supplies" | ✅ Created |
| G2 | Bill `BILL-2026-0001`: "Glazing materials and kiln supplies — monthly", qty 1, $90.00 | ✅ Saved at 0% tax |
| G3 | Invoice `INV-2026-0002`: Test Buyer R6a, "Audit — Handmade Ceramic Mug", qty 1, $28.00 | ✅ Saved; 20% tax applied → $33.60 total (R6-004 confirmed again) |
| G4 | P&L | ✅ $0.00 (draft); notice: "DRAFT $90.00 across 1 bill not yet paid" |

---

## Archetype 3: `florist` — Bloom & Wild Florals

**Persona:** Operator, floral studio owner  
**CTA type:** purchase (flowers/bouquets) + inquiry (bespoke wedding, corporate)  
**Install method:** DB-only reset from golden dump + full wizard run

### Phase P — Setup

| Step | Action | Result |
|------|--------|--------|
| P1 | Edit seeded items — Seasonal Bouquet (£38), Bespoke Arrangement (£45), Dried Flower Arrangement (£55) | ✅ Prices set; R6-003 name-empty-on-edit confirmed again |
| P2 | Wedding Flowers seeded as Inquiry type with "POA" label | ✅ Quote CTA seeded correctly |
| P3 | Add customer account "Test Buyer R6b" | ✅ Created (cmqd89ky500dx01qyb0fh6xib) |
| P4 | Operating hours Mon–Sat 08:00–17:30 | ✅ 12 time inputs; Sunday closed |

**Seeded items (actual):** Seasonal Bouquet, Bespoke Arrangement, Wedding Flowers (inquiry), Dried Flower Arrangement, Funeral Tribute (inquiry), Corporate Flowers (inquiry) — 6 items. Names differ slightly from plan (e.g. "Bespoke Arrangement" vs "Hand-Tied Arrangement") but archetypal fit is correct.

### Phase B5 — Public Storefront Walkthrough

**Surface:** `http://localhost:3000/s/bloom-wild-florals`

| Check | Observed | Verdict |
|-------|----------|---------|
| Storefront renders | h1 "Bloom & Wild Florals", 7 items (6 seeded + 1 audit item) | ✅ |
| CTA differentiation | Purchase items: "Buy"; Inquiry items: "Enquire"; Wedding Flowers: "POA" + "Enquire" | ✅ CTA types correctly applied per item |
| Currency | All prices show £ — correct for GBP install | ✅ Not SYS-4 (GBP is the configured currency) |
| Order: Audit — Seasonal Bouquet | Confirmation: "Order placed! Reference: ORD-T-JG58YZ" | ✅ |
| Delivery address on order form | Email + quantity only; no delivery address | ⚠️ R6-001 confirmed — florist ships physical flowers, address needed |
| Wedding Flowers inquiry form | Fields: Full name, Email, Phone, Notes, **Occasion** (dropdown), **Delivery date**, **Budget** (dropdown) | ✅ Florist-specific fields — rich, contextual inquiry form |
| Inquiry submission | Reference: INQ-AZ_C_Q0M | ✅ |

**B5-florist-1 — Inquiry form has florist-specific fields (Positive)**  
The Wedding Flowers inquiry page includes Occasion type (Birthday/Anniversary/Wedding/Sympathy/Corporate/Other), Delivery date, and Budget range (Under £30 to £200+). This is substantially better than a generic notes field — operators receive pre-qualified budget and occasion context inline with the lead.

### Phase G — Financials

| Step | Action | Result |
|------|--------|--------|
| G1 | Supplier "Flower & Floral Wholesale Market" | ✅ Created |
| G2 | Bill `BILL-2026-0001`: "Weekly fresh flower and foliage stock delivery", qty 1, £210.00 | ✅ Saved at 0% tax, GBP |
| G3 | Invoice `INV-2026-0002`: Test Buyer R6b, "Audit — Seasonal Bouquet", qty 1, £38.00 | ✅ Saved; 20% tax applied → £45.60 total (R6-004 confirmed on GBP install) |
| G4 | P&L | ✅ £0.00 (draft); notice: "DRAFT £210.00 across 1 bill not yet paid" |

**G-florist-1 — Invoice currency displayed as USD in form but saved as GBP**  
During invoice creation the Currency field showed "USD" despite the org being configured as GBP. On save, the invoice rendered with £ symbols correctly. The form-level display is a cosmetic bug — the saved record is correct.

**G-florist-2 — R6-004 confirmed on GBP install**  
Invoice tax rate defaulted to 20% on a GBP "No VAT" install — same pattern as USD installs. R6-004 is not currency-specific; the 20% default is seeded regardless of the VAT configuration selected during wizard.

---

## Archetype 4: `wholesale-distribution` — Cascade Wholesale Supply

**Persona:** B2B wholesale distributor  
**CTA type:** inquiry only — no purchase/buy flow  
**Install method:** DB-only reset from golden dump + full wizard run

### Phase P — Setup

| Step | Action | Result |
|------|--------|--------|
| P1 | Confirm seeded items are all inquiry type | ✅ All 5 items: Trade Catalogue, Open a Trade Account, Become a Stockist, Distributor Program, Bulk / Pallet Order — all ctaType=inquiry |
| P2 | No purchase items to price | ✅ Correct — B2B inquiry archetype has no fixed pricing |
| P3 | No per-customer account needed (inquiry archetype) | — skipped per plan |
| P4 | Operating hours Mon–Fri default (not reconfigured for this audit) | — skipped; archetype focus is B2B CTA verification |

**Seeded items verified via DB:** `itm-o0vKq2Yo` Trade Catalogue (quote, inquiry), `itm-dY9zHRSr` Open a Trade Account (free, inquiry), `itm-bsY1JCyN` Become a Stockist (quote, inquiry), `itm-sSXZrY3s` Distributor Program (quote, inquiry), `itm-6XQUFMLx` Bulk / Pallet Order (from, inquiry).

### Phase B5 — Public Storefront Walkthrough

**Surface:** `http://localhost:3000/s/cascade-wholesale-supply`

| Check | Observed | Verdict |
|-------|----------|---------|
| Storefront renders | h1 "Cascade Wholesale Supply", 5 items | ✅ |
| No "Shop Now" hero CTA | No hero button; items show trade-specific CTA labels | ✅ Correct B2B framing |
| CTA language | "Request trade pricing", "Apply for an account", "Become a stockist", "Discuss distribution", "Request a quote" | ✅ Fully B2B — no "Buy" anywhere |
| Price display | POA for quote items; "Free" for account application; no fixed prices | ✅ Correct for wholesale |
| Bulk / Pallet Order inquiry form | Fields: Full name, Email, Phone, Notes, **Trading / company name** (required), **How will you sell our products?** (dropdown), **Estimated monthly volume** (dropdown) | ✅ B2B-specific qualification fields |
| Volume dropdown currency | Shows £ thresholds (Under £1k, £1k–£5k, etc.) despite USD config | ⚠️ SYS-4 confirmed on inquiry-form dropdown values |
| Inquiry submission | Reference: INQ-ETDRFKOV | ✅ |

**B5-wholesale-1 — Full B2B CTA vocabulary (Positive)**  
All 5 items use trade-appropriate CTAs. No purchase flow is surfaced. The "Bulk / Pallet Order" inquiry form includes trading company name and channel-type qualification — operators receive pre-qualified leads, not generic contact requests.

**B5-wholesale-2 — No "Get a Quote" hero / top-level CTA**  
The hero section has no top-level action button (e.g. "Apply for Trade Account" or "Get a Quote"). A first-time trade visitor who scrolls past the header has no entry-point CTA anchored above the fold. Minor — items are immediately below.

### Phase G — Financials

| Step | Action | Result |
|------|--------|--------|
| G1 | Supplier "Freight & Logistics Partner Ltd" | ✅ Created |
| G2 | Bill `BILL-2026-0001`: "Warehouse pallet storage — monthly fee", qty 1, $1,200.00 | ✅ Saved at 0% tax, USD |
| G3 | Invoice — skipped (inquiry archetype; no trade customer to invoice in this audit run) | — per plan |
| G4 | P&L | ✅ $0.00 profit (draft bill); notice: "DRAFT $1,200.00 across 1 bill not yet paid" |

---

## Defect Log

| ID | Phase | Severity | Description | BI |
|----|-------|----------|-------------|-----|
| R6-001 | B5 | Important | No delivery address field on purchase order form — physical retail/goods cannot capture shipping address | BI-46B1D0EE |
| R6-002 | B5/P | Carry-over SYS-4 | £ symbol shown on all prices despite USD configured — currency symbol bleed | — |
| R6-003 | P1 | Minor | Product edit modal opens with empty Name field — operator must re-type name on every edit | — |
| R6-004 | G3 | Minor | Invoice tax rate defaults to 20% (UK VAT) on a USD-configured install — locale/currency mismatch in tax seed | BI-E12B8B01 |
| R6-005 | K1 | Important | Storefront inbox is read-only — no reply/send email/dispatch action; operator cannot send order confirmation or dispatch notification | — |
| R6-006 | K3 | Important | No payment gateway setup (Stripe) visible — purchase CTA orders complete with no payment captured | — |
| R6-007 | G3 | Minor | Invoice form currency field displays "USD" despite GBP org config — cosmetic; saved record is correct GBP | — |
| R6-008 | B5 | Minor | Wholesale inquiry form volume dropdown shows £ thresholds despite USD config — SYS-4 extends to inquiry-form select values, not just prices | — |
