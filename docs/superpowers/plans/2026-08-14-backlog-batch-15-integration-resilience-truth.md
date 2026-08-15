# Batch 15 — Integration resilience truth

**Goal:** resolve ten architecture-review follow-ups by strengthening the existing owners for federation standards, connector lifecycle, marketing-channel contracts, data relationships, dashboard degradation, third-party fetches, and historical backfill. Do not create the suggested parallel `adapter-patterns.md`, `channel-adapter-patterns.md`, or generic error framework when the unified connector kernel and existing domain contracts already own those concerns.

**Work Capsule:** `WC-4FE98B60`

**Coverage receipt:** `cmstmh60z008e01t6p6c9u1bl` (`decomposed`; all ten deliverables mapped to live backlog items before implementation).

## Backlog coverage

| Backlog item | Resolution path | Dependency |
|---|---|---|
| `BI-IMP-38549108` | Verify the existing federation specs already provide the standards baseline and make that canonical pointer visible from the architecture orientation. | — |
| `BI-IMP-F5B5EE54` | Apply the data-model stewardship rule at the connector boundary: explicit relations versus typed polymorphic references. | — |
| `BI-IMP-8127A9D9` | Add a multi-source error, empty, partial, timeout, retry, and accessibility contract to the usability owner. | connector failure semantics |
| `BI-IMP-A0AA3515` | Add historical-gap/backfill policy beside incremental sync and reporting authority. | data authority |
| `BI-IMP-F43C3437` | Extend the unified connector kernel rather than create a second channel-adapter architecture document. | data + error contracts |
| `BI-IMP-A66D7856` | Document the real marketing adapter contract and correct stale requested names (`externalId`/`EngagementSnapshot`, not invented `externalThreadId`/`ChannelKpi`). | connector kernel |
| `BI-IMP-0F1B9B4E` | Document layer-specific safe error propagation and RFC 9457 HTTP projection without inventing one universal exception class. | connector kernel + usability |
| `BI-IMP-12378AFF` | Document adapter migration, registry, aggregation ownership, and partial results in the existing kernel. | marketing adapter contract |
| `BI-IMP-537D0796` | Document synchronous/on-demand/background fetch selection, bounded latency, caches, cursoring, and graceful degradation. | connector kernel + usability |
| `BI-IMP-A6A1E780` | Document namespaced capability identifiers, schema validation, duplicate rejection, and registry discovery in the existing kernel. | connector registry |

## Architecture decisions

1. **One connector spine.** `docs/architecture/unified-connector-kernel.md` remains the canonical integration lifecycle and registry owner. Domain adapters may narrow that contract, but may not reproduce credential custody, retries, health, callbacks, or capability discovery.
2. **Normal-form identity.** Stable relationships use explicit foreign keys when the target is known. A polymorphic `sourceType` + `sourceId` pair is allowed only as a documented, indexed reference boundary with a closed source type and centralized resolver; JSON metadata is never a join key.
3. **Bounded work.** User-request fetches have a fixed deadline and never walk an unbounded provider history. Larger work uses cursor-based incremental sync and background jobs. Caches are projections with freshness/provenance, not a competing source of truth.
4. **Truthful partials.** A successful subset is not an all-clear. Read models carry per-source status and freshness, while the UI distinguishes loading, empty, partial, stale, and failed states and announces changes accessibly.
5. **Standards baseline.** Federation discovery follows RFC 6762/6763, with RFC 8766/9665 available for routed registration; pairing uses authenticated key confirmation, and distributed revisions use version vectors/CRDT decisions rather than wall-clock scalar ordering. HTTP APIs project safe failures using RFC 9457 problem details.

## Verification

- Regenerate and check the public-doc index.
- Run documentation links and anchor checks.
- Run diagram and golden-decision guards.
- Run the exact-tree governed pregate and independent semantic review.
- Merge through the queue, advance the canonical runtime, and record fresh served-lineage verification before closing all ten items.

**Documentation impact:** documentation-only architecture contract change. No UI, migration, or runtime behavior changes; live verification proves the merged documentation lineage is served by this instance rather than asserting new feature behavior.
