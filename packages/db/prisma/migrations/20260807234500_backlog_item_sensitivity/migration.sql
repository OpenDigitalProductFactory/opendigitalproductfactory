-- BacklogItem.sensitivity — cross-org sharing classification. (BI-DC4E526E)
--
-- public | internal | confidential | restricted. Deny-by-default: only `public`
-- may cross an organization boundary in federated demand (kernel DI-3E77E48D5710).
-- Defaults to `internal` so every existing/unclassified item is treated as NOT
-- cross-org-shareable — proprietary demand never leaks upstream. Additive,
-- non-destructive.
ALTER TABLE "BacklogItem" ADD COLUMN "sensitivity" TEXT NOT NULL DEFAULT 'internal';
