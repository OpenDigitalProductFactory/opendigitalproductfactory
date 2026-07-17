-- BI-62846516 — Resolve historical terminal-structural promotion skips that were
-- mistakenly recorded as OPEN portfolio quality issues.
--
-- `name_not_promotable` (evidence source `name-gate`) and `type_not_promotable`
-- (evidence source `structural-type-gate`) are CORRECT "this entity is
-- infrastructure / a runtime instance, not a digital product" classifications —
-- the platform's own Docker self-scan (containers, hosts, subnets, NICs,
-- gateways). They are not actionable gaps and can never be resolved, so they
-- accumulated as permanent-open noise (378 rows on the Foundational catalog) that
-- buried the handful of genuinely-fixable issues.
--
-- Going forward the promotion runner no longer writes these (see
-- packages/db/src/discovery-promotion.ts + isTerminalStructuralSkip in
-- discovery-promotion-policy.ts). This one-shot backfill clears the rows already
-- persisted under the old behaviour. It is non-destructive: it only flips
-- status open -> resolved (rows remain for audit). Gated on evidence source so a
-- genuinely-actionable type_not_promotable (legacy-list / non-auto node policy)
-- is left open.
UPDATE "PortfolioQualityIssue"
SET "status" = 'resolved',
    "resolvedAt" = NOW()
WHERE "status" = 'open'
  AND (
    ("issueType" = 'name_not_promotable' AND "details" ->> 'source' = 'name-gate')
    OR
    ("issueType" = 'type_not_promotable' AND "details" ->> 'source' = 'structural-type-gate')
  );
