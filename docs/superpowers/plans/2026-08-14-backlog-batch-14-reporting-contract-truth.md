# Batch 14: Reporting-Contract Truth Reconciliation

**Goal:** Resolve ten related reference findings through the existing canonical reporting and data-stewardship surfaces. The change tightens those owners where the findings exposed real omissions; it does not create the proposed parallel adapter-pattern documents.

**Work capsule:** `WC-16A3C9FC`

**Coverage receipt:** `cmstm1pjc05an01nzoqpoeroy`

## Validity decision

The ten live findings all concern one architectural boundary: providers normalize source facts, canonical identity owns joins, a shared read model owns cross-source aggregation, and partial sources remain visible. The published reporting principle already owns most of that rule and the data-stewardship runbook already owns typed JSON access. The valid remainder is a concise augmentation covering provider-id normalization, adapter maturity, typed no-result/partial semantics, and observable recovery. Creating the several proposed `adapter-patterns.md` variants would duplicate these owners.

| Backlog item | Disposition | Canonical outcome |
| --- | --- | --- |
| `BI-IMP-4E90F3E5` | augment existing owner | Provider publication/thread/conversation ids must resolve through the owning domain's canonical mapping before analytics joins. |
| `BI-IMP-6ABDB691` | augment existing owner | Reporting aggregation stays in the shared read model; expected misses and source failures remain typed and distinct; metadata uses canonical helpers. |
| `BI-IMP-8C20270E` | augment existing owner | Adapters normalize provider payloads into provider-neutral facts and cannot establish incidental metadata join keys. |
| `BI-IMP-8F3CF076` | augment existing owner | Cross-channel KPI views consume one domain read model; routes and provider adapters do not own rollups. |
| `BI-IMP-7B1A426A` | augment existing owner | Canonical joins, partial semantics, source status, and degradation telemetry travel together. |
| `BI-IMP-D578ACD2` | augment existing owner | Publication, asset, inbound reply, and provider-thread relationships use documented canonical mappings rather than inferred IDs. |
| `BI-IMP-B0F50CA6` | augment existing owner | Provider adapters stop at normalized facts; the canonical reporting boundary owns attribution and cross-channel rollups. |
| `BI-IMP-52761525` | verify and clarify existing | The data-stewardship runbook already requires typed accessors and promoted schema fields; it now names provider identity joins explicitly. |
| `BI-IMP-434EE513` | augment existing owner | Capability/maturity plus structured partials make mixed operational and stubbed adapters honest and observable. |
| `BI-IMP-A7CD8B7F` | augment existing owner | A stub reports its status/reason; recovery updates the same capability projection and aggregate contract rather than adding a second path. |

## Supersession boundary

- The channel-capability rule in `docs/architecture/orientation.md` remains the source for supported/unsupported operation signalling.
- `reporting-read-model-boundaries.md` remains the source for normalization, joins, rollups, and partial-result propagation.
- `data-model-stewardship-runbook.md` remains the procedural source for JSON coercion and metadata promotion.
- `BI-IMP-F43C3437`, `BI-IMP-12378AFF`, and `BI-IMP-A66D7856` are excluded because their specific interface, retry, migration, lifecycle, and publish/fetch requirements extend beyond this proven boundary.
- `BI-IMP-8127A9D9` and `BI-IMP-A0AA3515` are excluded because dashboard timeout policy and historical backfill strategy are separate concerns.
- The canonical reporting principle now carries this boundary explicitly, so adjacent interface, retry, backfill, and UI timing concerns remain discoverably unowned by it rather than existing only in this ledger.

## Execution plan

1. Amend the two existing canonical owners with the smallest complete rule clarification.
2. Validate documentation links, kernel metadata, derived artifacts, and the full guard preflight.
3. Obtain an immutable-tree semantic review receipt and exact-tree local-CI evidence.
4. Open one ready PR with the required global seed-fit decision and enter the merge queue.
5. Prepare the next ten-item batch while CI and merge run.
6. After governed deployment, prove the canonical served tree contains this ledger and both clarified owners.
7. Close the ten mapped items with item-specific evidence and complete `WC-16A3C9FC`.

## Verification classification

- **UX:** Not applicable; this batch changes doctrine and its audit ledger, not a rendered interaction.
- **Migration:** Not applicable; no schema or data migration is introduced.
- **Seed fit:** Global default. The published universal principle is intentionally seeded for every install and all three declared consumer types; the runbook remains contributor procedure.
- **Documentation impact:** The canonical owners are updated in place and proposed duplicate documents are explicitly rejected.
