-- Resolve the `docker-host:` (HYPHEN) leak — the last self-healable slice of the
-- open-issues arc. See docs/superpowers/specs/2026-07-24-quality-issue-lifecycle-
-- governance-design.md.
--
-- `discovery-collectors/docker.ts` emits `docker-host:${name}` with a HYPHEN,
-- while the Docker-origin guard listed only `docker_host:` with an UNDERSCORE.
-- That one-character mismatch let 124 rows shaped like
--   dpf_bootstrap:HOSTS:docker-host:docker-desktop->net-iface:Wi-Fi:192.168.0.169
-- past every previous suppression pass and every previous cleanup migration.
-- They are platform-internal Docker Desktop topology: never operator-actionable,
-- and they can never resolve on their own.
--
-- The guard now lists BOTH separators, so no new rows of this shape are emitted.
-- This backfill clears the ones already persisted. Non-destructive: status
-- open -> resolved only; rows remain for audit. Matched POSITIONALLY (after `:`
-- or the `->` arrow) so a product legitimately containing the letters is never
-- touched. Genuine managed topology (UniFi gateway/switch/AP links) is
-- deliberately left OPEN — that is real operator signal.
UPDATE "PortfolioQualityIssue"
SET "status" = 'resolved',
    "resolvedAt" = NOW()
WHERE "status" = 'open'
  AND "issueType" IN ('stale_entity', 'stale_relationship')
  AND "issueKey" ~ '[:>]docker-host:';
