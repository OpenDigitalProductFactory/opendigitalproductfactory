# Field Dispatch — Archetype Gap Analysis

| Field | Value |
| ----- | ----- |
| Status | Analysis — hand-off to a separate thread |
| Date | 2026-06-13 |
| Author | Agent (for Mark Bodman) |
| Purpose | Identify archetypes that would consume the [Field Dispatch capability](../specs/2026-06-13-field-dispatch-capability-design.md) but **do not exist yet** in the catalog. A separate thread will stand these up. |
| Inputs | Current catalog = 16 categories / 47 leaves (enumerated 2026-06-13 from `packages/storefront-templates/src/archetypes/`); [Field Dispatch capability design](../specs/2026-06-13-field-dispatch-capability-design.md); [FSM competitive analysis](2026-06-13-fsm-dispatch-competitive-analysis.md) |
| Note | Backlog not in this build — this is a planning artifact, not filed BIs. The separate thread authors leaves/categories directly per the working-mode rule. |

---

## 1. Method

An archetype needs field dispatch when, per the capability spec's derivation:

```
needsFieldDispatch(axes) := form="services" AND delivery∈{physical,hybrid}
                            AND service performed at the customer's location or on the customer's asset
```

I classified all 47 current leaves as **native** (dispatch is the core operation), **partial** (a mobile variant or delivery leg exists), or **none**. Then I listed dispatch-native business models that have **no home** in the catalog — as missing **leaves** (within an existing category) or missing **categories** (absent entirely).

---

## 2. Current catalog coverage

**Native field-dispatch (already exist) — these consume the capability immediately:**

| Leaf | Category |
| ---- | -------- |
| facilities-maintenance, plumber, electrician, cleaning-service, landscaping | trades-maintenance |
| property-management-company | hoa-property-management |
| municipal-utility, small-town-municipality, law-enforcement-agency | public-sector |
| new-home-builder, custom-home-builder | real-estate-construction |
| wholesale-distribution, florist | retail-goods |
| dog-walking | pet-services |
| it-managed-services | professional-services |
| catering | food-hospitality |

**Partial (mobile/delivery variant):** equipment-rental, personal-trainer, tutoring, corporate-training, driving-school, restaurant (delivery), veterinary-clinic (mobile/farm), physiotherapy (home visits), pet-grooming (shop today), pet-boarding (pickup), retail-goods (delivery/install), pet-rescue / animal-shelter / charity (transport, meal runs), agricultural-cooperative (shared machinery).

**None (facility/office/digital):** all banking, software-platform, gym/yoga/dance, dental-practice, optician, nail-salon, hair-salon (shop), beauty-spa, accounting, legal-services, marketing-agency, consulting, bakery, sports-club, cooperative, self-storage, homeowners-association, condo-association, artisan-goods.

**Read:** the capability already has ~18 native consumers on day one — it is not an HVAC one-off. The gaps below are the *missing* dispatch-native models.

---

## 3. Gap A — missing **leaves** in existing categories

These fit an existing category; the separate thread adds them as leaves (cheap — author `ArchetypeDefinition` + `FieldDispatchProfile`).

| Missing leaf | Parent category | Resource / fleet | Serviced entity | Compliance overlay | Dispatch-centrality | Notes |
| ------------ | --------------- | ---------------- | --------------- | ------------------ | ------------------- | ----- |
| **HVAC contractor** | trades-maintenance | technician / truck | equipment-unit | EPA 608 | ★★★ | The known gap; Dale's proving install; capability spec's reference vertical. |
| **Pest control** | trades-maintenance | applicator / truck | property-site | pesticide-applicator license + per-application log | ★★★ | Weather/re-entry gating; license-class match. New compliance overlay, high reuse. |
| **Appliance repair** | trades-maintenance | technician / van | equipment-unit | none | ★★★ | model/serial→parts; first-visit-fix metric. |
| **Pool / spa service** | trades-maintenance | technician | property-site | chemical handling | ★★ | Route-based recurring visits. |
| **Pressure washing / exterior** | trades-maintenance | technician / crew | property-site | none | ★★ | Same-category add to landscaping/cleaning (composition). |
| **Roofing / gutters** | trades-maintenance | crew | property-site | OSHA fall-protection | ★★ | Crew-as-unit; project-flavored. |
| **Home health / in-home care** | healthcare-wellness | nurse / aide | person | **HIPAA + clinical** | ★★★ | Large market; episode-of-care job; strict customer-scope; heavier compliance. |
| **Mobile phlebotomy / lab draw** | healthcare-wellness | phlebotomist | person | HIPAA + specimen chain | ★★ | Specimen handling + courier leg. |
| **DME delivery & setup** | healthcare-wellness | technician / van | equipment-unit @ person | DMEPOS / HIPAA | ★★ | Delivery + setup + training. |
| **Mobile pet grooming** | pet-services | groomer / van | animal | rabies-vax check | ★★★ | Distinct from shop grooming (which exists). Mobile-to-customer. |
| **Mobile vet** | pet-services or healthcare | veterinarian / van | animal | DEA/controlled-substance, license | ★★ | Could sit either side; resolve in the thread. |
| **Field inspection** (home / property / insurance) | professional-services | inspector | property-site / vehicle | inspector license/cert | ★★★ | Report-as-deliverable; no parts; photo-heavy. |
| **Surveying** | professional-services | surveyor / crew | property-site | PLS license | ★★ | Equipment-bound; project-flavored. |
| **Process serving / mobile notary** | professional-services | server / notary | person | jurisdiction rules | ★★ | Pure go-to-person dispatch. |
| **Mobile beauty / barber / on-location glam** | beauty-personal-care | stylist | person | cosmetology license | ★★ | Event + home; existing shop leaves stay. |
| **Meal-delivery program (Meals on Wheels)** | nonprofit-community | volunteer / driver | person (route) | food-handling | ★★ | Route-based; volunteer dispatch. |
| **Furniture / appliance delivery & install** | retail-goods | crew / truck | parcel @ property-site | none | ★★ | White-glove last-mile; composition with retail. |

---

## 4. Gap B — missing **categories** (absent entirely, dispatch-native)

These have no home at all. Heavier (new `ArchetypeCategory` + value-stream view + several leaves) but high payoff.

### B1. `automotive-services` — **highest-value gap** (Mark's windshield example lives here)
No automotive category exists. Dispatch-native, large market, and the **ADAS calibration** compliance overlay is a direct moat sibling to EPA 608 (no FSM covers it).

| Leaf | Resource / fleet | Serviced entity | Compliance overlay | Dispatch-centrality |
| ---- | ---------------- | --------------- | ------------------ | ------------------- |
| **Windshield / auto glass replacement** | installer / van | vehicle (VIN) | **ADAS calibration cert** | ★★★ |
| Mobile mechanic | technician / van | vehicle (VIN) | none | ★★★ |
| Mobile detailing / car wash | detailer / van | vehicle | water/chemical | ★★ |
| Mobile tire | technician / truck | vehicle | DOT (mounting) | ★★ |
| Roadside assistance / towing | driver / truck | vehicle (location) | DOT, motor-club | ★★★ (real-time) |
| Locksmith (auto + residential) | locksmith / van | vehicle / property | bonding/license | ★★★ |

Axes hint: `form: services, delivery: physical, primaryConsumer: individual, consumptionChannel: onsite-plus-portal, commercialModel: appointment-checkout` (roadside → real-time/usage). VIN→glass-SKU resolution and ADAS calibration are the distinctive substrate.

### B2. `moving-and-logistics` / last-mile
Crew + truck dispatch with DOT hours-of-service overlay; currently homeless (wholesale-distribution is the closest, but that's B2B route delivery).

| Leaf | Resource / fleet | Serviced entity | Compliance overlay | Dispatch-centrality |
| ---- | ---------------- | --------------- | ------------------ | ------------------- |
| Moving company | crew / truck | parcel (household) | DOT, USDOT/MC | ★★★ |
| Junk removal / hauling | crew / truck | parcel @ property-site | disposal/manifest | ★★★ |
| Courier / medical courier | driver | parcel | HIPAA (medical), chain-of-custody | ★★★ |
| Last-mile freight | driver / truck | parcel (route) | DOT | ★★★ |

### B3. `security-services`
Guard patrol dispatch is genuinely dispatch-native (post assignments, patrol routes, incident response); alarm install is field-service.

| Leaf | Resource / fleet | Serviced entity | Compliance overlay | Dispatch-centrality |
| ---- | ---------------- | --------------- | ------------------ | ------------------- |
| Guard / patrol services | officer | property-site / route | guard license (PSO) | ★★★ |
| Alarm / CCTV install & monitoring | technician / van | property-site | low-voltage license | ★★ |

*(Possible B4: `waste-sanitation` route collection — lower priority; overlaps public-sector + commercial.)*

---

## 5. Prioritized recommendations for the separate thread

Ranked by **dispatch-centrality × market size × compliance-overlay reuse × effort** (leaf = light, category = heavy):

| # | Gap | Shape | Effort | Why first |
| - | --- | ----- | ------ | --------- |
| 1 | **HVAC contractor** | leaf (trades) | light | Known gap, proving install, the capability's reference vertical — unblocks Dale. |
| 2 | **automotive-services + windshield/auto-glass** | **new category** + leaves | heavy | Mark's named example; ADAS overlay is a high-value moat sibling to EPA 608; large market. Author category, seed windshield first. |
| 3 | **Pest control** | leaf (trades) | light | Dispatch-native; pesticide-applicator overlay reused by lawn/agricultural. |
| 4 | **Appliance repair** | leaf (trades) | light | Dispatch-native; parts-by-van; no new overlay. |
| 5 | **Home health / in-home care** | leaf (healthcare) | medium | Huge market; HIPAA overlay (reused by mobile phlebotomy, medical courier). |
| 6 | **Mobile pet grooming** | leaf (pet-services) | light | Dispatch-native; clean mobile-to-customer example. |
| 7 | **Field inspection** | leaf (professional) | light | Dispatch without parts/inventory — exercises the report-as-deliverable path. |
| 8 | **moving-and-logistics** (junk removal, moving, courier) | **new category** + leaves | heavy | Crew+truck + DOT overlay; large market; route-based dispatch variant. |
| 9 | **security-services** (guard patrol, alarm) | **new category** + leaves | heavy | Patrol dispatch is a distinct real-time variant; guard-license overlay. |
| 10 | **Mobile beauty / barber** | leaf (beauty) | light | Mobile variant alongside existing shop leaves. |

**Sequencing suggestion for the thread:** knock out the light trades/healthcare/pet/professional **leaves** first (1, 3–7, 10) — each is hours of work and immediately consumes the capability — then take on the three **new categories** (2, 8, 9) which each need a category definition, value-stream view, and a new compliance overlay.

**Compliance-overlay reuse map** (build once in the capability's F9 framework, reused across gaps):
- **EPA 608** → HVAC.
- **ADAS calibration** → windshield (+ future mobile mechanic).
- **Pesticide-applicator** → pest control (+ lawn/agricultural treatment).
- **HIPAA/clinical** → home health, mobile phlebotomy, mobile vet, medical courier.
- **DOT hours** → moving, last-mile freight, towing.
- **Bonding/insurance** → cleaning, locksmith, security.

Each new vertical that reuses an existing overlay is nearly free; each that needs a new overlay funds one reusable framework instance.

---

## 6. Composition implications (for the thread)

Per the [multi-archetype composition design](../specs/2026-06-13-multi-archetype-composition-design.md), several of these are **secondary service lines** on an existing primary, not standalone installs — author them so they compose:
- Landscaping **+ pressure washing + snow removal** (same trades category — zero-ceremony same-category union).
- Trades primary **+ supplies/parts reorder** (retail secondary) — the spec's "dispatch map + reorder warnings" example.
- Retail primary **+ delivery & install** (field-dispatch secondary).
- Cleaning **+ pest control** (cross-leaf, same category).

The thread should set each leaf's `axes` and `FieldDispatchProfile` so `needsFieldDispatch()` derives correctly and `mergeActivationProfiles` unions the `field-dispatch` module without conflict.
