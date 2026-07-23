-- Estate identity + managed-vs-observed classification
-- (docs/superpowers/specs/2026-07-22-estate-identity-and-managed-classification-design.md)
--
-- Resolve open stale_entity / stale_relationship issues for things discovery
-- merely OBSERVED rather than things the operator MANAGES:
--
--   arp: / arp-host:   ARP neighbours — a host that answered on the wire once.
--   unifi-client:      UniFi *clients* (phones, laptops, guests), as opposed to
--                      `unifi:` UniFi *devices* (AP/switch/router), which ARE
--                      managed infrastructure and are deliberately left open.
--   prom: / prom-target:  the platform's own Prometheus scrape topology.
--
-- These vanish as a matter of course, so a "stale" issue for them can never be
-- resolved by any operator action — it is noise by construction. Going forward
-- `evaluateInventoryQuality` no longer emits them (estate-observation-class.ts).
--
-- Also resolves Docker container rows that bypassed isDockerOriginEntityKey
-- because `container:` appeared as a LATER segment (e.g.
-- `monitoring_service:container:06cc859f0e76`) rather than a prefix; that guard
-- is now positional.
--
-- Tokens are matched POSITIONALLY (after `:` or the `->` arrow) so a managed
-- product whose name merely contains the letters — `promotions-engine`,
-- `sharp-imaging` — is never matched. Non-destructive: status open -> resolved
-- only; rows remain for audit. Managed infrastructure that genuinely vanished is
-- intentionally left OPEN, because that is real operator signal.
UPDATE "PortfolioQualityIssue"
SET "status" = 'resolved',
    "resolvedAt" = NOW()
WHERE "status" = 'open'
  AND "issueType" IN ('stale_entity', 'stale_relationship')
  AND (
    "issueKey" ~ '[:>](arp|arp-host|unifi-client|prom|prom-target):'
    OR "issueKey" ~ '[:>]container:'
  );
