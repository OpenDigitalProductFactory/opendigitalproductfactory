-- BI-3DA1DFDC: Restaurant booking handoff needs traceable owner-facing context.
--
-- Party size (covers) and dietary requirements were previously only captured as
-- free-text lines prepended to `notes`, so the owner inbox could not show a
-- structured, traceable reservation summary. Promote them to first-class,
-- nullable columns. Existing rows keep their notes untouched (backfill is not
-- attempted — historical free-text is left as-is, new bookings populate these).

ALTER TABLE "StorefrontBooking"
  ADD COLUMN "covers" INTEGER,
  ADD COLUMN "dietaryNotes" TEXT;
