# Local-CI Builder Slot Sizing

This document describes the memory sizing for local-CI builder slots and the
in-slot concurrency remedy for builder resource exhaustion.

## Status: `blocked_builder_resource_exhausted`

When a build exits with `blocked_builder_resource_exhausted`, the builder itself
ran out of memory inside its own cap. The shared control plane (portal, MCP,
Docker, PostgreSQL) stayed healthy throughout — this is build capacity, not
infrastructure degradation.

## Host Sizing Rationale

The default configuration targets a **64 GiB developer host** running two
concurrent local-CI slots. The memory budget breaks down as follows:

| Component              | Per-slot | × Slots | Total    |
|------------------------|----------|---------|----------|
| Builder container      | 16 GiB   | 2       | 32 GiB   |
| Host-stage processes   |  8 GiB   | 2       | 16 GiB   |
| **Slot subtotal**      | 24 GiB   | 2       | **48 GiB** |
| OS / control plane     | —        | —       | 16 GiB   |
| **Host total**         |          |         | **64 GiB** |

The 16 GiB builder cap per slot is defined in
[`local-ci-slot-resources.json`](local-ci-slot-resources.json):

- `builderPolicy.memoryBytes`: 17179869184 (16 GiB)
- `hostStagePolicy.memoryBytes`: 8589934592 (8 GiB)

### Why builds must not serialize across slots

When a builder exhausts its memory cap, the correct remedy is **bounding worker
count inside the affected slot**, not serializing builds across slots. Rationale:

1. **Throughput**: Two 16 GiB slots each running 2 workers finish two builds in
   parallel. Serializing to one 32 GiB slot running 4 workers doubles latency
   while only marginally improving reliability.

2. **Isolation**: Slot isolation means one build failure cannot starve another.
   Serializing removes this guarantee.

3. **Diagnosis**: Per-slot caps make exhaustion reproducible and debuggable.
   A shared pool hides which build actually caused the pressure.

4. **Recovery semantics**: `blocked_builder_resource_exhausted` maps to
   `await-governed-runner`, not `retry-immediately`. If the remedy were
   serialization, the status would need different recovery logic.

## Default Slot Sizing

Each local-CI builder slot is provisioned with:

- **Memory cap**: 16 GiB (`DPF_LOCAL_CI_BUILDER_MEMORY_BYTES = 17179869184`)
- **CPU quota**: 800,000 / 100,000 period (8 CPUs worth)
- **Max parallelism**: 4 (BuildKit parallel jobs)

## Next.js Build Worker Concurrency

The Next.js production build spawns multiple workers for static page generation.
The worker count is reported in the build log:

```
Collecting page data using 11 workers ...
```

When the combined worker memory exceeds the builder's cap, the kernel OOM-kills
the build, producing one of these signatures:

- `ResourceExhausted`
- `cannot allocate memory`
- `SIGKILL (Forced termination): next build`

## In-Slot Concurrency Remedy

To reduce memory pressure within a single slot:

1. **Reduce Next.js workers**: The build reads the builder memory cap and
   computes a worker budget via `apps/web/build-memory-budget.mjs`. The cap is
   read from environment variables in priority order:
   - `CGROUP_MEMORY_LIMIT_BYTES` — kernel/container cgroup limit
   - `DPF_LOCAL_CI_BUILDER_MEMORY_BYTES` — bounded-build runner's slot cap
   - Falls back to `totalmem()` and `process.constrainedMemory()` when neither
     is set (may read host memory on misconfigured containers)
   
   A 16 GiB cap with 8 GiB per worker yields 2 workers max.

2. **Reduce BuildKit parallelism**: Lower `DPF_LOCAL_CI_BUILDER_MAX_PARALLELISM`
   to limit concurrent build stages. Default is 4.

3. **Increase slot memory**: Raise `DPF_LOCAL_CI_BUILDER_MEMORY_BYTES` and the
   policy version so the builder is recreated with the new limit.

## Diagnosing Exhaustion

When `blocked_builder_resource_exhausted` occurs, the gate record includes:

- `observedWorkers`: how many workers the build reported spawning
- `killedStep`: which build step was killed (e.g., `next build`)
- `policy.memoryBytes`: the builder's memory cap
- `builderMemory.peakBytes`: observed peak memory usage

Divide the cap by the worker count to estimate per-worker budget. If the budget
is under ~1.5 GiB per worker, memory pressure is likely.

## Recovery

Builder resource exhaustion is infrastructure evidence, not a product failure.
The autonomous recovery policy maps it to `await-governed-runner`: wait for
the runner to be available with more capacity, then retry. No code change is
needed unless the build legitimately requires more memory than allocated.
