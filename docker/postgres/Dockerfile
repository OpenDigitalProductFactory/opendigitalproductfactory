# DPF Postgres image (BI-4796D52B).
#
# FROM pgvector so the vector.so the BET-5 schema depends on is ALWAYS present
# in the image — it can never drift back to a plain postgres:16-alpine (which
# breaks pg_dump / vector queries; see BI-A35347E4 / local-ci-pregate-pgvector).
#
# The inngest-db init script is BAKED IN rather than host-bind-mounted. The old
# `./scripts/init-inngest-db.sh:/docker-entrypoint-initdb.d/...` bind mount made
# the container un-startable whenever compose recreated it under a project
# directory the Docker daemon can't resolve to a shared host path — most acutely
# the self-upgrade promoter, which runs compose with `--project-directory
# /host-source` (a path that exists only inside the promoter container). The
# bind source then became `/host-source/scripts/init-inngest-db.sh`, Docker
# refused the mount, postgres stuck in `Created`, and the whole install lost its
# DB mid-upgrade. Baking the script into an image layer removes that host-path
# dependency entirely: postgres can be recreated under ANY project directory.
#
# The build context is the repo root (see docker-compose.yml `build.context`),
# streamed to the daemon — so this COPY works even from the promoter, where the
# source is only readable at /host-source and never a valid host bind path.
FROM pgvector/pgvector:pg16

# Runs only on first init (empty data dir); idempotent for existing volumes.
COPY scripts/init-inngest-db.sh /docker-entrypoint-initdb.d/20-create-inngest-db.sh
