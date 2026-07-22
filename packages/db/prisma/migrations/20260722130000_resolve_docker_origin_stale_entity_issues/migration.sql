-- Follow-up to BI-527290AA (#3418) — Resolve historical Docker-origin stale_entity
-- quality issues (the entity twin of the stale_relationship cleanup).
--
-- The discovery pipeline emitted an OPEN stale_entity PortfolioQualityIssue for
-- every InventoryEntity marked status='stale'. The entity loop already guards
-- Docker-origin entities via isDockerOriginEntityKey, but that guard missed the
-- self-scan's bridge-NIC shape (network_interface:iface:eth0:172.18.0.14 and its
-- __dpf_quarantined__… wrappers), so those leaked past it and opened a permanent
-- stale_entity issue per orphaned Docker 172.16/12 bridge address — churn that
-- never resolves. isDockerOriginEntityKey is now extended to catch the 172.16/12
-- bridge range in any key shape (packages/db/src/docker-origin.ts).
--
-- This one-shot backfill resolves the rows already persisted under the old
-- behaviour. Non-destructive: it only flips status open -> resolved (rows remain
-- for audit). The predicate mirrors the Docker-origin entity-key detection; the
-- operator's real LAN is 192.168/10, so it matches none of the real-estate or
-- genuine stale entities (which are left open for the reconcile-on-recovery pass).
UPDATE "PortfolioQualityIssue"
SET "status" = 'resolved',
    "resolvedAt" = NOW()
WHERE "issueType" = 'stale_entity'
  AND "status" = 'open'
  AND (
    "issueKey" LIKE 'inventory_entity:container:%'
    OR "issueKey" LIKE 'inventory_entity:subnet:docker-%'
    OR "issueKey" LIKE 'inventory_entity:gateway:docker-gw:%'
    OR "issueKey" LIKE 'inventory_entity:runtime:docker%'
    OR "issueKey" LIKE 'inventory_entity:docker_host:%'
    OR "issueKey" ~ 'host:hostname:[0-9a-f]{12}'
    -- Docker 172.16.0.0/12 bridge address in any key shape (bridge NICs, etc.)
    OR "issueKey" ~ '(^|[^0-9.])172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}'
  );
