# Hardware Asset Intelligence Phase D - model lifecycle hints before native HAM

**Date:** 2026-07-17
**Status:** Draft - spec + backlog decomposition only; founder sign-off required before build
**Epic:** EP-ASSET-INTELLIGENCE
**Parent roadmap BI:** BI-3D1DBFBE - HAM hardware lifecycle & financials
**Build boundary:** Full request -> procure -> deploy -> retire -> dispose HAM, warranty operations, depreciation policy, and refresh forecasting remain explicitly deferred as their own initiative.
**Builds on:** [2026-07-16 software & asset intelligence enrichment design](2026-07-16-software-asset-intelligence-enrichment-design.md)
**Kernel decision:** DI-83E8F4EC073D - choose `catalog-hints-only` first (high confidence, margin 0.539)

## 1. Executive Decision

Phase D should not start by building a full native Hardware Asset Management system. The first buildable slice is **hardware asset intelligence**: normalize commodity hardware models into the existing `CatalogIdentity(part='h')` spine, enrich those identities with open model/EOL/firmware hints, and surface support/firmware posture on existing estate inventory.

This gives DPF useful HAM-adjacent intelligence without prematurely creating a second asset register or collapsing IT discovery, customer configuration items, and finance fixed assets into one overlarge model. It also honors the CEO continuity note: hardware is mostly commodity and safely shareable, so the existing hive-contribution egress boundary should be reused.

## 2. Substrate Verification

Candidate nouns checked: hardware catalog identity, lifecycle milestones, hardware inventory record, customer equipment/CI, fixed asset/depreciation, procurement, warranty, refresh forecasting, hive contribution.

| Substrate | Existing record | Verdict |
| --- | --- | --- |
| Hardware model identity | `CatalogIdentity` already has `part` with `h` for hardware and an indexed `cpe` field (`packages/db/prisma/schema.prisma:4441`). | Reuse. No new hardware catalog table. |
| Hardware lifecycle milestones | `CatalogLifecycleMilestone` is already tied to `CatalogIdentity` and can hold `release`, `eol`, `eosl`, `security_updates_end` style milestones (`schema.prisma:4476`). | Reuse for hardware EOL/EOSL. Add sources, not tables. |
| Resolution lineage | `IdentityResolutionLog` and `DiscoveryFingerprintRule.catalogIdentityId` already capture identity provenance (`schema.prisma:4497`, `4576`). | Reuse. |
| Discovered estate device | `InventoryEntity` already carries `manufacturer`, `productModel`, version fields, `supportStatus`, `catalogIdentityId`, `updatePosture`, `latestKnownVersion`, and lifecycle source/confidence fields (`schema.prisma:4646`). | Reuse as the operational discovered-device anchor. |
| Customer equipment / CI | `CustomerConfigurationItem` already has manufacturer/vendor/product/model/serial/assetTag, install/purchase/warranty/end-of-sale/support/life dates, lifecycle evidence, and unit cost/price fields (`schema.prisma:3173`). | Reuse for customer/site equipment; do not invent `EquipmentRecord`. |
| Finance asset register | `FixedAsset` already covers asset ID, category, purchase date/cost, depreciation method, useful life, book value, accumulated depreciation, disposal, location, assignee, serial number (`schema.prisma:10656`). `apps/web/lib/actions/assets.ts` already calculates straight-line/reducing-balance depreciation and posts depreciation to GL best-effort. | Reuse later. Do not fold into Phase D intelligence slice. |
| Supplier/procurement | `Supplier`, `PurchaseOrder`, and `PurchaseOrderLineItem` exist (`schema.prisma:10097`, `10355`, `10381`) but PO lines are still free text and fixed assets have no supplier/PO FK. | Existing finance/procurement substrate is adjacent but incomplete. Full HAM workflow remains BI-3D1DBFBE. |
| Hive sharing | `packages/db/src/device-fingerprint-contribution.ts` already builds redacted, opt-in fingerprint contributions and fail-closes on sensitive evidence. | Reuse this egress boundary for commodity hardware fingerprints. |
| Open backlog overlap | `EP-ASSET-INTELLIGENCE` is open; `BI-3D1DBFBE` is the xlarge HAM roadmap item; no related open GitHub PR found in the current sweep. | Decompose under the existing epic; do not create a new epic. |

## 3. Reference Model Research

ServiceNow HAM is the main reference model because it expresses both the operational lifecycle and the content-service model DPF is intentionally not cloning.

- ServiceNow positions HAM as lifecycle automation from procurement to retirement, with CMDB as the single source of truth and hardware normalization as a first-class capability. [ServiceNow HAM product page](https://www.servicenow.com/products/hardware-asset-management.html)
- The standard hardware request flow covers requesting, sourcing, procuring, and deploying hardware catalog items; asset details are updated as the flow progresses. [Standard Hardware Asset Request flow](https://www.servicenow.com/docs/r/it-asset-management/hardware-asset-management/hardware-request-flow.html)
- Hardware model lifecycle is model-level content: calculated lifecycle templates can be associated with hardware models. [Calculated lifecycle templates](https://www.servicenow.com/docs/r/it-asset-management/hardware-asset-management/manage-ham-lifecycle-temp.html)
- ServiceNow's HAM Content lookup exposes hardware manufacturers, products, models, and lifecycle definitions in its content library. [Content lookup portal](https://www.servicenow.com/docs/r/it-asset-management/hardware-asset-management/content-lookup-ham.html)
- Hardware asset refresh is a distinct workflow that selects aged assets and replacement models; this is a workflow layer, not merely a catalog feed. [Hardware Asset Refresh](https://www.servicenow.com/docs/r/it-asset-management/hardware-asset-management/hardware-asset-refresh.html)
- Asset financial fields include retirement/disposal data, depreciation method, salvage value, lease/warranty expiration, and contract fields. [Asset record fields](https://www.servicenow.com/docs/r/it-asset-management/hardware-asset-management/asset-record-fields.html)
- Warranty in ServiceNow can be vendor-fed. The Lenovo flow batches serial numbers, calls the Lenovo Warranty API, and stores records in `sn_itam_common_asset_warranty`. [Lenovo warranty integration](https://www.servicenow.com/docs/r/it-asset-management/hardware-asset-management/integration-with-lenovo-asset-warranty.html)
- CSDM's tangible/physical lifecycle applies to hardware-related Asset Management and CMDB tables. [Tangible/physical lifecycle](https://www.servicenow.com/docs/r/servicenow-platform/common-service-data-model-csdm/csdm-lifecycle-hardware.html)
- Depreciation is a hardware/facility asset concern and can be calculated on a schedule. [Add depreciation to an asset](https://www.servicenow.com/docs/r/it-asset-management/asset-management/t_AddingDepreciationToAnAsset.html)

Open feed research:

- LVFS/fwupd metadata is device/firmware matching data, not a HAM financial catalog. fwupd creates device IDs and GUIDs, and update metadata GUIDs match firmware to devices. [LVFS introduction](https://lvfs.readthedocs.io/en/latest/intro.html)
- LVFS `.metainfo.xml` describes device and firmware metadata supplied by the OEM/ODM. [LVFS metadata](https://lvfs.readthedocs.io/en/latest/metainfo.html)
- endoflife.date supports hardware semantics: `discontinued` is used for physical devices no longer sold or manufactured, while `eol` indicates end of support for the device version. [endoflife.date contributing guide](https://endoflife.date/contribute)
- Wikidata has `discontinuation date` (P2669), useful as a low-confidence public backfill when model-specific vendor or endoflife.date data is absent. [Wikidata property report](https://www.wikidata.org/wiki/Wikidata%3ADatabase_reports/List_of_properties/all)

## 4. Design Options Considered

### Option A - Catalog hints only

Reuse `CatalogIdentity(part='h')`, `CatalogLifecycleMilestone`, `DiscoveryFingerprintRule`, `IdentityResolutionLog`, and `InventoryEntity` enrichment fields. Add feed adapters and UI/read-model hints only.

Wins: fastest useful path, strongest schema grounding, safest blast radius, naturally shareable through the existing hive boundary.

Loses: does not solve warranty claims, depreciation policy, procurement, refresh orders, or asset disposal.

### Option B - Link existing asset records

Add a connector/read-model layer across `InventoryEntity`, `CustomerConfigurationItem`, and `FixedAsset` so the same physical device can be reasoned about across discovery, customer equipment, and finance asset register records.

Wins: closer to HAM; unlocks richer customer/site and finance views.

Loses: higher schema blast radius and more identity-resolution ambiguity. Needs data-steward sign-off before build.

### Option C - Full native HAM now

Build request, procure, receive, stock, deploy, maintain, refresh, retire, dispose, warranty, depreciation, and forecasting workflow tables now.

Wins: complete HAM parity.

Loses: violates the explicit deferral, duplicates existing finance/procurement substrate, and risks creating a second asset register before the identity spine is fully exploited.

### Kernel result

`principle_decide` recommended **Option A - Catalog hints only** with high confidence. The top useful signal was the same pattern as prior asset-intelligence work: reuse the existing spine, verify live substrate first, and keep the blast radius small while the system proves its data quality.

Founder sign-off requested:

1. Approve Option A as Phase D1.
2. Keep Option B as Phase D2, gated by data-steward review.
3. Keep Option C inside BI-3D1DBFBE as a separate future initiative.

## 5. Target Architecture

### 5.1 Data authority

`CatalogIdentity(part='h')` is the model identity: Dell PowerEdge R750, Lenovo ThinkPad X1 Carbon Gen 11, Fortinet FortiGate 60F, Raspberry Pi 5, etc.

`InventoryEntity` is the observed estate instance: a discovered device, host, appliance, endpoint, switch, printer, sensor, or similar physical/firmware-bearing asset.

`CustomerConfigurationItem` is the customer/site equipment record when the asset is managed as customer equipment.

`FixedAsset` is the finance asset register entry when the asset is capitalized and depreciated.

Phase D1 only writes model identity and model lifecycle/firmware hints. It may read `CustomerConfigurationItem` and `FixedAsset` for context, but it does not redefine their authority.

### 5.2 Feed composition

Hardware enrichment runs as another stage of the existing catalog-enrichment sweep:

1. Select `CatalogIdentity` rows where `part='h'`, ordered by least-recently enriched.
2. Resolve public model hints:
   - LVFS/fwupd: firmware/device metadata and version/update availability hints.
   - endoflife.date hardware pages: `discontinued` -> end-of-sale/manufacturing milestone; `eol` -> end-of-support milestone.
   - Wikidata: manufacturer/model/discontinuation/public identifiers as low-confidence backfill.
3. Upsert `CatalogLifecycleMilestone` rows with source-specific confidence:
   - `release`
   - `end_of_sale`
   - `end_of_manufacture`
   - `eol`
   - `eosl`
   - `firmware_security_updates_end` when a source supports it
4. Preserve source provenance in `notes` or a later evidence sidecar; do not flatten multiple sources into one date.
5. Project summarized posture to `InventoryEntity.supportStatus`, `supportLifecycleSource`, `supportLifecycleConfidence`, `latestKnownVersion`, and `updatePosture` only when the entity is resolved to the hardware identity and confidence is sufficient.

### 5.3 Sharing boundary

Commodity hardware model knowledge is shareable by default only after redaction and opt-in:

- Shareable: model fingerprint rule, manufacturer/product/model mapping, public lifecycle milestone, public firmware metadata, taxonomy placement.
- Local-only: serial number, MAC/IP/hostname, customer/site, purchase cost, warranty contract, assignee, location, installed relationship, and any organization-specific lifecycle override.

The existing `buildFingerprintContribution` path is the outbound boundary. Phase D should extend the payload shape only if needed; it must not create a second hive egress mechanism.

## 6. Phased Backlog Decomposition

### Phase D0 - Founder sign-off and BI split

Outcome: this spec is reviewed, the Phase D1 boundary is approved or revised, and build BIs are accepted under `EP-ASSET-INTELLIGENCE`.

### Phase D1 - Hardware model intelligence

Proposed BIs:

1. **BI-84710E60 - Hardware open-feed adapters for CatalogIdentity(part='h')** - ingest LVFS/fwupd, endoflife.date hardware, and Wikidata model hints into `CatalogLifecycleMilestone`; bounded weekly sweep; source/confidence preserved. **endoflife.date hardware + Wikidata LANDED** (`packages/db/src/hardware-lifecycle.ts`): `hardwareReleaseToMilestones` (discontinued→`end_of_sale`, eol→`eol`, eoes→`eosl`) at 0.9 confidence; `fetchWikidataDiscontinuation` (P2669) as a 0.4-confidence `end_of_sale` backfill; per-source milestone rows are never flattened. The catalog sweep now routes `part='h'` identities to `enrichHardwareIdentity` instead of the software release mapping (`wikidataFetch` added to the sweep fetchers + runner). Closed hardware-milestone vocabulary (`HARDWARE_MILESTONES`) lives next to the mapper. **LVFS/fwupd firmware slice LANDED** (`packages/db/src/lvfs-firmware.ts`): `parseLvfsAppstream` extracts firmware components (name / developer / provided device GUIDs / newest-dated release) from the LVFS AppStream catalog; `resolveLatestFirmware` matches a hardware identity by device GUID (when discovery carries one) else by normalized manufacturer/model name, yielding the latest firmware version. The sweep loads the catalog **once per run** (only when the batch has a `part='h'` identity), and projects `latestKnownVersion` onto the model's `InventoryEntity` instances; transport (fetch + gunzip) is a `lvfsFetch` thunk in the runner (`LVFS_CATALOG_URL`, mirror-friendly). **Substrate follow-ups:** discovery collects firmware *version* but not device *GUIDs*, so the match is currently name-based — a firmware-GUID collector will raise the match rate; per-entity `updatePosture` (observed-vs-latest firmware) and a `firmware_security_updates_end` milestone (LVFS rarely carries end-of-support dates) are the remaining follow-ups.
2. **BI-4731303B - Hardware identity projection onto InventoryEntity** - use existing fingerprint/resolution logic to resolve discovered hardware entities to `CatalogIdentity(part='h')`; project support/firmware posture to existing enrichment fields. **Support-posture projection LANDED** (`packages/db/src/support-posture.ts`): `deriveSupportPostureFromMilestones` turns a resolved identity's `CatalogLifecycleMilestone` `eol` date into `supportStatus` (`expired` / `approaching_end` within 180d / `supported`) + `supportLifecycleSource` + `supportLifecycleConfidence`, highest-confidence eol source winning. The catalog sweep now `updateMany`s these onto every `InventoryEntity` resolved to a hardware identity — replacing the manufacturer/version heuristic with feed-grounded evidence; a model with no `eol` milestone leaves the existing status untouched. (Identity resolution itself already lands via the fingerprint pipeline's `catalogIdentityId` write.) Firmware-version posture (`latestKnownVersion` / `updatePosture`) follows the LVFS slice.
3. **BI-8577DA8F - Hardware hive contribution reuse** - extend or document the existing device-fingerprint contribution path for commodity hardware model rules; enforce the same redaction and opt-in boundary. **DONE (reuse confirmed, no egress change):** commodity hardware model rules flow through the existing `buildFingerprintContribution`/`decideInboundActivation` path unchanged — the §5.3 shareable manufacturer/product/model mapping already rides `resolvedIdentity` (`kind='hardware'`, `model`), so **no payload extension was needed** (spec §5.3 "extend only if needed") and **no second egress mechanism** was created. `device-fingerprint-contribution.test.ts` adds commodity-hardware coverage: a Dell PowerEdge model rule contributes opt-in-gated, an embedded MAC is redacted, a secret-like token aborts fail-closed, and an inbound hardware rule activates only `local` after the install's own fixtures pass. Serial / MAC / hostname / customer-site literals never egress — the same redaction gate protects hardware rules.
4. **BI-9281CB8A - Hardware support posture UI/read model** - surface model identity, EOL/EOSL, discontinued/end-of-sale, and firmware availability hints on the inventory entity detail page and relevant estate posture summaries using report-kit primitives.

### Phase D2 - Existing-record bridge, gated

Proposed BIs after D1 evidence:

5. **BI-828998DC - InventoryEntity <-> CustomerConfigurationItem bridge** - define matching rules and read-model joins for customer/site equipment records without moving authority.
6. **BI-1093AF1C - InventoryEntity <-> FixedAsset bridge** - define optional serial/assetTag/catalogIdentity matching and origin trace fields needed before any finance-facing HAM automation.

### Deferred initiative - Full HAM financial lifecycle

`BI-3D1DBFBE` remains the parent xlarge initiative for:

- Request/catalog item -> source/procure -> receive/stockroom -> deploy/assign -> maintain/repair -> refresh -> retire -> dispose.
- Warranty records/claims and vendor-specific warranty APIs.
- Depreciation policy, asset capitalization, useful-life assumptions, disposal gain/loss, and GL posting refinements.
- Refresh forecasting based on lifecycle, warranty, utilization, book value, criticality, and replacement standards.

This deferred initiative needs its own spec and data-steward review because it crosses finance, procurement, discovery, customer-site equipment, and CSDM lifecycle authorities.

## 7. Data Model Notes

No new table is required for Phase D1. The likely code changes are:

- Extend the catalog enrichment sweep with a `part='h'` hardware stage.
- Add source adapters under `packages/db/src/` for LVFS/fwupd metadata parsing, endoflife.date hardware mapping, and Wikidata public model hints.
- Add tests for milestone mapping, confidence precedence, and no-private-field contribution.
- Reuse `InventoryEntity.catalogIdentityId` and enrichment columns.
- Reuse `CatalogLifecycleMilestone` with additional milestone names, but keep names closed in code near the mapper so drift is testable.

Data-steward flag: if D2 adds bridges, prefer nullable FKs or a read-model join first. Do not merge `InventoryEntity`, `CustomerConfigurationItem`, and `FixedAsset`; they answer different authority questions.

## 8. Verification Plan

When build begins:

- Unit tests for each feed mapper:
  - LVFS metadata -> firmware/model hint.
  - endoflife.date hardware `discontinued` vs `eol` -> distinct milestones.
  - Wikidata `discontinuation date` -> low-confidence milestone.
- Catalog sweep tests proving hardware identities rotate under bounded poll limits and do not affect software identities.
- Redaction tests proving serial, MAC, hostname, IP, customer/site, purchase, warranty, and assignee fields do not egress.
- Inventory projection tests for confidence precedence and human-confirmed identity precedence.
- UI tests for inventory entity posture display if Phase D1.4 lands.
- Production build and UX verification per AGENTS.md before any PR is opened.

## 9. Open Questions For Founder Sign-Off

1. Is Option A approved as the first Phase D build boundary?
2. Should D1.4 surface hardware posture only on inventory entity detail first, or also on `/ops/patches` and estate rollups in the same slice?
3. Should D2 bridge `CustomerConfigurationItem` before `FixedAsset`, or should the finance bridge wait for the full HAM initiative?
4. Are commodity hardware fingerprint contributions default-on under the existing opt-in, or should hardware model sharing get its own explicit toggle?
5. Should BI-3D1DBFBE stay as one xlarge parent, or should it be split into separate future epics for procurement lifecycle, warranty, finance/depreciation, and refresh forecasting?

## 10. Non-Goals

- No full HAM workflow in Phase D1.
- No new asset register.
- No ServiceNow/Flexera proprietary catalog cloning.
- No warranty claim workflow.
- No depreciation policy change.
- No procurement or stockroom workflow.
- No automatic firmware remediation; any future action goes through governed `RemoteAction`.
