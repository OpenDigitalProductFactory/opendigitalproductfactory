-- @migration-safety: data-safe: DROP INDEX IF EXISTS only — removes two indexes
-- created earlier in this same branch's chain (20260816101000); cannot fail on
-- any data state and frees write overhead on two high-volume append-only tables.
--
-- BI-873F3C48 follow-up: LifecycleEvent and HospitalityServiceTurnEvent were
-- initially enrolled in the retention sweep, but both hold standing
-- domain-lifecycle-managed stewardship exemptions (scripts/stewardship-exemptions.txt)
-- — their rows follow the lifecycle of the thing they evidence and are never
-- age-swept. With the sweep enrollment withdrawn, the sweep-cutoff indexes lose
-- their justifying query path (every index must cite one), so they are dropped.

DROP INDEX IF EXISTS "LifecycleEvent_createdAt_idx";
DROP INDEX IF EXISTS "HospitalityServiceTurnEvent_occurredAt_idx";
