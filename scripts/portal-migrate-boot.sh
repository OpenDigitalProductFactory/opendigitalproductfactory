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

if ! pnpm --filter @dpf/db exec tsx scripts/reconcile-catalog-capabilities.ts; then
  echo "[portal-boot] FATAL: catalog capability reconciliation failed" >&2
  exit 1
fi

echo "[portal-boot] provider catalog reconciled; starting server"
exec "$@"
