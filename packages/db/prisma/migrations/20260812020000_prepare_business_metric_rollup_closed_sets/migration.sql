-- PostgreSQL reparses dependent CHECK expressions while changing a column's
-- type. Remove the text-typed expression before the following migration turns
-- availability into an enum; the invariant is restored immediately afterward.
ALTER TABLE "BusinessMetricRollup"
  DROP CONSTRAINT "BusinessMetricRollup_availability_check";
