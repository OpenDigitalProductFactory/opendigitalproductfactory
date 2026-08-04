# Plan — Docker image retention sweep (BI-A53DFC81)

Work Capsule: WC-03F189C6 · Branch: `fix/image-retention-sweep`

One concern: **the weekly Docker sweep cannot see the images that fill the disk, and cannot tell you when it fails.**

## What was actually wrong

The item as I first filed it was partly wrong, and the correction is recorded on it
(activity `cmsezd3hp1ho601qzg08dkqkk`). `infra-prune` *does* prune Docker disk and *does*
cap promoter images at 3. Two things are genuinely broken:

1. **Tagged per-branch images are invisible to it.** The job's only broad sweep is
   `docker image prune -f --filter until=48h`, which removes **dangling** images. Every
   `dpf-local-integration-*-build` and `*-local-ci-portal` image is **tagged**. Measured on
   2026-08-04: **0 dangling images alongside 105 tagged ones at ~5 GB each.** The job could
   run perfectly every week forever and never touch the category that filled the disk to
   zero on 2026-07-31, took the ext4 filesystem read-only, and killed Postgres with SIGBUS.

2. **The step cannot report what it did.** Three `catch { /* Ignore errors */ }` blocks and
   a flat `return { prunedDockerDisk: true }`. A run that removed 200 images and a run that
   silently failed are indistinguishable — which is why nobody could tell that 68 promoter
   images had accumulated under a rule capping them at 3. Direct instance of
   `make-silent-failures-observable`.

## Why not extend the existing script module

`scripts/lib/local-integration-image-retention.mjs` reaps a slot's **superseded** images,
host-side, right after a green build. It is correct for the case it covers and is not
changed here. Its limit is structural: it only reaps a slot when that slot **builds again**,
so a branch that built a few times then merged keeps its image forever. That tail is
unbounded in branches-ever-verified, not in active slots.

The age sweep has a different consumer (the scheduled job, inside the portal container), so
it lives in `apps/web/lib/infra/`. Putting it in the `.mjs` would have meant either a second
copy or an import across the script/app boundary. One planner, one consumer each.

## Implementation

1. `apps/web/lib/infra/docker-image-retention.ts` — pure planner.
   - `planStaleImageReaping` with three guards, all of which must pass: managed namespace,
     referenced by no container, and neither newest-in-group nor within the age window.
   - **The namespace allowlist is the load-bearing safety property.** A blanket age sweep
     would delete postgres, grafana, and the portal image itself.
   - **Keep the newest per group even when ancient** — reaping a live slot's only image
     forces a cold rebuild, the cost this retention exists to avoid.
   - `parseDockerImageRows` drops rows with an unparseable date rather than coercing to
     epoch 0, which would make them look infinitely old and be reaped first.
2. `infra-prune.ts` — call it, and record per-category outcomes (`found/planned/removed/
   failed`, or the error) instead of swallowing. Remove uses no `-f`: if something
   unexpectedly references an image, refusing is correct.

## Verification

- 16 unit tests on the planner, weighted to the safety properties rather than the happy path.
- Typecheck + CI.
- Functional: the manual reclaim on 2026-08-04 already proved the selection rule against the
  real estate — 175 images removed, 0 refused, platform healthy throughout.

## Deliberately not in scope

- Changing the success-gating on the existing per-slot reap. Reaping after a failed build
  would delete the last known-good image.
- A vhdx compact. Deleting images frees space *inside* Docker's virtual disk, which is what
  the outage actually exhausted; returning it to the host needs Docker stopped and is an
  operator decision.
- Disk-pressure alerting (item acceptance criterion 4) — that belongs with the health-alert
  path, not this sweep, and is left as a follow-up rather than smuggled in here.
