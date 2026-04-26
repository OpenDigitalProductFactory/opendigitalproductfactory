-- Data normalization: BacklogItem.type is a canonical enum {portfolio, product}.
-- Live data has drifted to include "feature"; normalize to "product" so the
-- TS-level enum (enforced by the new MCP tool input schemas) stays consistent
-- with what's in the database.
UPDATE "BacklogItem" SET "type" = 'product' WHERE "type" = 'feature';
