# Platform substrate boundaries and budgets

This contract makes platform simplification measurable. It belongs to [EP-PLATFORM-SUBSTRATE-CONVERGENCE and BI-PSC-001](../superpowers/plans/2026-07-17-platform-substrate-convergence.md#bi-psc-001--baseline-topology-and-complexity-budgets), whose design and implementation sequence live in the [convergence design](../superpowers/specs/2026-07-17-platform-substrate-convergence-design.md) and [measurement-ratchet plan](../superpowers/plans/2026-07-17-platform-substrate-measurement-ratchets.md). This page explains how to use those controls; it does not duplicate their measured values.

## Boundary inventory

The versioned [substrate manifest](../../scripts/platform-substrate-manifest.json) is the source of truth for physical topology facts. Its version 2 `capability` values are stable `runtime:*` join keys, not capability definitions or enabled state. Every Compose service is exactly one of:

- `universal-core`: a continuously running service required by every supported product installation.
- `ephemeral-lifecycle`: a first-party service that runs for a bounded initialization, sandbox, promotion, or other lifecycle operation rather than as an always-on boundary.
- `capability-activated`: a service whose lifecycle follows an explicitly enabled platform capability; `defaultRequired` and profiles record its current activation behavior separately from its class.
- `test-development-only`: a harness or development service that is not part of the production runtime contract.
- `separate-distribution`: an integration distributed and operated as a separate product boundary rather than absorbed into the universal portal runtime.

External provider runtimes are listed separately and do not form a sixth Compose class, because provider configuration is not a container lifecycle. The manifest records activation, data ownership, health semantics, supported hosts, and the intended target classification for each boundary.

## Split authority and transitions

Runtime capability definitions are deployed from [the checked-in seed](../../packages/db/data/platform-runtime-capabilities.json). Sync merges their definition metadata into `PlatformCapability.manifest.runtime`; after bootstrap, that PostgreSQL manifest is the product-capability authority. Existing `PlatformCapability.state` values are operator-controlled and sync never resets them. The substrate manifest separately owns service names, profiles, ports, volumes, backup policy, health semantics, host support, and boundary classification. It never owns capability dependencies or enabled state.

The stable `runtime:*` key is the only join between these authorities. Missing capabilities, unknown services, or duplicate service bindings fail closed. The generated `CapabilityServiceProjection` is the sole operational input for install, upgrade, health, backup, and diagnostics; those consumers must not recreate service lists. The complete authority flow, host-aware profiles, transition semantics, compatibility migration, backups, and health states are documented in [Capability-driven runtime profiles](capability-driven-runtime-profiles.md).

Capability state follows the convergence design's governed lifecycle: dependency resolution precedes enablement; disablement drains or cancels attributed work before services stop; upgrades preserve the enabled set; rollback restores the prior snapshot. Health reports desired plus observed state but cannot initiate a transition. The compiler, persisted hashes, signed transition saga, host reconciliation, and startup recovery now implement that boundary.

A separate runtime needs a concrete boundary reason: independent lifecycle or scaling, failure or security isolation, a distinct protocol, host/hardware affinity, external distribution, or development-only tooling. “It already exists” and “the image is convenient” are not reasons. A boundary without a continuing reason should be hybridized into an existing owner or removed, with its data ownership, backup, health, rollback, and compatibility obligations handled first.

## Evidence and ratchets

Static evidence comes from repository sources and can run without a deployed portal. The committed [static baseline](../../scripts/platform-substrate-baseline.json) contains the comparison policy and values. Both `pnpm measure:substrate` (machine-readable measurements) and `pnpm check:substrate` (the guard) use the authoritative shared [static measurement CLI](../../scripts/measure-platform-substrate.mjs).

Runtime evidence comes only from the canonical `local-integration-ci` environment under an active governed lease. The runtime collector is [measure-platform-substrate-runtime.mjs](../../scripts/measure-platform-substrate-runtime.mjs) and its measured contract is the [runtime baseline](../../scripts/platform-substrate-runtime-baseline.json). The collector verifies the lease against the coordination plane, reads the served identity from the portal, and takes two samples under the same lease, host profile, manifest version, and served identity. Non-increasing runtime budgets use the higher sample, and a numeric pair whose variance exceeds five percent is rejected rather than normalized into a misleading baseline. Discrete service and health counts remain exact ratchets; RSS checks use the same five-percent envelope so ordinary allocator noise cannot make a freshly collected baseline fail immediately, while larger growth remains a regression.

Every metric carries its own explicit direction:

- `non-increasing` is a ratchet. An increase beyond the metric's declared noise envelope fails; equality passes; a decrease passes with a stale-baseline advisory so the lower budget can be deliberately recorded. Static metrics and discrete runtime counts have no tolerance; runtime RSS has a five-percent tolerance.
- `informational` records context and never fails merely because its value changes.

Directions are data, not naming conventions. New metrics must declare one of these policies in the measurement implementation and baseline. Reviewers must not infer policy from a metric name.

Static and runtime evidence answer different questions. Static counts expose architectural surface area and coupling; runtime samples expose the actually served topology, health, and idle resource footprint. Neither substitutes for product behavior, recovery, data durability, or canonical build and UX evidence.

## Update and check procedure

1. Change the source architecture and, when boundaries change, update the [manifest](../../scripts/platform-substrate-manifest.json) in the same concern.
2. Run `pnpm check:substrate`. Investigate any increase; do not refresh the baseline merely to silence the guard.
3. For an intentional, reviewed budget change or a confirmed decrease, run `pnpm measure:substrate -- --update`, inspect the baseline diff and provenance, then run `pnpm check:substrate` again.
4. For runtime budgets, claim the `local-integration-ci` lease, deploy or verify the intended served identity through the governed path, and invoke `pnpm measure:substrate:runtime --` with the portal URL, lease ID, environment key, and owner session ID. Use `--update` only after the two-sample stability and identity checks pass. Then run the corresponding runtime check under the same governed conditions.
5. Commit generated baselines with the architecture change and record canonical evidence against the backlog item. Never hand-edit a measured value or remove provenance.

The static CLI auto-discovers the repository root; path overrides are test and controlled-tooling interfaces. The runtime CLI is fail-closed when the lease, served identity, health response, Compose inventory, or samples cannot be verified.

## Scope and exclusions

The static budget covers manifest-classified Compose services, default-required services, direct Inngest imports, integration connect routes, provider connection-state projectors, Prisma model count, schema/coordinator line context, and production module hotspots according to the shared module-size scope. Generated output, dependencies, build artifacts, fixtures excluded by that shared scope, transitive imports, and vendor-internal implementation details are not counted.

Runtime measurement covers manifest services visible to the leased Compose project, required-service health, optional-service state, portal and aggregate idle container memory, and served identity. It is not a load test, throughput benchmark, capacity forecast, backup restore, failover exercise, or proof that an optional capability works. Host-to-host comparisons require the recorded host profile; a change of profile is not a stable sample pair.

## Completion evidence

Runtime evidence remains incomplete until a canonical baseline is checked in and its guard passes under the governed conditions above. Source review or a partially completed canonical gate cannot substitute for that evidence, and must not be reported as a passing runtime budget.

Transient status, run counts, and blocker state belong in [Task 7 of the measurement plan](../superpowers/plans/2026-07-17-platform-substrate-measurement-ratchets.md#task-7-verify-publish-and-close-bi-psc-001), canonical execution-evidence records, and the live backlog—not in this durable contract. Consult the live `BI-PSC-001` and related blocker records for the current state.

## What success means

Fewer containers are useful only when the platform also has fewer independent lifecycle, failure, upgrade, backup, health, and operational contracts. Moving work into the portal can reduce a container count while increasing coupling, memory, blast radius, or recovery risk. Conversely, a retained boundary can be correct when it provides measurable isolation or platform portability. Success is a lower total operating burden with preserved capability, data authority, recovery, security, performance, and user experience—not a container tally in isolation.
