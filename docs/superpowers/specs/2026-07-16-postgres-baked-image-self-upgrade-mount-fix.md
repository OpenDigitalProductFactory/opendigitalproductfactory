# Postgres baked image — self-upgrade mount fix (BI-4796D52B)

**Status:** implemented · **Date:** 2026-07-16 · **Owner:** platform

## Problem

On a Docker Desktop install, the self-upgrade **deploy** step took the database
(and thus the whole install) down and failed the run with
`worker-error: Can't reach database server at postgres` (observed
`SUR-AFB0DAB2`, `SUR-600F551A`).

The promoter (`scripts/promote.sh`) runs every compose command with
`--project-directory /host-source -p dpf` — `/host-source` is the promoter
container's read-only mount of the install source
(`PROMOTER_CONTAINER_SOURCE` in `apps/web/lib/self-upgrade/promoter.ts`). The
deploy steps pass `--no-deps` to leave postgres running, but compose still
**recreated** `dpf-postgres-1` (config drift is enough; `--no-deps` only stops
dependency *startup*, not reconciliation of an existing container). Under
`--project-directory /host-source`, the postgres service's host bind mount
`./scripts/init-inngest-db.sh` resolved to `/host-source/scripts/init-inngest-db.sh`
— a path that exists only *inside* the promoter container, not on the Docker
Desktop host. The daemon refused the mount
(`mounts denied: … not shared from the host`), postgres stuck in `state=Created`
(never started), the portal went unhealthy, and the upgrade worker lost its DB.

The portal service is immune because it runs from an image with no host
`./scripts` bind mount. This is the same path-divergence class as the
self-upgrade docker-build-context divergence.

Related, separately fixed: the recovery-point pg_dump failing when the image
lacks pgvector (BI-A35347E4 / PR #3040). That drift is *also* closed here.

## Decision

Kernel consult (`principle_decide`, high confidence, composite 5.61, margin
1.61, no commandment conflict) selected **bake a first-party postgres image**
over: a compose `configs:` entry (may still resolve against `/host-source`),
a published ghcr image (registry dependency for the core DB — hurts self-hosted
operational independence), and a promoter host-path rewrite (fixes only the
mount, not pgvector drift, and adds promoter complexity).

## Change

- **`docker/postgres/Dockerfile`** — `FROM pgvector/pgvector:pg16` +
  `COPY scripts/init-inngest-db.sh /docker-entrypoint-initdb.d/…`. Two wins in
  one image: (1) no host bind mount → postgres can be recreated under **any**
  project directory (including `/host-source`); (2) pgvector is always in the
  image → it can never drift to a plain postgres image. The build context is
  streamed to the daemon, so the `COPY` works from the promoter even though the
  source is only readable at `/host-source` and never a valid host bind path.
- **`docker-compose.yml`** — the `postgres` service now uses
  `build: { context: ., dockerfile: docker/postgres/Dockerfile }` and drops the
  `./scripts/init-inngest-db.sh:/docker-entrypoint-initdb.d/…:ro` bind mount.
  Only the main `postgres` service is affected (`sandbox-postgres` / `dev-postgres`
  never had the init bind mount). Compose auto-tags it `${project}-postgres`.
- **`scripts/promote.sh`** — builds `portal postgres` (was `portal`) so the
  image exists before any recreate; a single COPY over the cached pgvector base.
- **Guard** — `scripts/check-no-postgres-initdb-host-mount.mjs` (+ self-test)
  runs in the Repo Guard Loop and fails if any compose service host-bind-mounts
  into `/docker-entrypoint-initdb.d`, so the bind-mount form can't creep back.

`/docker-entrypoint-initdb.d` scripts only run on first init (empty data
volume), so baking the script in is a no-op for existing installs — the inngest
DB already exists — and identical behavior for fresh ones.

## Verification

Disposable-container run of the built image: starts, the baked script
auto-creates the `inngest` database, `CREATE EXTENSION vector` + an hnsw index
succeed, and `pg_dump --schema-only` exits 0 (the exact operation that failed at
recovery-point). Guard self-test 5/5.
