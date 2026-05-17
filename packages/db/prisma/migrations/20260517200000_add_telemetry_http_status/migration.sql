-- Add httpStatus column to AdapterRunTelemetry to capture the raw HTTP
-- status code returned by the provider on error. Previously this was
-- embedded (truncated) in refusalReason and lost on success paths.
ALTER TABLE "AdapterRunTelemetry" ADD COLUMN "httpStatus" INTEGER;
