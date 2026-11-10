---
status: active
---

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

## Amendment (2026-09-07) — release version tags are in scope, and the promoter owns them

**OBJ-ID:** OBJ-DOCKER-DISK-RECLAIM

### What this spec did not cover

The keep-last-3 rule above names exactly one repository, `dpf-promoter`, and lives in the weekly
`ops/infra-prune` job. The self-upgrade release images beside it were never in scope. Every upgrade
tags a fresh `dpf-portal`, `dpf-postgres`, `dpf-promoter` and `dpf-sandbox` as `:v<date>-<slug>.<n>`,
and a superseded tag is still TAGGED, so `docker image prune` cannot see it — the same structural
blind spot this spec already records for per-branch images.

Measured on a development install, 2026-09-06: 272 images, 430.2 GB, 93% reclaimable, 13 active.
`dpf-portal` held 92 version tags at 4.14 GB each, `dpf-postgres` 74, `dpf-promoter` 70, oldest 16
days. Roughly 5 GB per upgrade, never reclaimed. `promote.sh` already predicted the end state in its
own cleanup comment: the next `docker compose build` fails with no space left on device.

### Why the retention lives in two places, deliberately

`apps/web/lib/infra/docker-image-retention.ts` is the canonical planner for age-based reaping, and
its `MANAGED_PATTERNS` allowlist covers only `dpf-local-integration-*` and `*-local-ci-portal`. That
exclusion is load-bearing and correct: a weekly age sweep has no way to know whether the portal image
it is looking at is the one currently serving, so it must not be allowed near it.

The promoter does know. `promote.sh` runs the sweep inside `step=cleanup`, after every verify has
passed, at the one moment the platform is certain which image was just swapped in and which was
superseded. So release-tag retention belongs there, not in the weekly job, and the two mechanisms
partition the namespace rather than overlap:

| Mechanism | Owns | Rule |
| --- | --- | --- |
| `ops/infra-prune` weekly job | per-branch and local-CI images, `dpf-promoter` legacy tags | age-based, allowlisted |
| `promote.sh` `step=cleanup` | `dpf-portal`, `dpf-postgres`, `dpf-promoter`, `dpf-sandbox` `:v*` tags | keep in-use plus `PROMOTE_IMAGE_KEEP` newest |

### Acceptance criteria

| AC | Statement |
| --- | --- |
| AC-DDP-004 | After a successful promote, each self-upgrade repository retains at most its in-use tags plus `PROMOTE_IMAGE_KEEP` (default 3) version tags. |
| AC-DDP-005 | A tag referenced by any container, running or stopped, is never a removal candidate, regardless of age. |
| AC-DDP-006 | Removal is by `repository:tag` reference and never forced, so a layer shared with a retained tag survives. |
| AC-DDP-007 | Cleanup runs only after every verify has passed, and any failure within it leaves the promotion successful. |
| AC-DDP-008 | Removals are issued in chunks rather than one call per tag, so the first sweep on an install carrying a historical backlog does not extend the upgrade window by minutes. |

### Known duplication to resolve

`PROMOTE_IMAGE_KEEP` in `promote.sh` and the literal `3` in `infra-prune.ts` are now two statements
of the same retention depth in two languages, and `infra-prune.ts` removes with `docker image rm -f`
while the promoter deliberately does not force. Consolidating the depth onto one declared constant,
and reconciling the force flag, is follow-up work rather than part of the fix that stopped the growth.

### Delivered by

- BI-1172E86A, PR #5173 — bounds the pile; verified live, where version-tag counts
  fell across two self-upgrades while each upgrade added a tag.
- BI-A5FFE7A7, PR #5184 — issues removals in chunks of 50 after a manual reclaim of 223 tags showed
  the per-tag loop taking about 13 minutes, a cost that would otherwise land on every install at once.
