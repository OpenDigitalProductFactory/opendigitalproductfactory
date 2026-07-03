-- Phase 2 (control consolidation): stable cross-framework catalog identity for
-- controls. A control with a catalogKey is the SAME control across every
-- regulation whose obligations it satisfies, so dedup keys on identity rather
-- than an exact-title match, and one control can crosswalk many frameworks.
-- Nullable + no default: existing controls stay un-cataloged until assigned.
ALTER TABLE "Control" ADD COLUMN "catalogKey" TEXT;
CREATE INDEX "Control_catalogKey_idx" ON "Control" ("catalogKey");
