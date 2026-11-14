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

echo "[portal-boot] migrations applied; converging model metadata comments (EP-A33A5C61)"
if ! pnpm --filter @dpf/db exec tsx scripts/apply-model-metadata-comments.ts; then
  echo "[portal-boot] WARN: model metadata comments could not be applied — the catalog may lag the schema until the next boot (see error above)" >&2
fi
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

# BI-D4C1E05E / BI-F039D17A — converge the wiki vector store on every upgrade boot.
# A self-upgrade merges upstream main and rebuilds. Two things can leave retrieval
# behind the shipped corpus: a published page with no vector (authored while an
# earlier build could not embed it), and a page whose prose CHANGED in this
# release while its vector still encodes the old wording. Kernel principles and
# profession pages are the doctrine expert coworkers steer by, so a stale vector
# means steering by superseded doctrine. reconcilePublishedWikiEmbeddings embeds
# missing pages and re-embeds any page whose content digest differs from the one
# stamped on its vector; unchanged pages are skipped, so this is a cheap no-op
# once the store is current.
#
# BUDGETED: the run stops starting new embeds after --budget-seconds and reports
# the remainder as deferred. The digest is the only state, so the two-hourly
# embedding-coverage job (and the next boot) resume exactly where this stopped,
# and every run reports what it refreshed into the corpus-health Workroom.
#
# NON-FATAL, exactly like the catalog reconcile above: the embedding provider
# (Docker Model Runner) may legitimately be unreachable at boot, and the script
# EXITS 1 in that case (fail-loud precondition) — but a drifted vector index is a
# DEGRADED retrieval state, not a correctness hazard for serving the portal, and
# the scheduled job closes the gap. Blocking boot on the embed provider would
# crash-loop the portal the same way blocking on the model catalog did (#318).
if ! pnpm --filter web exec tsx scripts/reembed-wiki-store.ts --budget-seconds 180; then
  echo "[portal-boot] WARN: wiki embedding convergence did not complete — embedding provider may be unavailable; new publishes still embed on the write-path, and the scheduled embedding-coverage job retries (see error above)" >&2
fi

echo "[portal-boot] provider catalog reconciled (or degraded); starting server"
exec "$@"
