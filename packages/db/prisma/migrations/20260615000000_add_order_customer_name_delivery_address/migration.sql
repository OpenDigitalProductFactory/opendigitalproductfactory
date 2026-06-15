-- Add customer name and delivery address to StorefrontOrder (B5-1)
-- Both columns are nullable so existing rows are unaffected.
ALTER TABLE "StorefrontOrder" ADD COLUMN "customerName" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "deliveryAddress" JSONB;
