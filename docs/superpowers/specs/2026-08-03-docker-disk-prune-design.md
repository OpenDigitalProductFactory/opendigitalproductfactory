# Docker Disk Pruning Design

## Background
Nothing on the platform reclaims Docker disk space. The scheduled job named 'Infrastructure prune' currently only prunes stale InfraCI DATABASE records, not actual Docker disk. This leads to disk space exhaustion due to unpruned images and build cache.

## Related (2026-08-10)
Primary **BuildKit cache bounding** for the managed local-CI builder is now **in-daemon GC** via
`scripts/config/local-ci-buildkitd.toml` (see
[`2026-08-10-buildkit-session-lifecycle-design.md`](./2026-08-10-buildkit-session-lifecycle-design.md),
BI-C85D1B0A). External `builder prune` remains a backstop for operators and weekly jobs; it is
not the only control. Session cool-down (`docker buildx stop`) reclaims **RAM**, not layer
disk — GC / prune reclaim **disk**.

## Objective
- Add a new scheduled job or extend `infra-prune` to reclaim Docker disk space by pruning dangling images and build caches.
- Target: `docker image prune -f --filter until=48h` and `docker builder prune -f --keep-storage 20gb`.
- Preserve recent promoter images (last 3 tags).
- Clarify that `pruneStaleInfraCIs` is a *database* prune (not Docker disk) via a call-site comment — avoid a packages/db rename in this PR so scope stays one-concern.

## Implementation Details
1. **Extend Infra-Prune Job**: Add a `prune-docker-disk` step on the weekly `ops/infra-prune` Inngest function (DB prune step stays first).
2. **Clarify Call Site**: Comment at the `pruneStaleInfraCIs` import that it prunes InfrastructureCI database rows, not Docker images (rename deferred to avoid unrelated packages/db churn).
3. **Execute Pruning Commands**: Subprocess `docker image prune` / `docker builder prune`, plus keep the last 3 `dpf-promoter` image tags.
