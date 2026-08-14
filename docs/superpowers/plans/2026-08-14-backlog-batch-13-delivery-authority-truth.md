# Batch 13: Delivery-Authority Truth Reconciliation

**Goal:** Reconcile ten live backlog items against the canonical contracts for Work Room standards input, honest provider capability signalling, and reporting read-model ownership. This batch records one evidence ledger rather than creating competing adapter or reporting substrate.

**Work capsule:** `WC-7C605B17`

**Coverage receipt:** `cmstlk9vr046901nzngtblgfe`

**Canonical runtime observed before this batch:** served SHA `1fd37d44489eecdcd8ce530f3213f1473bc17934`.

## Validity decision

The live item bodies were checked against merged Git history, the canonical served tree, and the later AWC delivery. Nine items ask for rules already owned by one of two canonical doctrine surfaces. The remaining AWC item is implemented by PR #4280 but entered `main` after the currently served SHA. Re-implementing any of these requests would create a second source of truth; the correct work is to preserve the evidence and close each item only after its required runtime boundary is proven.

| Backlog item | Validity finding | Canonical evidence | Runtime disposition |
| --- | --- | --- | --- |
| `BI-A988A3C5` | The Work Room findings have already been folded into the AWC standard candidate as normative input. | PR #4280, merge `95a3bb2f6`, adds `2026-08-13-awc-standard-augmentation-room-collaboration.md` with the participant, Coordinator, outcome-scoped membership, A2A context, and engagement model. | Merged after served SHA `1fd37d444`; validate after the governed self-upgrade before closure. |
| `BI-IMP-F6D24EE2` | Unsupported adapter capability/result guidance already has a canonical owner. | `docs/architecture/orientation.md` defines capability flags plus typed or structured unsupported results; `reporting-read-model-boundaries.md` defines structured partial results. | Both doctrine surfaces are present in the served tree. |
| `BI-IMP-3822AD69` | Provider-limited orchestration must use the same explicit capability contract; a provider-specific copy would drift. | Orientation's channel-adapter capability rule, introduced by PR #3841 (`fd8be2bb18`). | Rule commit is represented in served SHA `1fd37d444`. |
| `BI-IMP-E9FE3CB1` | Contract-supported but provider-unavailable operations are exactly the canonical unsupported-operation case. | Orientation requires an `UNSUPPORTED_OPERATION` typed error or a structured `supported: false` result. | Already served; reconcile as superseded by the canonical rule. |
| `BI-IMP-3E67857E` | Capability advertisement plus an honest unsupported stub is already prescribed. | Orientation requires providers to advertise actual support rather than silently accepting interface presence. | Already served; no duplicate implementation is valid. |
| `BI-IMP-106B546D` | `raw.unsupported` limitation signalling is already canonical. | `reporting-read-model-boundaries.md` step 3 names `raw.unsupported` / empty series plus reason and forbids invented zeros. | The principle is present in served SHA `1fd37d444`. |
| `BI-IMP-F74C2946` | Stubbed adapter registration and partial reporting are governed by the same two contracts. | Capability flags own support truth; reporting aggregators return structured partials instead of silent gaps. | Both contracts are already served. |
| `BI-IMP-B8B4A874` | Cross-channel assembly belongs in a domain-owned aggregate read model, not a route-local join. | `reporting-read-model-boundaries.md` defines composed read models, boundary authorization, canonical identity joins, and partial-result contracts. | Principle is present in served SHA `1fd37d444`. |
| `BI-IMP-37FD00DE` | Provider analytics joins belong in adapters/metrics aggregation behind a thin route boundary. | The same principle assigns authorization to the boundary and orchestration/joins to read-oriented domain services. | Already served; a route-local implementation would violate doctrine. |
| `BI-IMP-8032887C` | Cross-channel metrics belong in one shared reporting service/read model rather than repeated route code. | The reporting principle explicitly covers multi-adapter metrics and mixed-source dashboards. | Already served; reconcile without adding a parallel service. |

## Supersession boundary

- The orientation rule is the single source for channel capability truth; this ledger links to it and does not restate it as new doctrine.
- The reporting principle is the single source for aggregate-read-model and partial-result ownership; no provider-specific service is added merely to satisfy duplicate intake wording.
- `BI-IMP-A6A1E780` is excluded because its requested capability-ID constant and naming contract is more specific than the proven generic rule.
- `BI-IMP-A66D7856` is excluded because its publish/fetch contract is not proven complete by the generic capability and reporting doctrine.
- `BI-7BEDF08A` remains open because the stale reasoning-loop drain defect is not proven fixed.

## Execution plan

1. Commit this evidence ledger as the single documentation concern for the ten-item batch.
2. Run documentation validation and the required exact-tree PR gates.
3. Open one ready PR and enter it into the merge queue.
4. Continue preparing the next ten-item batch while CI and the merge queue run.
5. After the queued changes are merged, advance only through the governed self-upgrade path.
6. Confirm the canonical served SHA contains PR #4280 and this ledger, then record fresh runtime evidence.
7. Mark the ten mapped backlog items done with item-specific evidence and complete `WC-7C605B17`.

## Verification classification

- **UX:** The ledger introduces no UI. AWC closure waits for live Work Room verification after PR #4280 is deployed.
- **Migration:** Not applicable; this batch introduces no schema or data migration.
- **Documentation impact:** This ledger is the audit artifact. It preserves pointers to the canonical doctrine and AWC feeder rather than copying their rules.
