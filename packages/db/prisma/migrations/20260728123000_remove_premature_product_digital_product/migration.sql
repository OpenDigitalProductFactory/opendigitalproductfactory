-- EP-ED496EB0 Phase 1 / BI-AD7F9D34
-- Forward-only correction to the preceding, unreleased migration. WWMD
-- decision DI-67A941CAF7EE found that Phase 1 has no real endpoint evidence or
-- consuming workflow for a business-product-to-digital-product trace.
--
-- @migration-safety: data-safe: ProductDigitalProduct is created by the
-- immediately preceding migration in this same unreleased change set. No
-- application version writes it between migrations, so it is necessarily empty.
DROP TABLE "ProductDigitalProduct";
