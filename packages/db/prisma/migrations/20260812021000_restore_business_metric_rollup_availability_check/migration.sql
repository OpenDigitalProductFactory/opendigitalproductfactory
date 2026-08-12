-- @migration-safety: data-safe: BusinessMetricRollup is created empty earlier in this same unapplied migration sequence, and no application traffic can write rows before migrate deploy completes.
ALTER TABLE "BusinessMetricRollup"
  ADD CONSTRAINT "BusinessMetricRollup_availability_check" CHECK (
    ("availability" = 'available' AND "value" IS NOT NULL AND "unavailableReason" IS NULL)
    OR
    ("availability" = 'unavailable' AND "value" IS NULL AND "unavailableReason" IS NOT NULL)
  );
