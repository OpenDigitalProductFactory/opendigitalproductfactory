-- EP-6B33A840 L0.1 (BI-6EA9E25A): a person's own UI language and timezone.
-- Additive and nullable; no backfill. A NULL means "follow the org default,
-- then the browser's Accept-Language" (language) or "the org's timezone"
-- (timeZone), so every existing Principal keeps today's behaviour.
ALTER TABLE "Principal"
  ADD COLUMN IF NOT EXISTS "preferredLanguage" TEXT,
  ADD COLUMN IF NOT EXISTS "timeZone" TEXT;
