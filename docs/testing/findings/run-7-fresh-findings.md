# Run 7 Fresh-Install Findings — Professional Services

**Date:** 2026-06-13  
**Archetypes:** `counselling-wellness`, `legal-practice`, `accountancy`, `it-consultancy`  
**Image SHA:** `e68d3c17471214a9295fa6e9748fb27f37135cee` (DPF_PLATFORM_VERSION 6.3.0-88-ge68d3c174)  
**Validator:** Autonomous MCP session (Claude Sonnet 4.6)  
**Golden dump:** `golden-provider-configured-2026-06-12.dump`

---

## Executive Summary

*(populated after all 4 archetypes complete)*

---

## Archetype 1: `counselling-wellness`

**Install name:** Serenity Counselling Practice  
**Slug:** `/s/serenity-counselling-practice`  
**Currency:** GBP · **VAT:** No VAT

### Phase P — Operator Setup

| Step | Action | Result |
|------|--------|--------|
| P1 | Setup wizard — archetype picker → Financial Setup | ✅ Wizard completed; archetype=counselling, GBP, No VAT |
| P2 | Services seeded | ✅ 4 services: Free Initial Consultation (Free), Individual Session, Couples Session, Group Therapy — all type=Booking |
| P3 | Nav vocabulary | ✅ Left nav shows "Patient Portal", "Services", "Practitioners", "Appointments" — archetype-tailored labels |

**P-cw-1 — Archetype-tailored navigation vocabulary**  
Left nav labels change to match counselling context: "Patient Portal" (not "Storefront"), "Services" (not "Items"), "Practitioners" (not "Team"), "Appointments" (not generic inbox tab label). Positive finding.

**P-cw-2 — Service prices not pre-seeded**  
Individual Session, Couples Session, Group Therapy all show `/session` unit but no price amount. Operator must set prices before publishing. Noted; not a defect (prices are business-specific), but worth calling out.

### Phase B5 — Public Storefront

| Step | Action | Result |
|------|--------|--------|
| B5-1 | Storefront loads | ✅ 4 services rendered, "Book Now" CTAs (not "Buy") |
| B5-2 | Calendar booking flow | ✅ Date picker → hourly time slots (8 AM–4 PM) → booking form → confirmed BK-K_P5BW1T |
| B5-3 | Booking in admin inbox | ✅ BK-K_P5BW1T appears with Confirm/Cancel actions |
| B5-4 | Booking Confirm action | ⚠️ R7-001: status remains "pending" after clicking Confirm; API 404 on `/api/v1/bookings/:id/confirm` |

**B5-cw-1 — Calendar booking flow (positive)**  
Counselling archetype uses a full calendar booking UX: date picker → hourly time slots → name/email/phone/notes form → confirmation page with reference number. Appropriate for session-based services; no shopping cart.

### Phase G — Financials

| Step | Action | Result |
|------|--------|--------|
| G1 | Customer account | ✅ ACCT-3538E787 "Test Client R7a" created |
| G2 | Invoice creation | ✅ INV-2026-0001: £75.00, Individual Session, 0% tax, GBP — saved as draft |
| G3 | R6-004 carry-over | ⚠️ Invoice TAX % defaulted to 20% on GBP No-VAT install — manually set to 0% for save |

---

## Archetype 2: `legal-practice`

**Install name:** Blackstone Legal Services  
**Slug:** `/s/blackstone-legal-services`  
**Currency:** GBP · **VAT:** No VAT

### Phase P — Operator Setup

| Step | Action | Result |
|------|--------|--------|
| P1 | Setup wizard — archetype=Legal Services, GBP, No VAT | ✅ Completed |
| P2 | Services seeded | ✅ 6 services: Free Initial Consultation (Free), Contract Review, Employment Law Advice, Property Conveyancing (POA), Business Formation, Litigation Support (POA) |
| P3 | Nav vocabulary | ✅ "Client Portal", "Services", "Team", "Enquiries" — legal-specific labels |

**P-ls-1 — "Our Solicitors" section and "Client Portal" vocabulary (positive)**  
Section named "Our Solicitors" (not generic "Team"), portal labelled "Client Portal", inbox labelled "Enquiries" with British English spelling. Strong domain alignment.

### Phase B5 — Public Storefront

| Step | Action | Result |
|------|--------|--------|
| B5-1 | Storefront loads | ✅ 6 services rendered, "Enquire" CTAs (not Buy/Book) |
| B5-2 | POA labels | ✅ Property Conveyancing and Litigation Support correctly show "POA" |
| B5-3 | Enquiry form | ✅ Name, Email, Phone, "Type of legal matter" dropdown (Employment/Property/Business/Family/Litigation/Other), description |
| B5-4 | Enquiry submitted | ✅ INQ-FOUFXKOO confirmed |

**B5-ls-1 — "Type of legal matter" dropdown (positive)**  
Enquiry form includes a categorisation dropdown with 6 legal matter types. Enables triage routing without operator manual re-classification.

### Phase G — Financials

| Step | Action | Result |
|------|--------|--------|
| G1 | Customer account | ✅ Test Client R7b created |
| G2 | Invoice creation | ✅ INV-2026-0001: £250.00, Employment Law Advice, 0% tax, GBP — draft saved |
| G3 | R6-004 carry-over | ⚠️ Invoice TAX % defaulted to 20% on GBP No-VAT install — manually set to 0% |

---

## Archetype 3: `accountancy`

**Install name:** Clearwater Accountancy Ltd  
**Slug:** `/s/clearwater-accountancy-ltd`  
**Currency:** GBP · **VAT:** No VAT

### Phase P — Operator Setup

| Step | Action | Result |
|------|--------|--------|
| P1 | Setup wizard — archetype=Accounting & Bookkeeping, GBP, No VAT | ✅ Completed |
| P2 | Services seeded | ✅ 6 services: Bookkeeping, Annual Accounts, Self Assessment Tax Return, VAT Returns, Payroll, Business Advisory — all Enquire type |
| P3 | Nav vocabulary | ✅ "Client Portal", "Services", "Enquiries" — same cluster as legal-services |

### Phase B5 — Public Storefront

| Step | Action | Result |
|------|--------|--------|
| B5-1 | Storefront loads | ✅ 6 services, "Enquire" CTAs, domain-specific descriptions |
| B5-2 | Enquiry form | ✅ Name, Email, Phone, "Business size" dropdown (Sole trader/Partnership/Ltd micro/small/medium+), free-text field |
| B5-3 | Enquiry submitted | ✅ INQ-CBZTZVZC confirmed |

**B5-ac-1 — "Business size" dropdown on enquiry form (positive)**  
Enquiry form includes a business size categorisation (Sole trader → Ltd medium+) enabling the accountant to triage complexity and fee tier immediately.

### Phase G — Financials

| Step | Action | Result |
|------|--------|--------|
| G1 | Customer account | ✅ Test Client R7c created |
| G2 | Invoice creation | ✅ INV-2026-0001: £350.00, Self Assessment Tax Return, 0% tax, GBP — draft saved |
| G3 | R6-004 carry-over | ⚠️ Invoice TAX % defaulted to 20% on GBP No-VAT install — manually corrected to 0% |

---

## Archetype 4: `it-consultancy`

**Install name:** *(set during wizard)*  
**Currency:** USD  
**VAT:** No VAT

### Phase P — Operator Setup

| Step | Action | Result |
|------|--------|--------|
| P1 | Setup wizard | |
| P2 | Service / engagement setup | |
| P3 | Supplier setup | |

### Phase B5 — Public Storefront

| Step | Action | Result |
|------|--------|--------|
| B5-1 | Storefront loads | |
| B5-2 | Service listing | |
| B5-3 | Inquiry / project brief flow | |

### Phase G — Financials

| Step | Action | Result |
|------|--------|--------|
| G1 | Customer account | |
| G2 | Expense entry | |
| G3 | Invoice creation | |

---

## Defect Log

| ID | Phase | Severity | Description | BI |
|----|-------|----------|-------------|-----|
| R7-001 | B5 | Important | Booking Confirm/Cancel buttons non-functional — status stays "pending"; API 404 on `/api/v1/bookings/:id/confirm` | — |
| R7-002 | G3 | Minor | Carry-over R6-004: Invoice TAX % defaults to 20% on GBP No-VAT install (counselling-wellness) | BI-E12B8B01 |

---

## Positive Findings

- **B5-cw-1**: Calendar booking flow — full date→slot→form→confirmation UX appropriate for session-based services
- **P-cw-1**: Archetype-tailored navigation: "Patient Portal", "Services", "Practitioners", "Appointments"
- **P-ls-1**: Legal-specific vocabulary — "Client Portal", "Enquiries", "Our Solicitors" section, British English spelling throughout
- **B5-ls-1**: "Type of legal matter" dropdown on enquiry form with 6 legal matter categories — enables structured triage
- **B5-ac-1**: "Business size" dropdown on accountancy enquiry form (Sole trader → Ltd medium+) — enables fee-tier triage
