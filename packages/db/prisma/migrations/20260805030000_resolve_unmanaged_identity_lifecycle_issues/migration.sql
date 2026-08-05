-- Scope identity/lifecycle quality issues to the MANAGED estate, and close the
-- rows that no code path could ever reach. (BI-A3D12F85)
--
-- Measured on the live install by executing the detector, not by querying stored
-- columns: MAC OUI enrichment resolved 65 of 65 burned-in MACs to a vendor and 0
-- of 119 locally-administered ones. Every ARP host being swept today carries a
-- randomised MAC, which has no OUI and therefore no vendor, no catalog identity
-- and no support lifecycle — by construction, not by omission. Asking an
-- operator to "review the identity" of a phone that joined the wifi is a
-- question with no answer, and 180 such rows buried the 21 that describe real
-- managed gear (4 UniFi APs, a gateway, a switch, a host, NICs, subnets).
--
-- Going forward `evaluateInventoryQuality` gates both types on
-- classifyEntityObservation(...) === "managed", exactly as stale_entity already
-- did (20260723020000). This migration closes the rows opened before that gate.
--
-- Three populations, all non-destructive (status open -> resolved only; rows
-- remain for audit). Managed infrastructure with a genuine identity gap is
-- deliberately left OPEN — that is the real operator signal this change exists
-- to surface.

-- (1) Observed rather than managed estate. Tokens matched POSITIONALLY (key
-- start, or after `:` / the `->` arrow) so a managed product whose name merely
-- contains the letters — `promotions-engine`, `sharp-imaging` — never matches.
-- Mirrors hasObservedToken() in estate-observation-class.ts.
UPDATE "PortfolioQualityIssue"
SET "status" = 'resolved',
    "resolvedAt" = NOW()
WHERE "status" = 'open'
  AND "issueType" IN ('catalog_match_ambiguous', 'lifecycle_unverified')
  AND "issueKey" ~ '(^inventory_entity:|[:>])(arp|arp-host|unifi-client|prom|prom-target):';

-- (2) Docker-origin subjects stranded by a suppression that only stopped
-- emitting. isDockerOriginEntityKey() matches `:container:` positionally and the
-- entity loop then `continue`d, so these appeared in neither the emit branch nor
-- the resolve branch and had no close path at all. The loop now resolves what it
-- suppresses (resolveAllEntityIssues), which fixes the flow; this clears the
-- backlog it left behind.
UPDATE "PortfolioQualityIssue"
SET "status" = 'resolved',
    "resolvedAt" = NOW()
WHERE "status" = 'open'
  AND "issueType" IN ('catalog_match_ambiguous', 'lifecycle_unverified')
  AND "issueKey" ~ '[:>]container:';

-- (3) Rows whose subject entity no longer exists. Reconciliation resolves by
-- issueKey derived from entities present in a sweep, so a row whose
-- inventoryEntityId is NULL or dangling is unreachable by every close path the
-- platform has. These are overwhelmingly Docker bridge NICs
-- (`iface:eth0:172.18.0.x`, `vEthernet_*`) whose lastDetectedAt never advanced
-- past firstDetectedAt — raised once, never re-observed, never closable.
UPDATE "PortfolioQualityIssue" q
SET "status" = 'resolved',
    "resolvedAt" = NOW()
WHERE q."status" = 'open'
  AND q."issueType" IN ('catalog_match_ambiguous', 'lifecycle_unverified')
  AND (
    q."inventoryEntityId" IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM "InventoryEntity" e WHERE e."id" = q."inventoryEntityId"
    )
  );
