-- Persist the exact signed launch authority so same-ID retries and startup
-- recovery never synthesize a new identity or extend its validity window.
ALTER TABLE "RuntimeCapabilityTransition"
  ADD COLUMN "issuedAt" TIMESTAMP(3),
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "envelope" JSONB,
  ADD COLUMN "envelopeSignature" TEXT;

ALTER TABLE "RuntimeCapabilityTransition"
  ADD CONSTRAINT "RuntimeCapabilityTransition_envelope_identity_check" CHECK (
    ("issuedAt" IS NULL AND "expiresAt" IS NULL AND "envelope" IS NULL AND "envelopeSignature" IS NULL)
    OR
    ("issuedAt" IS NOT NULL AND "expiresAt" IS NOT NULL AND "envelope" IS NOT NULL AND "envelopeSignature" ~ '^[a-f0-9]{64}$' AND "expiresAt" > "issuedAt")
  ) NOT VALID;
