-- Data-only backfill: functional domain for every seeded regulation (BI-0B867B67).
-- On an EXISTING install the seeded regulations sit with domain = NULL between
-- deploy and the next seed run; backfill here so per-function reporting is in
-- effect the instant this migration applies, independent of seed timing.
-- Guarded on IS NULL: a later seed upsert or operator edit stays authoritative,
-- and this is a no-op on a fresh install (rows are seeded after migrations run).
-- One primary domain per regulation (tie-breaks: GLBA→finance as a
-- financial-institution regime; HIPAA/FERPA/FedRAMP→privacy-security as
-- data-protection/security regimes).

UPDATE "Regulation" SET "domain" = 'privacy-security'
 WHERE "domain" IS NULL AND "regulationId" IN (
   'REG-US-CCPA','REG-US-STATE-PRIVACY','REG-US-STATE-BREACH-NOTIFICATION',
   'REG-FRAMEWORK-SOC2','REG-FRAMEWORK-ISO-27001',
   'REG-US-HIPAA','REG-US-FERPA','REG-US-FEDRAMP','REG-EU-GDPR','REG-UK-GDPR');

UPDATE "Regulation" SET "domain" = 'ai-governance'
 WHERE "domain" IS NULL AND "regulationId" IN (
   'REG-FRAMEWORK-NIST-AI-RMF','REG-US-TX-TRAIGA','REG-US-CO-AI-ACT','REG-EU-AI-ACT');

UPDATE "Regulation" SET "domain" = 'consumer-marketing'
 WHERE "domain" IS NULL AND "regulationId" IN ('REG-US-CAN-SPAM','REG-US-TCPA');

UPDATE "Regulation" SET "domain" = 'accessibility'
 WHERE "domain" IS NULL AND "regulationId" IN ('REG-US-ADA-WCAG');

UPDATE "Regulation" SET "domain" = 'finance'
 WHERE "domain" IS NULL AND "regulationId" IN (
   'REG-US-GLBA','REG-US-BSA-AML','REG-US-NCUA','REG-US-FDIC-CRA','REG-US-IRS-SUBCHAPTER-T');

UPDATE "Regulation" SET "domain" = 'corporate-governance'
 WHERE "domain" IS NULL AND "regulationId" IN ('REG-UK-CORP-GOV-CODE','REG-US-COOP-GOVERNANCE');

UPDATE "Regulation" SET "domain" = 'sector'
 WHERE "domain" IS NULL AND "regulationId" IN (
   'REG-US-STATE-OPEN-MEETINGS','REG-US-STATE-PUBLIC-RECORDS','REG-US-STATE-MUNI-FINANCE',
   'REG-US-EPA-SDWA','REG-US-EPA-NPDES',
   'REG-US-STATE-POST','REG-US-LE-POLICY-ATTESTATION','REG-US-CJIS-READINESS');
