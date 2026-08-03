# Docker Disk Pruning Design

## Background
Nothing on the platform reclaims Docker disk space. The scheduled job named 'Infrastructure prune' currently only prunes stale InfraCI DATABASE records, not actual Docker disk. This leads to disk space exhaustion due to unpruned images and build cache.

## Objective
- Add a new scheduled job or extend `infra-prune` to reclaim Docker disk space by pruning dangling images and build caches.
- Target: `docker image prune -f --filter until=48h` and `docker builder prune -f --keep-storage 20gb`.
- Preserve recent promoter images (last 3 tags).
- Rename `pruneStaleInfraCIs` or add clear comments to prevent confusion about its purpose.

## Implementation Details
1. **Extend Infra-Prune Action**: Update `apps/web/lib/actions/infra-prune.ts` to include Docker pruning tasks.
2. **Rename Function**: Rename `pruneStaleInfraCIs` to `pruneStaleInfraCIDatabaseRecords` (or add a clarifying comment) to explicitly indicate it prunes database records.
3. **Execute Pruning Commands**: Use a subprocess to run the Docker pruning commands.
