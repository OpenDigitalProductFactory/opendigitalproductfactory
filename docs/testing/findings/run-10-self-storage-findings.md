# Phase W Run 10 — Asset Rental: Self-Storage Facility Archetype
**Audit date:** 2026-06-14
**Archetype slug:** `self-storage`
**Storefront slug:** `peak-physio-clinic` (archetype reset applied to existing workspace)
**Auditor:** Claude / Phase W systematic test suite
**Branch:** `doc/phase-w-run1-retest`

---

## Phase P — Admin / Storefront Setup

### Archetype reset
- Reset via POST `/api/storefront/admin/archetype-reset` with `{targetArchetypeId: 'self-storage'}` ✅
- Result: 5 sections created, 5 items created ✅

### Admin nav — archetype-specific branding
| Element | Value | Notes |
|---|---|---|
| Portal heading | **"Storage Portal"** | Distinct from equipment-rental's "Rental Portal" |
| Inbox/reservations nav | **"Move-ins"** | First inbox rename seen in Phase W testing |
| Items tab | **"Unit Sizes & Rates"** | Archetype-specific vocabulary |
| Units tab | `/storefront/units` | Present (same as equipment-rental) |

### Storefront sections
| # | Section name | Section type |
|---|---|---|
| 1 | Hero | hero |
| 2 | About Our Facility | about |
| 3 | Unit Sizes & Rates | items |
| 4 | Facility Team | team |
| 5 | Reserve a Unit | contact |

Same 5 section types as equipment-rental. `team` section type confirmed cross-archetype within asset-rental category.

### Menu items
| Item | ctaType | priceType | ctaLabel (DB) |
|---|---|---|---|
| 5x5 Unit | rental | from | Reserve unit |
| 10x10 Unit | rental | from | Reserve unit |
| 10x20 Unit | rental | from | Reserve unit |
| Climate-Controlled 10x10 | rental | from | Reserve unit |
| Check Availability & Waitlist | inquiry | free | (empty) |

All rental items seeded with archetype-specific label "Reserve unit" — distinct from equipment-rental's "Reserve". ✅

### Phase P defects
- **R9-BAK-001 confirmed cross-archetype**: Edit form opens blank (pre-population broken)
- **R10-EQ-001 confirmed cross-archetype**: `ctaType=rental` not in ItemFormDialog dropdown

---

## Phase B5 — Public Storefront

### CTA routing
All 4 rental items display "Reserve unit" on public storefront ✅ — confirms `ctaLabel` is read and rendered for `rental` ctaType items, same as equipment-rental.

Inquiry item "Check Availability & Waitlist" displays "Enquire" ✅ (correct fallback for empty ctaLabel).

All CTAs route to `/s/<slug>/inquire/<itemId>`.

### Self-storage formSchema — new fields
The `self-storage` archetype seeds a distinct `formSchema`:

| Field | Type | Options |
|---|---|---|
| Full name | text | — |
| Email | email | — |
| Phone | tel | — |
| **Unit size** | select | 5x5 / 10x10 / 10x20 / Climate-Controlled 10x10 / Not sure |
| **Desired move-in date** | date text | — |
| **What are you storing?** | textarea | — |

Three storage-specific fields not seen in any prior archetype: unit size dropdown, move-in date, storage description. ✅

### End-to-end test
- Submitted enquiry for 5x5 Unit: name "Phase W R10 Storage Test", unit size 5x5, move-in 2026-07-15
- Reference: **INQ-QCHNXK3X** ✅
- Redirect to `/checkout?ref=INQ-QCHNXK3X&type=inquiry` ✅

### Confirmed gaps (cross-archetype)
| Gap | Result |
|---|---|
| Enquiry page heading hardcodes "Enquire about [Item]" for rental ctaType | ❌ Confirmed |
| `priceType=from` items show no price badge on storefront card | ❌ Confirmed |
| Content-dependent section (Facility Team) returns null when no members | ❌ Confirmed |

---

## Phase G — Finance

Finance cross-check deferred — same workspace as equipment-rental audit; gaps R9-G-001 (GBP default) and R9-G-003 (20% tax) already confirmed in this session. No self-storage-specific Finance gaps expected.

---

## Summary scorecard

| Phase | Pass | Gap/Defect | Notes |
|---|---|---|---|
| P (Admin) | ✅ Archetype loaded, archetype-specific nav branding confirmed | R9-BAK-001, R10-EQ-001 confirmed | "Move-ins" inbox rename — new to Phase W |
| B5 (Storefront) | ✅ "Reserve unit" renders, 3-field self-storage formSchema works, INQ-QCHNXK3X delivered | Heading gap, from-price badge gap, Facility Team section null | |
| G (Finance) | Deferred (same workspace) | — | |

### Asset-rental category — category summary (both archetypes complete)

| Dimension | equipment-rental | self-storage |
|---|---|---|
| ctaType | rental (×4) + inquiry (×1) | rental (×4) + inquiry (×1) |
| ctaLabel | "Reserve" / empty | "Reserve unit" / empty |
| formSchema | Pickup date + Return date | Unit size dropdown + Move-in date + What storing |
| Inbox label | "Reservations" | **"Move-ins"** |
| Portal label | "Rental Portal" | "Storage Portal" |
| ctaType=rental rendering | "Reserve unit" label renders ✅ | "Reserve unit" renders ✅ |
| End-to-end inquiry | INQ-MABGX48K ✅ | INQ-QCHNXK3X ✅ |

The `rental` ctaType is architecturally sound: distinct from `booking` (no slot calendar), routes through the inquiry path with a formSchema, and renders operator-configured button labels correctly. The gap is admin-side only: ItemFormDialog doesn't know about `rental`, so operators cannot edit rental items without inadvertently changing their ctaType.
