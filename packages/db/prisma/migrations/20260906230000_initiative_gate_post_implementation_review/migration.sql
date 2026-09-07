-- Break-fix expedite lane (BI-F2FEC1EB, design 2026-09-02 §4 / ruling 1): the
-- post-implementation review is a governed gate receipt like every other lane.
-- @migration-safety: data-safe: additive enum value; no row is read, rewritten or removed.
ALTER TYPE "InitiativeGateKey" ADD VALUE IF NOT EXISTS 'post-implementation-review';
