# Docker Disk Pruning Design

## Background
Nothing on the platform reclaims Docker disk space. The scheduled job named 'Infrastructure prune' currently only prunes stale InfraCI DATABASE records, not actual Docker disk. This leads to disk space exhaustion due to unpruned images and build cache.

## Objective
- Add a new scheduled job or extend `infra-prune` to reclaim Docker disk space by pruning dangling images and build caches.
- Target: `docker image prune -f --filter until=48h` and `docker builder prune -f --keep-storage 20gb`.
- Preserve recent promoter images (last 3 tags).
- Clarify that `pruneStaleInfraCIs` is a *database* prune (not Docker disk) via a call-site comment — avoid a packages/db rename in this PR so scope stays one-concern.

## Implementation Details
1. **Extend Infra-Prune Job**: Add a `prune-docker-disk` step on the weekly `ops/infra-prune` Inngest function (DB prune step stays first).
2. **Clarify Call Site**: Comment at the `pruneStaleInfraCIs` import that it prunes InfrastructureCI database rows, not Docker images (rename deferred to avoid unrelated packages/db churn).
3. **Execute Pruning Commands**: Subprocess `docker image prune` / `docker builder prune`, plus keep the last 3 `dpf-promoter` image tags.
