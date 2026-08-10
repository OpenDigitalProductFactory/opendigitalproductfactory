# BuildKit Session Lifecycle Design

**Date:** 2026-08-10  
**Status:** Implement  
**Backlog:** `BI-C85D1B0A`  
**Epic:** `EP-PLATFORM-SUBSTRATE-CONVERGENCE`  
**Related:** `BI-CE6E2882` (bounded builder), `BI-2731E2BB` / `BI-A53DFC81` (image/disk retention), runtime-artifact janitor (`BI-DBF3F426` / `BI-A55BE432`)

## 1. Goal

Reclaim multi-GiB **idle BuildKit RAM** and bound **build-cache disk growth** on dogfood and contributor hosts **without** forcing full cold monorepo rebuilds on every pregate.

Success looks like:

- After a local-CI / bounded production build finishes, the managed BuildKit **process is stopped** (RAM ≈ 0 for that builder).
- **Disk layer cache is retained** under BuildKit’s own GC budget so the next build is still incremental.
- Only the **current builder policy version** remains; obsolete `vN` builders are removed.
- Existing image-retention and runtime-artifact janitor paths stay the authority for tagged CI images and stray compose projects.

## 2. Problem evidence

Measured 2026-08-10 on a dogfood Windows install:

| Artifact | Observation |
| --- | --- |
| `buildx_buildkit_dpf-local-ci-buildkit-v2-00` | ~2.75 GiB RSS after days idle |
| `dpf-local-ci-buildkit-v1-0` and `v2-0` | **Both** still running (policy zombie) |
| Docker images | ~236 GB |
| Build cache | ~116 GB |
| Product portal | ~1.1 GiB (separate concern) |

`scripts/config/local-ci-buildkitd.toml` previously set only `max-parallelism = 4` — **no GC policy** — so the custom `docker-container` builder did not get Desktop-like `defaultKeepStorage` behavior.

## 3. Market / standards research (summary)

| Precedent | Lesson |
| --- | --- |
| **`docker buildx stop`** ([moby/buildkit#4983](https://github.com/moby/buildkit/issues/4983)) | Official way to shut the daemon **between builds** while keeping builder identity |
| **BuildKit GC in `buildkitd.toml`** ([Docker GC docs](https://docs.docker.com/build/cache/garbage-collection/)) | Ordered policies: stale/easy cache first, then hard size caps (`reservedSpace` / `maxUsedSpace` / `minFreeSpace`) |
| **Docker Desktop docker-driver defaults** | ~`defaultKeepStorage: 20GB` class budgets |
| **Depot** | Gold product split: **ephemeral build compute** vs **durable budgeted cache** (we keep cache local; we do not require Depot) |
| **GitHub Actions** | Ephemeral builders + export cache — wrong default for a **persistent** dogfood host if it means wipe/rebuild every time |
| **Dokku daily prune** | External broom under disk pressure; prefer in-daemon GC + `keep-storage` over unconditional wipe |

**Decision:** Prefer upstream `buildx stop` + in-daemon GC over inventing a second cache store or wiping after every build.

## 4. Architecture

```text
Lease admitted / bounded build starts
  → ensureBoundedBuilder (create if missing; reap obsolete policy versions)
  → builder RUNNING (full memory reservation OK)

Build ends (success or failure)
  → image supersede retention (existing, success-only)
  → buildx stop <current-builder>   # session cool-down; cache stays

Idle / crash backstop (runtime-artifact janitor)
  → stop managed builders still running past grace when no local-CI owner fence
  → buildx rm obsolete policy-version builders

Continuous
  → buildkitd.toml GC keeps cache within budget while builder is up
```

### 4.1 Tier A — Process lifecycle (RAM)

1. **Post-build cool-down (default on):** after `local-ci-bounded-build` finishes, call `docker buildx stop <builder>`.
2. **Escape hatch:** `DPF_LOCAL_CI_BUILDER_KEEP_WARM=1` skips stop (debug only).
3. **Obsolete policy reap:** on ensure, any managed builder name whose policy version ≠ current `builderPolicy.version` is `buildx rm -f`’d.
4. **Janitor backstop:** managed builders still `running` with container age ≥ grace (default 45 minutes) and **no active local-CI owner fence** are stopped.

Stopping is **reversible**: the next build starts the same named builder; disk cache remains unless GC evicts under budget.

### 4.2 Tier B — Budgeted cache (disk)

Ship GC in `scripts/config/local-ci-buildkitd.toml`:

- `gc = true`
- CI-tuned `reservedSpace` / `maxUsedSpace` / `minFreeSpace` (see config file)
- Tiered `gcpolicy`: drop easy/stale records first; hard cap last

External `docker buildx prune --keep-storage` remains available to weekly infra prune / operators; it is not the only control.

### 4.3 Tier C — Images (already designed)

No change to the safety rules:

- Supersede slot images after green build (`local-integration-image-retention.mjs`)
- Age-stale tagged `dpf-local-integration-*-build` via infra / janitor planners
- Never delete images referenced by running containers or outside managed namespaces

## 5. Integrated process placement

| Concern | Owner in DPF process |
| --- | --- |
| Create / resource-bound builder | `scripts/local-ci-bounded-build.mjs` + `local-ci-bounded-builder.mjs` (BI-CE6E2882) |
| Cool-down after build | same path, `finally`-equivalent after build outcome |
| Pure lifecycle decisions | `scripts/lib/local-ci-builder-lifecycle.mjs` |
| Crash / leftover running builders | `scripts/runtime-artifact-janitor.mjs` (observe default; apply with existing flags) |
| Cache GC while running | `scripts/config/local-ci-buildkitd.toml` |
| Tagged CI image sprawl | existing retention + janitor (unchanged contract) |
| Substrate budgets | EP-PLATFORM-SUBSTRATE-CONVERGENCE idle footprint metrics |

This is **host build infrastructure**, not portal UX. Verification is host-side: unit tests for pure planners, CLI dry-run of janitor, and post-merge self-upgrade + one pregate observation. Build Studio sandbox is **out of scope** for proving BuildKit cool-down (the sandbox is not the builder host for this path).

## 6. Documents / surfaces to update

| Surface | Action |
| --- | --- |
| This design | Canonical decision record |
| `scripts/config/local-ci-buildkitd.toml` | Add GC (implementation) |
| `docs/testing/pre-pr-gate.md` | Note cool-down + keep-warm escape hatch |
| `docs/superpowers/specs/2026-08-03-docker-disk-prune-design.md` | Point at in-daemon GC as primary cache bound |
| `docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md` | Cross-link builder cool-down as complement to image janitor |
| `docs/architecture/platform-substrate-boundaries.md` | No metric change required; optional note in future runtime sample |

## 7. Non-goals

- Remote shared cache (Depot / registry cache) as a required path
- Replacing BuildKit / buildx
- Stopping the product `portal` container
- VHDX compact / Docker Desktop disk reclaim to the host OS
- Changing local-CI capacity pilot (still one automatic slot)

## 8. Acceptance criteria

- [ ] Pure lifecycle planner tests cover: current keep, obsolete reap, idle stop, lease/fence hold, keep-warm skip
- [ ] Post-build stop runs by default; `DPF_LOCAL_CI_BUILDER_KEEP_WARM=1` disables it
- [ ] Ensuring a v2 builder removes a leftover v1 builder
- [ ] `local-ci-buildkitd.toml` enables GC with documented size floors/ceilings
- [ ] Runtime-artifact janitor reports managed builders in dry-run and can stop/reap on apply
- [ ] Docs list cool-down behavior and escape hatch
- [ ] Operator can verify with `docker buildx ls` / `docker stats` after a pregate: builder not multi-GiB idle

## 9. Rollout

1. Land via PR + merge queue (DCO).
2. Operator self-upgrade picks up scripts/config (host scripts mount / install tree).
3. Optional immediate relief before upgrade: `docker buildx stop dpf-local-ci-buildkit-v2-0` and `docker buildx rm -f dpf-local-ci-buildkit-v1-0`.
4. Confirm next pregate still completes; idle BuildKit RSS near zero.

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| First build after stop pays builder bootstrap | Acceptable vs multi-GiB always-on; cache still warm |
| Stopping during an overlapping build | Only stop the builder this process used; janitor requires grace + no owner fence |
| GC too aggressive | Reserved floor + measure; tune `maxUsedSpace` without code change |
| Builder resource drift after recreate | Existing `validateBuilderInspection` fail-closed |
