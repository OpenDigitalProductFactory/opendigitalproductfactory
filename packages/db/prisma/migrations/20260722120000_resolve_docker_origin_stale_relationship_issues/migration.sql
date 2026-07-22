-- Follow-up to BI-62846516 (#3163) — Resolve historical Docker-origin stale_relationship quality issues.
--
-- The discovery→portfolio pipeline emitted an OPEN stale_relationship
-- PortfolioQualityIssue for every InventoryRelationship marked status='stale'.
-- Docker-origin relationships (container<->container, container<->docker-net,
-- docker.sock<->container) from the platform's own dpf_bootstrap self-scan churn
-- on every container recreation: each recreation mints a new 12-hex container id,
-- so the old relationshipKey is never observed again and stays `stale` forever —
-- one permanently-open issue per orphan, with no resolve pass. This accumulated
-- 1.5k+ open rows that buried the real signal.
--
-- Going forward the relationship loop skips these via isDockerOriginRelationshipKey
-- (packages/db/src/docker-origin.ts), mirroring the entity loop's existing
-- isDockerOriginEntityKey guard. This one-shot backfill resolves the rows already
-- persisted under the old behaviour. Non-destructive: it only flips status
-- open -> resolved (rows remain for audit). The predicate mirrors the helper's
-- token set exactly and matches none of the real-estate relationship keys
-- (organization:...arp:192.168.x->unifi:mac), which are intentionally left open.
UPDATE "PortfolioQualityIssue"
SET "status" = 'resolved',
    "resolvedAt" = NOW()
WHERE "issueType" = 'stale_relationship'
  AND "status" = 'open'
  AND (
    "issueKey" ~ '[:>]container:'
    OR "issueKey" LIKE '%docker-net:%'
    OR "issueKey" LIKE '%docker_runtime:%'
    OR "issueKey" LIKE '%/var/run/docker.sock%'
    OR "issueKey" LIKE '%docker_host:%'
    OR "issueKey" LIKE '%runtime:docker%'
    OR "issueKey" LIKE '%subnet:docker-%'
    OR "issueKey" LIKE '%gateway:docker-gw:%'
    -- Docker 172.16.0.0/12 bridge-network topology (arp-host / subnet endpoints)
    OR "issueKey" ~ '(^|[^0-9.])172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}'
  );
