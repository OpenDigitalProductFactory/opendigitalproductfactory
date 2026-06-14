# Field Dispatch Capability — Consumer Requirements Handoff (from the archetype catalog)

| Field | Value |
| ----- | ----- |
| Status | Handoff — consumer-side requirements for the parallel capability thread |
| Date | 2026-06-14 |
| Author | Agent (archetype-catalog thread, for Mark Bodman) |
| To | The **Field Dispatch capability** thread (building `needsFieldDispatch()`, `FieldDispatchProfile`, the `field-dispatch` module, dispatcher coworker, and board) |
| Purpose | The 29 dispatch-native archetypes are now **merged** ([#1856](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1856)) plus onboarding profiles ([#1857](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1857)). This doc states, from the consumer side, what the capability must satisfy so it serves all of them correctly — expressed as a SysML architecture note (requirements / constraints / interfaces / allocations / verification cases) over the existing substrate. |
| Grounded by | The merged archetypes in `packages/storefront-templates/src/archetypes/`; the 2026-06-13 *Field Dispatch capability design* and its *archetype gap analysis*; `packages/storefront-templates/src/activation-profile.ts` (`readActivationProfile`, `inferLegacyAxes`, `MODULES`); `docs/architecture/archetype-business-value-streams.md` §10.2 |
| Not in scope | Building the capability. This is requirements input, not an implementation. |

---

## SysML Architecture Note

- **Scope:** the horizontal Field Dispatch capability as it must consume the merged archetype catalog (87 leaves, 19 categories). The capability is the *system under design*; the archetype catalog is a fixed *external interface* it must satisfy.
- **Changed requirements/constraints:** R-FD-1…R-FD-12, C-FD-1…C-FD-4 below.
- **Changed interfaces/ports:** the `OperatingModelAxes` → `FieldDispatchProfile` derivation contract (§3); the derived `field-dispatch` `ArchetypeModule`; the `map-dispatch` `visualPattern` already emitted by `composition-view.ts` (now on main).
- **Allocations:** per-archetype `servicedEntity` / `siteModel` / `dispatchMode` / `resource.unit` / compliance-overlay obligations (§4) — the derivation reference data.
- **Verification cases:** V-FD-1…V-FD-5 (§5), anchored by a golden-file test of `needsFieldDispatch()` over all of `ALL_ARCHETYPES`.
- **Data authority:** the archetype `activationProfile.axes` (in `storefront-templates`, seeded to `StorefrontArchetype.activationProfile`) is the **source of truth**; `FieldDispatchProfile` is a **derived projection** (derive-with-override), never a hand-authored per-leaf field.
- **EA/current-state catch-up:** `docs/architecture/archetype-business-value-streams.md` §10.2 already records the field-dispatch value-stream pattern; the capability should satisfy/verify against it. The older `2026-05-19-field-service-trades-ai-dispatch-design.md` is superseded by the capability design (HVAC = first consumer).
- **Open architecture risks:** the pre-merge trades leaves carry no axes (R-FD-1); `servicedEntity` is not derivable from axes alone (R-FD-3); the real-time variant is not expressible in current axes (R-FD-5). These are the three that most affect "meets the needs."

---

## 1. Requirements

### R-FD-1 — Existing trades leaves must derive dispatch too **[HIGHEST]**
The five **pre-merge** trades leaves — `plumber`, `electrician`, `cleaning-service`, `landscaping`, `facilities-maintenance` — carry **no `activationProfile` at all** (`readActivationProfile(undefined)` → `null`), so they expose **no axes** for `needsFieldDispatch()` to read. My six new trades leaves (`hvac-contractor`, etc.) set explicit axes and will dispatch; the five originals will **not**. That leaves the capability's own reference vertical (trades) half-dispatch.
**Acceptance:** `needsFieldDispatch()` is true for all 11 trades leaves. Fix in F7 by adding explicit `onsite-plus-portal` axes to the five originals (mirror what the new leaves do) — see C-FD-2 for the one sanctioned exception to "don't touch merged axes."

### R-FD-2 — `FieldDispatchProfile` must be DERIVED by default, never required per-leaf **[HIGHEST / architectural]**
I deliberately authored **zero** `FieldDispatchProfile` objects on the 29 archetypes, per capability-design ADR-4 (derive-with-override, like `MediaProfile`). If the capability requires an explicit profile per archetype, all 29 (+ trades) need retrofitting and the "axes in, profile out" thesis breaks.
**Acceptance:** `deriveFieldDispatchProfile(axes, archetypeId)` returns a complete, non-null profile for all 29 with **zero** per-leaf authoring; overrides exist only where derivation is genuinely ambiguous.

### R-FD-3 — `servicedEntity` needs category/archetypeId awareness, not axes alone **[HIGH]**
`hvac-contractor` (equipment-unit), `cleaning-service` (property-site), and `home-health-care` (person) can share an identical axis tuple (`services` / `physical` / `onsite-plus-portal`). `servicedEntity` therefore **cannot** be a pure function of axes. Derive it from category + archetypeId (+ tags). §4 is the authoritative map.
**Acceptance:** each archetype's derived `servicedEntity` equals §4.

### R-FD-4 — `episode-of-care` provisioning must also trigger dispatch **[HIGH]**
`home-health-care` and `mobile-phlebotomy` set `provisioning: "episode-of-care"` (with `onsite-plus-portal`). ADR-1 says the "service performed at the customer's location" clause is read from `provisioning`/`consumptionChannel`; the derivation must treat `episode-of-care` as a positive signal, not just `onsite-plus-portal`.
**Acceptance:** both derive dispatch.

### R-FD-5 — Real-time dispatch variant must be expressible **[HIGH]**
`roadside-assistance`, `locksmith`, and `guard-patrol` are **real-time / emergency** — the call *is* the job; post/patrol/incident response, not a scheduled appointment (capability design ADR-3; competitive analysis on real-time). Current axes (`transactional` / `recurring-agreement`) do **not** distinguish them. The `FieldDispatchProfile` needs a `dispatchMode: "scheduled" | "real-time"` (or equivalent). §4 marks the real-time set.
**Acceptance:** the profile flags these three as real-time and the board/coworker handle the real-time loop.

### R-FD-6 — Crew-as-unit assignment **[MEDIUM]**
`moving-company`, `junk-removal`, `roofing-gutters`, `pressure-washing`, `land-surveying`, `furniture-delivery-install`, `mobile-beauty` (event), and `guard-patrol` (post coverage) are **crew-based**, not solo-technician (capability-design deferred decision #3). `resource.unit` must support `"crew"` and the assignment engine (F4) must treat a crew as one assignable unit. §4 marks the crew set.
**Acceptance:** assignment does not assume a solo resource for these.

### R-FD-7 — `siteModel` distinction drives routing **[MEDIUM]**
`mobile-to-customer` (auto, mobile grooming/beauty/phlebotomy), `customer-premises` (HVAC, pest, roofing, inspection), and `route-based` (meal-delivery, courier, last-mile-freight, recurring pool/pest) need different board/route behavior (travel-time ETAs vs route optimization). §4 gives the map.
**Acceptance:** derived `siteModel` equals §4.

### R-FD-8 — Derived `field-dispatch` module must ADD to, not replace, `service-operations` **[MEDIUM]**
All 29 leaves currently activate field work under the `service-operations` module (the `field-dispatch` module does not exist yet). When the capability adds the derived `field-dispatch` `ArchetypeModule` (ADR-2): (a) it must **union** with `service-operations` via `mergeActivationProfiles`, not displace it; and (b) adding `"field-dispatch"` to the `MODULES` validation set in `activation-profile.ts` must not invalidate any merged archetype.
**Acceptance:** all 29 retain `service-operations` **and** gain `field-dispatch`; the existing `storefront-templates` + `apps/web` suites stay green.

### R-FD-9 — The board must key off the already-wired `map-dispatch` signal **[MEDIUM]**
`apps/web/lib/storefront/composition-view.ts` (on main) already resolves `automotive-services`, `moving-and-logistics`, `security-services`, and trades (with `service-operations`) to `visualPattern: "map-dispatch"`. The F3 board should render for that same signal (map-dispatch / `field-dispatch` module) — do **not** introduce a second, divergent selector.
**Acceptance:** the dispatch board renders exactly for archetypes whose composition `visualPattern` is `map-dispatch`.

### R-FD-10 — Compliance-overlay framework must cover the consumed set **[MEDIUM]**
The 29 archetypes imply these overlays (capability-design F9 / ADR-5): `epa-608`, `adas-calibration`, `pesticide-applicator`, `hipaa-clinical`, `dea-controlled-substance`, `dot-hours`, `osha-fall-protection`, `bonding-insurance`, `pso-guard-license`, `low-voltage-license`, `food-handling`, `dmepos`. F9 must be a pluggable registry; ship `epa-608` + `adas-calibration` first. §4 gives the overlay→archetype map.
**Acceptance:** F9 accepts these as registered overlay keys (even if only the first two ship behavior).

### R-FD-11 — Golden test over all leaves, kept in sync **[LOW-MEDIUM]**
The capability design's risk table calls for a golden-file test of `needsFieldDispatch()` over every leaf (was 47; now **87**). §5 gives the expected dispatch set.
**Acceptance:** a golden test asserts the derivation returns exactly the expected set across `ALL_ARCHETYPES` and fails when a future leaf's axes mis-derive.

### R-FD-12 — Vertical-specific vocabulary **[LOW]**
`FieldDispatchProfile.vocabulary` (resource noun / job noun / visit) must vary per vertical: techs+trucks (HVAC), installers+vans (auto glass), cleaners+crews, drivers+routes (delivery), officers+patrols (guard), nurses/aides+visits (home-health). A generic "technician/job" for all reads wrong.
**Acceptance:** derived vocabulary is vertical-appropriate (§4 hints the resource noun).

---

## 2. Constraints

- **C-FD-1** — Do not require per-leaf `FieldDispatchProfile` authoring (realizes R-FD-2).
- **C-FD-2** — Do not mutate the **merged** archetypes' axes to make derivation work; the 29 new leaves' axes are the contract. **Sanctioned exception:** F7 may add axes to the **five pre-merge trades leaves** that lack any (R-FD-1), since they currently have none.
- **C-FD-3** — Adding `"field-dispatch"` to `ArchetypeModule` and the `MODULES` set must be backward-compatible (no existing archetype or test breaks).
- **C-FD-4** — No per-archetype hardcoded dispatch flag and no provider pinning; applicability is derived from axes (ADR-1, kernel `no-provider-pinning` / `principle-based-rules`).

---

## 3. Interface contract — axes → FieldDispatchProfile

The merged archetypes encode dispatch applicability in `activationProfile.axes` exactly as:

```
needsFieldDispatch(axes) := axes.form === "services"
                         && (axes.delivery === "physical" || axes.delivery === "hybrid")
                         && ( axes.consumptionChannel === "onsite-plus-portal"
                           || axes.provisioning === "episode-of-care" )
```

Every one of the 29 new leaves satisfies this. The derivation must **not** depend on `commercialModel` (it varies: `transactional`, `recurring-agreement`, `appointment-checkout`, `encounter-based`, `account-based-fees`, even `donation` CTA for `meal-delivery-program`) — `commercialModel` selects billing, not dispatch. `servicedEntity`, `siteModel`, `dispatchMode`, `resource.unit`, and `complianceOverlays` are **not** in the axes and must come from §4 (category/archetypeId/tag-keyed override table inside `deriveFieldDispatchProfile`).

---

## 4. Allocation reference — per-archetype derivation data

`mode`: S = scheduled, **RT = real-time**. `unit`: solo / **crew**. This is the authoritative source for the R-FD-3/5/6/7/10/12 mappings.

| Archetype | servicedEntity | siteModel | mode | unit (resource noun) | compliance overlay |
| --- | --- | --- | --- | --- | --- |
| `hvac-contractor` | equipment-unit | customer-premises | S | solo (technician / truck) | epa-608 |
| `pest-control` | property-site | route-based | S | solo (applicator / truck) | pesticide-applicator |
| `appliance-repair` | equipment-unit | customer-premises | S | solo (technician / van) | — |
| `pool-spa-service` | property-site | route-based | S | solo (technician) | bonding-insurance (chemical) |
| `pressure-washing` | property-site | customer-premises | S | **crew** | — |
| `roofing-gutters` | property-site | customer-premises | S | **crew** | osha-fall-protection |
| `home-health-care` | person | customer-premises | S | solo (nurse / aide) | hipaa-clinical |
| `mobile-phlebotomy` | person | mobile-to-customer | S | solo (phlebotomist) | hipaa-clinical (+ specimen chain) |
| `dme-delivery` | equipment-unit @ person | customer-premises | S | solo/2-person (technician / van) | dmepos, hipaa-clinical |
| `mobile-pet-grooming` | animal | mobile-to-customer | S | solo (groomer / van) | rabies-vax-check |
| `mobile-vet` | animal | mobile-to-customer | S | solo (veterinarian / van) | dea-controlled-substance |
| `field-inspection` | property-site | customer-premises | S | solo (inspector) | inspector-license/cert |
| `land-surveying` | property-site | customer-premises | S | **crew** (surveyor) | pls-license |
| `process-serving-notary` | person | mobile-to-customer | S | solo (server / notary) | jurisdiction-rules / notary-commission |
| `mobile-beauty` | person | mobile-to-customer | S | solo/**crew** (event) | cosmetology-license |
| `meal-delivery-program` | person (route) | route-based | S | **crew** (volunteer / driver) | food-handling |
| `furniture-delivery-install` | parcel @ property-site | customer-premises | S | **crew** (2-person) | — |
| `auto-glass` | vehicle (VIN) | mobile-to-customer | S | solo (installer / van) | **adas-calibration** |
| `mobile-mechanic` | vehicle (VIN) | mobile-to-customer | S | solo (technician / van) | — |
| `mobile-detailing` | vehicle | mobile-to-customer | S | solo (detailer / van) | bonding-insurance (water/chemical) |
| `mobile-tire` | vehicle | mobile-to-customer | S | solo (technician / truck) | dot-hours (mounting) |
| `roadside-assistance` | vehicle (location) | mobile-to-customer | **RT** | solo (driver / truck) | dot-hours, motor-club |
| `locksmith` | vehicle / property-site | mobile-to-customer | **RT** | solo (locksmith / van) | bonding-insurance |
| `moving-company` | parcel (household) | customer-premises (origin+dest) | S | **crew** + truck | dot-hours (USDOT/MC) |
| `junk-removal` | parcel @ property-site | customer-premises | S | **crew** + truck | disposal/manifest |
| `courier-delivery` | parcel | route-based / on-demand | S + some RT | solo (driver) | hipaa-clinical (medical), chain-of-custody |
| `last-mile-freight` | parcel (route) | route-based | S | solo/driver + truck | dot-hours |
| `guard-patrol` | property-site / route | customer-premises + route | **RT** | officer (**crew** = coverage) | pso-guard-license |
| `alarm-cctv-install` | property-site | customer-premises | S (install) + recurring (monitoring) | solo (technician / van) | low-voltage-license |

**Existing leaves the capability should also cover (audit, not in this PR):** the gap analysis lists `dog-walking`, `catering`, `florist` (delivery), `property-management-company` and the public-sector field leaves as native/partial dispatch — several carry no axes today. Treat as an F7-adjacent audit: a leaf only dispatches if it exposes qualifying axes (R-FD-1 is the trades instance of this).

---

## 5. Verification cases

- **V-FD-1 (golden set)** — `needsFieldDispatch()` over `ALL_ARCHETYPES` returns exactly: the 29 leaves in §4 **plus** the 5 trades originals once F7 lands (R-FD-1) **plus** `it-managed-services` (already `services`/`hybrid`/`onsite-plus-portal`). It must return **false** for goods archetypes (`new-home-builder`, `custom-home-builder`, `wholesale-distribution`) and digital/premises ones (banking, salons, gym). Fail the test on any drift.
- **V-FD-2 (episode-of-care)** — `home-health-care` and `mobile-phlebotomy` derive dispatch via the `provisioning` clause (R-FD-4).
- **V-FD-3 (servicedEntity)** — derived `servicedEntity` matches §4 for all 29, including the same-axes/different-entity trio (`hvac-contractor` / `cleaning-service` / `home-health-care`) (R-FD-3).
- **V-FD-4 (real-time + crew)** — `roadside-assistance`, `locksmith`, `guard-patrol` derive `dispatchMode: real-time`; the crew set in §4 derives `resource.unit: crew` (R-FD-5/6).
- **V-FD-5 (module union)** — after the derived module lands, all 29 archetypes' normalized profiles contain **both** `service-operations` and `field-dispatch`, and the full pre-existing test suite stays green (R-FD-8).

---

## 6. One-line ask

Build the derivation so **all 29 merged archetypes light up with zero per-leaf authoring**, close the **trades-originals axes gap (R-FD-1)** so the reference vertical is whole, and treat **§4 as the override table** for the four things axes can't carry (servicedEntity, siteModel, dispatchMode, crew/overlay). Ping me (the archetype thread) if any axis on the 29 needs to change — I'd rather adjust the catalog than have you special-case it.
