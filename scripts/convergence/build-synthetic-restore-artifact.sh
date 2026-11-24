#!/usr/bin/env bash
# Build the synthetic restore artifact for the DPF -> DPF2 Gate 3 rehearsal (BI-3357F36E).
#
# Produces a `pg_dump -Fc` of a throwaway PostgreSQL 16 database at the
# repository's current migration head, holding only the fictional rows in
# synthetic-restore-fixture.sql. The dump is written by the production backup
# script (scripts/backup-postgres.sh), so its directory and manifest have the
# exact shape a governed DPF backup has, which is what DPF2's intake check reads.
#
# Output (owner-only permissions, outside any git checkout):
#   <OUT_DIR>/backup/      exactly manifest.json, dpf.dump, dpf.dump.sha256, log.txt
#   <OUT_DIR>/files/       the synthetic document bytes at their storage keys
#   <OUT_DIR>/provenance.json  source commit, migration head, fixture digest,
#                          dump digest and the files manifest
#
# The backup directory holds nothing else, because DPF2 intake refuses any extra
# entry. The files and provenance sit beside it until BI-1C6BF6B6 agrees a files
# manifest shape with DPF2.
#
# Usage: scripts/convergence/build-synthetic-restore-artifact.sh [OUT_DIR]
#   default OUT_DIR: $HOME/dpf-deliverables/dpf2-synthetic-restore/<migration-head>-<short-sha>
#
# Needs: docker, sha256sum (or shasum), git. Never touches a running DPF container.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/packages/db/prisma/migrations"
FIXTURE="$REPO_ROOT/scripts/convergence/synthetic-restore-fixture.sql"
IMAGE="pgvector/pgvector:pg16"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}

SOURCE_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
SHORT_SHA="${SOURCE_SHA:0:12}"
MIGRATION_HEAD="$(find "$MIGRATIONS_DIR" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | LC_ALL=C sort | tail -1)"
OUT_DIR="${1:-$HOME/dpf-deliverables/dpf2-synthetic-restore/${MIGRATION_HEAD}-${SHORT_SHA}}"

case "$OUT_DIR" in
  "$REPO_ROOT"|"$REPO_ROOT"/*) echo "refusing: OUT_DIR is inside the repository ($OUT_DIR)" >&2; exit 2 ;;
esac
if git -C "$(dirname "$OUT_DIR")" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "refusing: OUT_DIR is inside a git checkout ($OUT_DIR)" >&2; exit 2
fi
[ ! -e "$OUT_DIR" ] || { echo "refusing: $OUT_DIR already exists; artifacts are immutable" >&2; exit 2; }

umask 077
mkdir -p "$OUT_DIR/files"

CONTAINER="dpf-synthetic-restore-$$"
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "[synthetic-restore] source $SOURCE_SHA, migration head $MIGRATION_HEAD"
docker run -d --name "$CONTAINER" -e POSTGRES_USER=dpf -e POSTGRES_PASSWORD=synthetic -e POSTGRES_DB=dpf "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U dpf -d dpf >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U dpf -d dpf >/dev/null

psql_in() { docker exec -i "$CONTAINER" psql -q -U dpf -d dpf -v ON_ERROR_STOP=1 "$@"; }

# Prisma's own bookkeeping table, so the restored database reports its migration head.
psql_in -c 'CREATE TABLE "_prisma_migrations" (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0);' >/dev/null

# Apply every migration in order. Each runs in one transaction, as Prisma does;
# a migration that cannot run inside a transaction (CREATE INDEX CONCURRENTLY)
# is retried without one.
ERR_FILE="$(mktemp)"
count=0
while IFS= read -r dir <&3; do
  name="$(basename "$dir")"
  sql="$dir/migration.sql"
  [ -f "$sql" ] || continue
  if ! psql_in -1 < "$sql" >/dev/null 2>"$ERR_FILE"; then
    if grep -qiE "CONCURRENTLY|cannot run inside a transaction block" "$ERR_FILE"; then
      psql_in < "$sql" >/dev/null 2>"$ERR_FILE" || { echo "[synthetic-restore] migration $name failed:" >&2; cat "$ERR_FILE" >&2; exit 3; }
    else
      echo "[synthetic-restore] migration $name failed:" >&2; cat "$ERR_FILE" >&2; exit 3
    fi
  fi
  checksum="$(sha256_of "$sql")"
  psql_in -c "INSERT INTO \"_prisma_migrations\" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES (gen_random_uuid()::text, '$checksum', now(), '$name', 1);" >/dev/null
  count=$((count + 1))
done 3< <(find "$MIGRATIONS_DIR" -mindepth 1 -maxdepth 1 -type d | LC_ALL=C sort)
rm -f "$ERR_FILE"
echo "[synthetic-restore] applied $count migrations"

# The synthetic document file: fixed text, so its digest is reproducible.
BLOB_TMP="$(mktemp)"
printf 'Synthetic invoice INV-SYN-0001 for Harbour Bakery (synthetic). Total 102.837500000000000000000000001 USD. Not a real document.\n' > "$BLOB_TMP"
BLOB_SHA="$(sha256_of "$BLOB_TMP")"
BLOB_SIZE="$(wc -c < "$BLOB_TMP" | tr -d ' ')"
BLOB_KEY="documents/sha256/${BLOB_SHA:0:2}/${BLOB_SHA:2:2}/$BLOB_SHA"
mkdir -p "$OUT_DIR/files/$(dirname "$BLOB_KEY")"
mv "$BLOB_TMP" "$OUT_DIR/files/$BLOB_KEY"

psql_in -v blob_sha256="$BLOB_SHA" -v blob_size="$BLOB_SIZE" < "$FIXTURE" >/dev/null
echo "[synthetic-restore] loaded synthetic fixture"

# The production backup script writes the dump directory. It validates the dump
# with `pg_restore --list`, which the portal runner image provides. Here the
# PostgreSQL 16 client inside the throwaway container does that check, so the
# validation uses the same major version that wrote the dump.
SHIM_DIR="$(mktemp -d)"
cat > "$SHIM_DIR/pg_restore" <<SHIM
#!/usr/bin/env bash
set -euo pipefail
file="\${@: -1}"
docker cp "\$file" "$CONTAINER:/tmp/validate.dump" >/dev/null
docker exec "$CONTAINER" pg_restore "\${@:1:\$#-1}" /tmp/validate.dump
SHIM
chmod +x "$SHIM_DIR/pg_restore"

PATH="$SHIM_DIR:$PATH" \
  TARGET_DIR="$OUT_DIR/backup" \
  DPF_PRODUCTION_DB_CONTAINER="$CONTAINER" \
  POSTGRES_USER=dpf POSTGRES_DB=dpf \
  DPF_VERSION="synthetic-restore@$SOURCE_SHA" \
  bash "$REPO_ROOT/scripts/backup-postgres.sh" >/dev/null
rm -rf "$SHIM_DIR"

DUMP_SHA="$(sha256_of "$OUT_DIR/backup/dpf.dump")"
FIXTURE_SHA="$(sha256_of "$FIXTURE")"
cat > "$OUT_DIR/provenance.json" <<JSON
{
  "artifact": "dpf-synthetic-restore",
  "backlogItem": "BI-3357F36E",
  "dataClass": "synthetic",
  "sourceRepository": "OpenDigitalProductFactory/opendigitalproductfactory",
  "sourceCommit": "$SOURCE_SHA",
  "migrationHead": "$MIGRATION_HEAD",
  "migrationCount": $count,
  "postgresImage": "$IMAGE",
  "fixture": { "path": "scripts/convergence/synthetic-restore-fixture.sql", "sha256": "$FIXTURE_SHA" },
  "dump": { "path": "backup/dpf.dump", "sha256": "$DUMP_SHA" },
  "files": {
    "root": "files",
    "count": 1,
    "entries": [ { "path": "$BLOB_KEY", "sha256": "$BLOB_SHA", "sizeBytes": $BLOB_SIZE } ]
  }
}
JSON

echo "[synthetic-restore] artifact: $OUT_DIR"
echo "[synthetic-restore] dump sha256: $DUMP_SHA"
