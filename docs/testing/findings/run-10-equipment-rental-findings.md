# Phase W Run 10 — Asset Rental: Equipment & Tool Rental Archetype
**Audit date:** 2026-06-14
**Archetype slug:** `equipment-rental`
**Storefront slug:** `peak-physio-clinic` (archetype reset applied to existing workspace)
**Auditor:** Claude / Phase W systematic test suite
**Branch:** `doc/phase-w-run1-retest`

---

## Phase P — Admin / Storefront Setup

### Archetype reset
- Reset via POST `/api/storefront/admin/archetype-reset` with `{targetArchetypeId: 'equipment-rental'}` ✅
- Result: 5 sections created, 6 items created ✅
- Note: `asset-rental` is not a valid slug — the correct value is `equipment-rental` (DB `archetypeId` field). The 56 available archetypes were confirmed by querying `StorefrontArchetype` directly.

### New admin nav capabilities
The admin portal nav changed on archetype switch:
- Portal label changed to **"Rental Portal"** (archetype-specific branding) ✅
- New nav item: **"Units"** (link `/storefront/units`) — first appearance in any audit run. Likely asset-inventory tracking surface specific to rental/self-storage archetypes.

### Storefront sections observed
| # | Section name | Section type |
|---|---|---|
| 1 | Hero | hero |
| 2 | About Us | about |
| 3 | Equipment & Rates | items |
| 4 | Our Team | team |
| 5 | Reserve or Ask | contact |

New section type: **`team`** — first appearance across all archetypes audited. Component handled in `SectionRenderer.tsx` (line 34).

### Menu items observed
| Item | ctaType | priceType | ctaLabel (admin) | Notes |
|---|---|---|---|---|
| Mini Excavator | **rental** | from | Reserve | New ctaType |
| Scaffold Tower | **rental** | from | Reserve | — |
| Generator (5kW) | **rental** | from | Reserve | — |
| Pressure Washer | **rental** | from | Reserve | — |
| Party Tent (6x12m) | **rental** | from | Reserve | — |
| Check Availability | inquiry | free | (empty) | Catch-all inquiry item |

**Key new discovery:** `ctaType=rental` — the fourth distinct CTA type discovered in Phase W testing (after `booking`, `purchase`, `inquiry`). All 5 equipment items use this type with `priceType=from`.

### Edit Item form — Phase P defects

**R9-BAK-001 confirmed cross-archetype (equipment-rental):** Edit form opens with blank name, description, and all fields at defaults. Specific manifestation for `rental` ctaType:
- Form opens via JS `dispatchEvent` (Chrome extension `left_click` ref-based clicks do not trigger React synthetic events — a tooling limitation, not an app bug)
- Name field empty, description empty, `ctaType` select shows "Booking" (not "rental")

**R10-EQ-001 (Defect / Medium) — NEW:** `ctaType=rental` is absent from the Edit Item form's CTA type dropdown. In `apps/web/components/storefront-admin/ItemFormDialog.tsx`:
- `CTA_TYPES` array (lines 48–53): only `booking`, `purchase`, `inquiry`, `donation`
- `PRICE_TYPES_BY_CTA` map (lines 55–75): no entry for `rental`
- `CTA_LABEL_DEFAULTS` map (lines 77–82): no entry for `rental`

When an operator opens Edit on a rental item, the dropdown renders no matching option for `rental` and falls back to showing "Booking" as selected. An operator who saves would silently overwrite `ctaType=rental` with `ctaType=booking`, converting the item to a booking (slot-calendar) flow.

---

## Phase B5 — Public Storefront

### CTA routing results — all 6 items
| Item | Rendered CTA | Routes to | Form type | Result |
|---|---|---|---|---|
| Mini Excavator | **Reserve** ✅ | `/inquire/itm-V2jZ1ING` | Rental inquiry form | ✅ correct |
| Scaffold Tower | **Reserve** ✅ | `/inquire/itm-bpUzESTM` | Rental inquiry form | ✅ |
| Generator (5kW) | **Reserve** ✅ | `/inquire/itm-oK-yPJTJ` | Rental inquiry form | ✅ |
| Pressure Washer | **Reserve** ✅ | `/inquire/itm-8EoKJlEh` | Rental inquiry form | ✅ |
| Party Tent (6x12m) | **Reserve** ✅ | `/inquire/itm-QOuDwCTY` | Rental inquiry form | ✅ |
| Check Availability | **Enquire** | `/inquire/itm-kveNWTRM` | Rental inquiry form | ✅ (ctaLabel empty → correct fallback) |

**Positive finding:** `ctaLabel` stored as "Reserve" is rendered correctly for all 5 rental items. Confirms that the storefront CTA component reads `StorefrontItem.ctaLabel` for `rental` ctaType, just as it does for `booking` ctaType. The R9-CAT-001 bug (hardcoded "Enquire") is confirmed to be inquiry-specific only.

### Rental flow — formSchema
`ctaType=rental` routes to `/s/<slug>/inquire/<itemId>` (same path as `ctaType=inquiry`). The `equipment-rental` archetype seeds a rental-specific `formSchema` on `StorefrontArchetype`:

| Field | Type | Required |
|---|---|---|
| Full name | text | ✅ |
| Email | email | ✅ |
| Phone | tel | — |
| What do you need? | textarea | ✅ |
| **Pickup date** | text (date format) | ✅ |
| **Return date** | text (date format) | ✅ |
| Anything else? | textarea | — |

Pickup date and Return date are rental-specific fields not seen in any prior archetype. The formSchema mechanism correctly delivers these to the customer-facing enquiry form. ✅

### End-to-end rental inquiry test
- Submitted enquiry for Mini Excavator: name "Phase W R10 Test", pickup 2026-07-01, return 2026-07-03
- Reference: **INQ-MABGX48K** ✅
- Success redirect to `/checkout?ref=INQ-MABGX48K&type=inquiry` ✅
- Delivered to admin Reservations / Inbox under "Inquiry / New lead" ✅

### Phase B5 minor gap — enquiry page heading
The `/s/<slug>/inquire/<itemId>` page heading hardcodes **"Enquire about [Item Name]"** regardless of `ctaType`. For `ctaType=rental`, the heading should say "Reserve [Item Name]" or "Request to hire [Item Name]". Low priority UX gap.

### Storefront sections rendering — root cause identified
Sections in DB: 5 (all `isVisible=true`). Sections rendering in DOM: 4.

DOM inspection confirmed the rendering pattern:
| Section | Renders? | Why |
|---|---|---|
| Hero | ✅ (with gradient bg) | Uses `orgName` + `tagline` — no content needed |
| About Us | ⚠️ (empty div, invisible) | Renders but `content.body = ""` — blank paragraph |
| Equipment & Rates | ✅ | Uses items list — no section content needed |
| **Our Team** | ❌ (absent from DOM) | `TeamSection` line 11: `if (members.length === 0) return null` |
| Reserve or Ask | ⚠️ (empty div, no info) | `ContactSection` renders with border but no email/phone/address set |

**R10-SECT-001 (Gap / Medium) — ROOT CAUSE FOUND (cross-archetype):** Content-dependent section components early-return `null` when seeded with empty `content = {}`. `TeamSection` is the confirmed instance (`if (members.length === 0) return null`). `GallerySection` and `TestimonialsSection` likely have the same pattern. The archetype reset seeds section type/title/sortOrder/isVisible but not section content (members, images, testimonials). Fix options: (a) seed archetype-appropriate demo content on reset, or (b) render an "Add team members in admin" placeholder instead of null.

### Price display
All 5 rental items have `priceType=from` — no price badge displays on storefront cards. Confirmed cross-archetype gap (also seen in bakery and restaurant). ✅

---

## Phase G — Finance

### Finance verification
| Observation | Value | Expected | Result |
|---|---|---|---|
| Default currency (before customer selection) | GBP | USD | R9-G-001 confirmed ✅ |
| Default tax rate | 20% | ~10.25% (US/WA) | R9-G-003 confirmed ✅ |

All Phase G cross-archetype gaps persist in equipment-rental context.

---

## Summary scorecard

| Phase | Pass | Gap/Defect | Notes |
|---|---|---|---|
| P (Admin) | ✅ Archetype loaded, 5 sections + 6 items, new capabilities discovered | R9-BAK-001 confirmed; R10-EQ-001 new (rental ctaType missing from ItemFormDialog) | New: `rental` ctaType, Units nav, team section type |
| B5 (Storefront) | ✅ All CTAs route correctly, rental formSchema with pickup/return dates renders, end-to-end INQ-MABGX48K delivered | R10-SECT-001 root cause (TeamSection null on empty), from-price badge gap, enquiry heading gap | "Reserve" label renders correctly — R9-CAT-001 confirmed inquiry-only |
| G (Finance) | ✅ Finance Specialist visible | R9-G-001 + R9-G-003 cross-archetype confirmed | No equipment-rental-specific Finance gaps |

### New findings this run

| ID | Severity | Description |
|---|---|---|
| **R10-EQ-001** | Medium | `ctaType=rental` missing from ItemFormDialog: absent from CTA type dropdown, price options map, and label defaults. Saving an edited rental item silently converts it to `ctaType=booking`. |
| **R10-SECT-001** | Medium (root cause) | Cross-archetype sections-not-rendering gap root cause: content-dependent section components (Team confirmed; Gallery/Testimonials likely same) return `null` when `content={}`. Archetype reset seeds section structure but no content. |
| Enquiry heading UX | Low | `/inquire/<itemId>` page hardcodes "Enquire about [Item]" — should respect `ctaType` (rental items should say "Reserve [Item]"). |

### Positive findings
- `ctaType=rental` is a coherent new CTA type: routes to inquiry form, renders stored `ctaLabel` correctly, formSchema correctly delivers rental-specific date fields
- Pickup date / Return date fields in formSchema render and submit correctly
- End-to-end rental inquiry flow fully functional

### New capabilities discovered

| Capability | Location | Notes |
|---|---|---|
| `ctaType=rental` | StorefrontItem | Routes to inquiry form with rental formSchema; stores and renders `ctaLabel` |
| `pickupDate` / `returnDate` formSchema fields | Enquiry form | First date-range fields in formSchema across all archetypes |
| "Units" admin nav tab | `/storefront/units` | Asset-inventory surface, not yet audited |
| `team` section type | SectionRenderer | Handled; returns null when no members seeded |
| "Rental Portal" branding | Admin nav heading | Archetype-specific portal label confirmed working |

### Asset-rental category — archetypes remaining
- `self-storage` — second archetype in category, not yet audited
