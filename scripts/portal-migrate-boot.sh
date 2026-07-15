#!/bin/sh
# BI-5322D025 — the portal self-migrates on every boot.
#
# A self-upgrade swap recreates ONLY the `portal` container (promote.sh step 4,
# --no-deps), so it never runs the one-shot `portal-init` service that a normal
# `docker compose up` runs to migrate the DB. A plain `docker restart portal`
# skips it too. Without this the live DB drifts whenever an upgrade ships a
# migration, and every query for a new column throws Prisma P2022 ColumnNotFound
# (the 2026-06-07 incident: /ops/self-upgrade, /build, /platform, /workbooks all
# crashed after a swap). Making the portal apply migrations from its OWN bytes on
# boot removes the dependency on portal-init AND on the freshness of the separate
# dpf-promoter image (BI-D9BAB4FA / BI-5322D025).
#
# `prisma migrate deploy` is forward-only, idempotent, and advisory-locked, so
# running it on every boot is safe and ~free when nothing is pending. Retried for
# the first-boot DB-readiness race (mirrors docker-entrypoint.sh). FAIL-CLOSED: if
# migrations cannot apply, the portal does NOT start (exec is never reached) — far
# better than serving a drifted schema. Then exec the passed server command.
#
# DPF_APP_DIR overrides the app root (defaults to /app); used only by the unit
# test so it can run this script against a scratch dir + a fake `pnpm`.
cd "${DPF_APP_DIR:-/app}" || {
  echo "[portal-boot] FATAL: app dir '${DPF_APP_DIR:-/app}' is missing" >&2
  exit 1
}

attempts=0
until pnpm --filter @dpf/db exec prisma migrate deploy; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 5 ]; then
    echo "[portal-boot] FATAL: prisma migrate deploy failed after 5 attempts" >&2
    exit 1
  fi
  echo "[portal-boot] migrate retry $attempts/5 in 3s..." >&2
  sleep 3
done

echo "[portal-boot] migrations applied; reconciling provider catalog"

if ! pnpm --filter @dpf/db exec tsx scripts/sync-provider-registry.ts; then
  echo "[portal-boot] FATAL: provider registry sync failed" >&2
  exit 1
fi

# Model-capability reconciliation is NON-FATAL — unlike migrations (a drifted *schema*
# is unsafe to serve) and the provider registry above (providers gate backend auth),
# this step only refreshes advisory model-capability metadata (which model is good at
# what). A stale, partial, or slightly-wrong model catalog is a DEGRADED state, not a
# correctness hazard: the portal serves fine on the model catalog already in the DB.
# Blocking boot on it is what crash-looped the portal when a single new or renamed
# model made the reconciler throw (the #318 capabilityTier -> capabilityCategory drift;
# a brand-new model hitting the create path). Models get added, retired, and deprecated
# routinely, so this step degrades loudly and never fails the whole boot. Failures are
# logged; the catalog keeps its prior state until the next successful reconcile, and
# CI's typecheck + catalog-integrity tests catch bad catalog changes before they ship.
if ! pnpm --filter @dpf/db exec tsx scripts/reconcile-catalog-capabilities.ts; then
  echo "[portal-boot] WARN: catalog capability reconciliation failed — starting with the existing model catalog (see error above)" >&2
fi

# BET-5 (BI-A1E864A5 / BI-922EBB99): on an install that still has Neo4j + Qdrant, copy their
# data into the Postgres mirror while those containers are still reachable, so the host-level
# teardown script can then remove them without data loss. NON-FATAL and idempotent: a fresh
# install (no Neo4j/Qdrant) or a post-teardown re-run finds nothing to copy and skips. This
# only stages the data — the actual container/volume removal is the separately-gated
# scripts/decommission-neo4j-qdrant.{sh,ps1}, which refuses to delete anything until the
# mirror is confirmed populated.
# Guard the boot on a wall-clock timeout: the backfill is best-effort and idempotent, so it
# must NEVER be able to block the server from starting. The script force-exits when done
# (see bet5-decommission-backfill.ts), but `timeout` is the belt-and-suspenders backstop —
# a future hang (a wedged Neo4j/Qdrant read, a driver that won't drain) gets killed and boot
# proceeds. `timeout` may be absent on a minimal image; fall back to a plain run if so.
if command -v timeout >/dev/null 2>&1; then
  _bet5_backfill() { timeout 300 pnpm --filter @dpf/db exec tsx scripts/bet5-decommission-backfill.ts; }
else
  _bet5_backfill() { pnpm --filter @dpf/db exec tsx scripts/bet5-decommission-backfill.ts; }
fi
if ! _bet5_backfill; then
  echo "[portal-boot] WARN: BET-5 datastore backfill reported an error or timed out — legacy stores left intact (see error above)" >&2
fi

echo "[portal-boot] provider catalog reconciled (or degraded); starting server"
exec "$@"
