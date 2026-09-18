-- BI-A442F129: an adoption application carries the screening answers a rescue
-- actually decides on (housing situation, other pets, children, landlord
-- permission, experience). Additive nullable JSON column; no rows change.
-- @migration-safety: data-safe: adds one nullable column; no rows or constraints are changed.

ALTER TABLE "AnimalAdoptionApplication" ADD COLUMN "screening" JSONB;
