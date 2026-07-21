# Warehousing & Fulfilment Archetype — the goods-custody operating model

**Date:** 2026-07-21
**Status:** Implemented
**Area:** `packages/storefront-templates` archetype taxonomy + capability activation
**Decision surface:** `archetype-taxonomy-design` (kernel-routed via `principle_decide`, ledger `DI-B64BDAE75CD0`)

## Goal

Give DPF coverage of warehousing and delivery. Before this change the taxonomy
covered the *movement* half of logistics but had no representation of the
*custody* half — no archetype for a business that takes goods it does not own
into a facility and is paid to hold and handle them.

## Business landscape (research)

SMB logistics splits into two structurally distinct cores. They differ in the
unit of work, the resource that gets scheduled, and — decisively — the revenue
meter.

**Movement core** — the unit of work moves; the operator never holds an
inventory of record.

| Model | Unit of work | Scheduled resource | Revenue meter |
|---|---|---|---|
| Courier / last-mile / same-day | the **stop** (drop or collection) | driver-shift + van, route + time window | per stop / per job / per hour |
| Moving & removals | the **move** (survey → pack → load → transit → deliver) | crew + truck for a day | per hour (local) / weight-distance (long-haul) |
| Asset trucking carrier (FTL / LTL) | the **load**, or a shipment on a linehaul leg | tractor, trailer, driver HOS clock | per mile / per cwt-class / per load |
| Freight brokerage (non-asset) | the **load**, matched shipper ↔ carrier | none physical — carrier capacity on a lane, and broker desk time | **margin/spread** on the load (10–25%, ~15% typical) |

**Custody core** — the goods come to rest in the operator's facility, under the
operator's control, and the operator is liable for them.

| Model | Unit of work | Scheduled resource | Revenue meter |
|---|---|---|---|
| 3PL contract warehousing | pallet position held; receipt/release transaction | rack slots, dock doors, forklift labour | per pallet/cu-ft per month **+ handling in/out** |
| E-commerce fulfilment centre | order line → pick → pack → ship | pick labour, pack stations, carrier cut-off | per order + per pick + per pack + storage |
| Cross-dock / transload | inbound trailer → outbound trailer within hours | dock doors and door-time, *not* storage | per pallet / handling unit crossed |

Cold storage, bonded, hazmat, and records storage are **variants** of the
custody core — temperature and compliance attributes on the location and the
item — not separate operating models. Likewise same-day vs next-day is an SLA
parameter on the courier loop, and LTL vs FTL is the same asset-carrier loop
with a terminal stage inserted.

**Self-storage is not in either core.** It shares the word "storage" and
nothing else: the customer keeps their own key, the operator never takes
custody, and no goods are handled. It is a real-estate business wearing
logistics clothes, and DPF already models it correctly under `asset-rental`
via the `reservation-and-return` provisioning model.

### The custody-core operating loop

- **Inbound:** ASN → dock appointment → receipt → put-away.
- **Outbound:** order → wave → pick → pack → despatch.
- **Standing:** cycle count, inventory adjustment, kitting/VAS, returns.
- **Roles:** account/client manager, receiving clerk, put-away/forklift, picker,
  packer, shipping clerk, inventory controller, warehouse manager, billing admin.
- **KPIs:** dock-to-stock (<48h standard, <24h best-in-class), inventory
  accuracy ≥98%, order accuracy 99.8–99.9% for scan-verified operations,
  on-time ship ≥98%, OTIF (US commercial warehousing averages ~88%; >95% is
  outperforming), cost per order, space & cube utilisation 80–90%, lines picked
  per labour hour.
- **Documents:** ASN (EDI 856), warehouse receipt (a document of title),
  put-away & pick list, packing list, BOL, carrier label + SSCC pallet label,
  POD, cycle-count adjustment, **rate card**, monthly activity invoice.

### Why the billing meter is load-bearing

The custody core's economics are a **rate card + monthly minimum +
accessorials**, not a single price. Storage runs roughly $15–40 per pallet per
month (metro premium 30–50%); receiving $25–50/pallet or $0.30–0.60/carton;
picking $0.30–0.75 per additional item on a $2–5 base per order; packing
$1.50–4.00/order; plus a $100–300/month account fee. Two billing shapes exist —
transactional, and fixed-fee-to-a-volume-band.

This matters architecturally: **storage rent and handling are two different
meters on the same account**, which no existing DPF billing pattern expresses.
That is the strongest single signal that this is a distinct operating model
rather than a variant of an existing one.

### Standards to align to

- **Process reference model.** ASCM's **SCOR Digital Standard** is the logistics
  equivalent of BIAN, currently at **v14.0 (2025)**. Note that SCOR DS uses
  **seven** processes — Orchestrate, Plan, Order, Source, Transform, Fulfill,
  Return — superseding the classic SCOR 12 Plan/Source/Make/Deliver/Return/Enable
  that older material still quotes. It carries an L1–L3 process decomposition,
  five performance attributes (Reliability, Responsiveness, Agility, Cost, Asset
  Management) and 250+ coded metrics. SCOR is open-access, so its metric codes
  are usable verbatim as KPI identifiers — e.g. `RL.1.1` Perfect Order
  Fulfillment (median 85%, advantage 90%, superior 96%).
- **Identification & events — GS1.** GTIN (trade item), **SSCC** (logistic unit —
  the join key between the physical pallet and the electronic ASN, and a
  mandatory element of the GS1 Logistic Label), GLN (locations/parties).
  **EPCIS 2.0** with JSON-LD bindings and the Core Business Vocabulary for
  cross-party event capture.
- **Transactional messaging — ANSI X12.** The warehouse 900-series is the
  3PL spine: **940** shipping order, **943** stock transfer shipment advice,
  **944** stock transfer receipt advice, **945** shipping advice, **947**
  inventory adjustment, plus 846 inventory advice and 856 ASN. Transport:
  204 load tender, 214 status, 210 freight invoice. UN/EDIFACT equivalents
  (IFTMIN, DESADV, RECADV, INVRPT) cover Europe.
- **Semantic model.** UN/CEFACT **Multimodal Transport Reference Data Model**
  for transport-document entities across all five modes.
- **Management systems.** ISO 28000:2022 (supply-chain security, Annex-SL,
  certifiable); GDP/GxP for pharma cold chain.

### SaaS category the custody core maps to

**WMS** — and specifically a *3PL* WMS, whose distinguishing feature over a
shipper WMS is exactly the **billing engine** (rate cards, storage accruals,
accessorials) plus multi-client tenancy. Adjacent categories the movement core
already implies: TMS, YMS, dock scheduling, last-mile orchestration, route
optimisation, POD capture.

## The decision — taxonomy shape (kernel-routed)

`ArchetypeCategory` is a closed union read by ~16 category-keyed files, so the
shape was routed through `principle_decide` (`callingPopulation:
external_coding_agent`, `ringScope: [ring-3-archetype, universal-ring]`).

1. **new-warehousing-category-with-custody-axis** — a new
   `warehousing-fulfilment` category plus a new `custody-and-fulfilment`
   provisioning value gating a new capability triad.
2. **extend-moving-and-logistics** — custody leaves added to the existing
   logistics category, no new axis, no new capabilities.
3. **reuse-asset-rental-custody-leaves** — treat a pallet position as a
   reservable pooled asset under `reservation-and-return`.

**Result:** the kernel recommended **option 1** — composite **1.968**, margin
**1.764**, **confidence high**, strong structured coverage, no commandment
conflict. Strongest contributors were *Never Assume — Verify* and *Architecture
Over Shortcuts*; *Ground New Work In Existing Platform* also favoured it,
because option 1 reuses the existing derivation machinery rather than inventing
a parallel one.

The two rejected options fail for concrete, checkable reasons:

- **Option 2** makes the category heterogeneous, and category heterogeneity is
  not cosmetic here — `operational-value-stream.ts` derives its defaults *per
  category*. `moving-and-logistics` defaults to `slot-hours` capacity and
  `seasonal` demand, both wrong for a warehouse whose capacity is racking space
  and whose demand is steady contract volume. This is the same reasoning that
  split the entertainment categories on 2026-07-11.
- **Option 3** inverts the rental loop. In rental, the operator's **own** asset
  goes out to the customer and comes back to be inspected and re-pooled. In
  warehousing, the **customer's** goods come in and the operator handles them.
  There is no return-and-inspect stage, no operator-owned asset pool, and the
  meter is storage-plus-handling rather than a rental period.

## Design

### Custody as an axis value, not a category flag

The discriminator is **custody of goods the operator does not own** (bailment).
It is expressed as a new `ProvisioningModel` value, `custody-and-fulfilment`,
exactly mirroring how `reservation-and-return` expresses the rental model. This
keeps capability gating a function of the operating model rather than a
hand-authored per-archetype flag, so a future non-warehouse archetype with a
custody leg inherits the capabilities by declaring the axis.

### Capability triad

Gated by `provisioning === "custody-and-fulfilment"` via a new
`custody-and-fulfilment-warehousing` applicability rule:

| Capability | Why it is separate |
|---|---|
| `goods-custody` | Whose goods, where, how many — owner-segregated stock ledger with lot/serial/expiry. The liability record. |
| `warehouse-operations` | The receive → put-away → pick → pack → despatch loop, plus cycle counting and dock appointments. The work record. |
| `storage-and-handling-billing` | Rate card, monthly minimum, storage accrual, accessorials. The two-meter billing engine that distinguishes a 3PL WMS. |

`storage-and-handling-billing` carries a `setupPrompt` because a fulfilment-only
operator that never bills storage can decline it; the other two are `required`.

### Value stream — the Receive & Store stage

The custody loop needs a stage the six-stage backbone does not have. Mirroring
how `reservation-and-return` inserts `return-inspect` at order 45, custody
inserts **`receive-store`** at **order 35** — between Qualify & Schedule (the
dock appointment) and Deliver the Value (the pick/pack/despatch). Goods arrive
and come to rest *before* the outbound work happens, which is precisely the
ordering that distinguishes custody from movement.

Category defaults: commercial model `account-based-fees` (contract accounts on
a rate card), demand `steady` (contract volume, not seasonal retail peaks),
capacity `custodial-space` — a new `CapacityUnitType` for pallet positions /
cube, honest in a way neither `durable-stock` (that is stock you own) nor
`physical-hard-cap` (that is seats) would be.

### Twin — the DOCK template

A thirteenth twin template, `DOCK`: zones for inbound dock, put-away/racking,
pick faces, pack & despatch; the countable resource is the **dock door**; the
work item is the **shipment**; queues are inbound appointments and outbound
waves; the cog is `wave-and-picker` on signals `workload`, `availability`, and
`deadline` (the carrier cut-off). `capacityZoneKey` is `racking` — the racking
holds the countable capacity, not the dock apron.

`STORE` was rejected as a fit: it models a sales floor with POS lanes and a back
room, and its cog is `restock-and-pick` against stock the business owns.

### Freight brokerage

Added as a **leaf on the existing `moving-and-logistics` category**, not a new
one. It belongs to the movement core, and reusing the category is what the
verify-substrate-first discipline calls for. Its distinctive traits — no
custody, no vehicle, margin-on-load revenue, and FMCSA broker authority plus a
$75,000 surety bond — are captured in the leaf's items, form schema, and
`sales-assisted` consumption channel rather than in new substrate. It declares
`fieldDispatch: { enabled: false }` because a broker dispatches *other people's*
trucks and has no fleet of its own to route.

## Leaves shipped

`warehousing-fulfilment`:
- `third-party-logistics` — 3PL Contract Warehousing (inquiry / quote)
- `ecommerce-fulfilment` — E-Commerce Fulfilment Centre (inquiry / quote)
- `cold-chain-storage` — Cold & Temperature-Controlled Storage (inquiry / quote)
- `cross-dock-transload` — Cross-Dock & Transload (inquiry / quote)

`moving-and-logistics` (extended):
- `freight-brokerage` — Freight Brokerage & Forwarding (inquiry)

## Touchpoints wired

**Required (compile / test gates):**
- `packages/storefront-templates/src/types.ts` — `ArchetypeCategory` union +
  `ProvisioningModel` value.
- `packages/storefront-templates/src/activation-profile.ts` —
  `PROVISIONING_VALUES` set.
- `packages/storefront-templates/src/archetypes/index.ts` — register the module.
- `packages/storefront-templates/src/capability-registry.ts` — the triad.
- `packages/storefront-templates/src/applicability-rules.ts` — the gating rule.
- `apps/web/lib/storefront/industries.ts` (+ `industries.test.ts`, 21 → 22).
- `packages/db/src/wiki-taxonomy.ts` — `PROFESSION_ARCHETYPES` (enforced to
  equal the categories present in `ALL_ARCHETYPES`).

**Populated for correct runtime/UX (graceful-default otherwise):**
- `operational-value-stream.ts` — the `receive-store` stage, `custodial-space`
  capacity unit, and category defaults.
- `twin-profile.ts` — the `DOCK` template and its selection rule.
- `field-dispatch.ts` — custody excluded from dispatch derivation.
- `packages/finance-templates/src/profiles.ts` +
  `apps/web/lib/finance/setup-profile.ts` — a `warehousing_fulfilment` profile
  with a storage/handling-split chart of accounts.
- `apps/web/lib/storefront/archetype-vocabulary.ts` — category vocabulary.
- `apps/web/lib/tak/marketing-playbooks.ts`,
  `apps/web/lib/onboarding/archetype-business-context.ts`,
  `apps/web/lib/workspace-home/profiles.ts`,
  `packages/storefront-templates/src/demo-flavor.ts`.

## Deliberately out of scope

Real WMS execution depth — slotting algorithms, cartonisation, wave planning,
carrier rate shopping, EDI 940/945 transaction handling, and EPCIS event
capture — is capability-layer implementation, not archetype-template concern.
The archetype declares that these capabilities *apply*; building them is
downstream work. SCOR metric codes are recorded here as the citable KPI
identifiers to adopt when the metric layer is built, not seeded in this change.
