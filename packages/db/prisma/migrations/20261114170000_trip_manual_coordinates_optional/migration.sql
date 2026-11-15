-- BI-3DD6EFEB: a drive typed into the portal has no GPS position. Store the
-- position as unknown rather than fabricating 0,0. Relaxing NOT NULL is
-- additive: every existing row keeps its coordinates and every reader already
-- receives them unchanged.
ALTER TABLE "Trip" ALTER COLUMN "startLatitude" DROP NOT NULL;
ALTER TABLE "Trip" ALTER COLUMN "startLongitude" DROP NOT NULL;
ALTER TABLE "Trip" ALTER COLUMN "endLatitude" DROP NOT NULL;
ALTER TABLE "Trip" ALTER COLUMN "endLongitude" DROP NOT NULL;
